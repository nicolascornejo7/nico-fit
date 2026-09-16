import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {PGlite} from '@electric-sql/pglite';

const PROD_REF='xaklsoqyzwowtjwcpwmb';
const STAGING_REF='tmydirzzlmlmtjgwqcgh';
const TABLES=['readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones'];
const args=Object.fromEntries(process.argv.slice(2).map((value,index,list)=>value.startsWith('--')?[value.slice(2),list[index+1]?.startsWith('--')?true:list[index+1]]:null).filter(Boolean));
if(!args.input)throw new Error('Usage: node scripts/v3-backup-restore-verify.mjs --input <download.csv|payload.txt> [--output <dir>]');
if([PROD_REF,STAGING_REF].includes(String(args.targetRef||'')))throw new Error('Restore target ref is protected. Use a local isolated target only.');
if(args.targetHost && String(args.targetHost).includes(PROD_REF)||args.targetHost && String(args.targetHost).includes(STAGING_REF))throw new Error('Restore target host is protected.');
if(args.targetRef && args.targetRef!=='local-isolated-pglite')throw new Error('Only targetRef=local-isolated-pglite is accepted.');

const inputPath=path.resolve(String(args.input));
const raw=await readFile(inputPath,'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
function payloadText(value){
  const compact=value.trim();
  const lines=compact.split(/\r?\n/).filter(Boolean);
  const candidate=(lines[0]?.toLowerCase().includes('payload_base64')?lines.slice(1).join(''):lines.join('')).replace(/^"|"$/g,'').replace(/""/g,'"').trim();
  return Buffer.from(candidate,'base64').toString('utf8');
}
const decoded=payloadText(raw);
const backup=JSON.parse(decoded);
if(backup.format!=='nico-fit-v2-logical-backup-v1')throw new Error('Unsupported backup format.');
if(backup.source_project_ref!==PROD_REF)throw new Error('Backup source is not the exact production ref.');
for(const key of ['counts','catalog','data'])if(!backup[key])throw new Error(`Backup is missing ${key}.`);

const root=new URL('../',import.meta.url);
const bootstrap=await readFile(new URL('supabase/test-v2-restore-bootstrap.sql',root),'utf8');
const schema=await readFile(new URL('supabase/schema.sql',root),'utf8');
const db=new PGlite();
const quote=value=>value==null?'null':`'${String(value).replaceAll("'","''")}'`;
const jsonValue=value=>value&&typeof value==='object'?JSON.stringify(value):value;
try{
  await db.exec(bootstrap);
  await db.exec(schema);
  for(const user of backup.data.auth_users||[])await db.exec(`insert into auth.users(id,email) values (${quote(user.id)}::uuid,${quote(user.email)})`);
  for(const table of TABLES){
    for(const row of backup.data[table]||[]){
      const columns=Object.keys(row);
      const values=columns.map(column=>{
        const value=jsonValue(row[column]);
        if(column==='sets')return `${quote(value)}::jsonb`;
        return quote(value);
      });
      await db.exec(`insert into public.${table} (${columns.map(x=>`"${x}"`).join(',')}) values (${values.join(',')})`);
    }
    await db.exec(`select setval(pg_get_serial_sequence('public.${table}','id'),coalesce((select max(id) from public.${table}),1),(select count(*)>0 from public.${table}))`);
  }
  const restoredCounts={auth_users:Number((await db.query('select count(*)::int count from auth.users')).rows[0].count)};
  for(const table of TABLES)restoredCounts[table]=Number((await db.query(`select count(*)::int count from public.${table}`)).rows[0].count);
  const normalizedSource=Object.fromEntries(Object.entries(backup.counts).map(([key,value])=>[key,Number(value)]));
  const countComparison=Object.keys(normalizedSource).map(entity=>({entity,source:normalizedSource[entity],restored:restoredCounts[entity],match:normalizedSource[entity]===restoredCounts[entity]}));
  const restoredCatalog={
    columns:(await db.query(`select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name=any($1) order by table_name,ordinal_position`,[TABLES])).rows,
    indexes:(await db.query(`select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename=any($1) order by tablename,indexname`,[TABLES])).rows,
    constraints:(await db.query(`select c.relname table_name,con.conname constraint_name,con.contype,pg_get_constraintdef(con.oid) definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and con.contype <> 'n' and c.relname=any($1) order by c.relname,con.conname`,[TABLES])).rows,
    policies:(await db.query(`select tablename,policyname,cmd from pg_policies where schemaname='public' and tablename=any($1) order by tablename,policyname`,[TABLES])).rows,
    rls:(await db.query(`select c.relname table_name,c.relrowsecurity enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1) order by c.relname`,[TABLES])).rows
  };
  const identities={
    columns:rows=>rows.map(x=>`${x.table_name}.${x.column_name}`),
    indexes:rows=>rows.map(x=>`${x.tablename}.${x.indexname}`),
    constraints:rows=>rows.filter(x=>x.contype!=='n').map(x=>`${x.table_name}.${x.constraint_name}`),
    policies:rows=>rows.map(x=>`${x.tablename}.${x.policyname}.${x.cmd}`),
    rls:rows=>rows.filter(x=>x.enabled).map(x=>x.table_name)
  };
  const catalogComparison=Object.entries(identities).map(([kind,project])=>{
    const source=project(backup.catalog[kind]).sort(),restored=project(restoredCatalog[kind]).sort();
    return {kind,source:source.length,restored:restored.length,match:JSON.stringify(source)===JSON.stringify(restored),missing:source.filter(x=>!restored.includes(x)),unexpected:restored.filter(x=>!source.includes(x))};
  });
  const orphanQueries=TABLES.map(table=>`select count(*)::int count from public.${table} t left join auth.users u on u.id=t.user_id where u.id is null`).join(' union all ');
  const relations=(await db.query(orphanQueries)).rows.every(x=>Number(x.count)===0);
  const sequenceState=[];
  for(const table of TABLES){
    const row=(await db.query(`select (select last_value from ${table}_id_seq)::bigint last_value,coalesce((select max(id) from public.${table}),0)::bigint max_id`)).rows[0];
    sequenceState.push({table,last_value:Number(row.last_value),max_id:Number(row.max_id),ready:Number(row.last_value)>=Number(row.max_id)});
  }
  const owner=backup.data.auth_users?.[0]?.id;
  let ownVisible=true,otherHidden=true,anonHidden=true;
  if(owner){
    await db.exec(`grant select on all tables in schema public to anon,authenticated; set role authenticated; select set_config('request.jwt.claim.sub',${quote(owner)},false);`);
    for(const table of TABLES)ownVisible&&=Number((await db.query(`select count(*)::int count from public.${table}`)).rows[0].count)===Number(backup.counts[table]);
    await db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false);`);
    for(const table of TABLES)otherHidden&&=Number((await db.query(`select count(*)::int count from public.${table}`)).rows[0].count)===0;
    await db.exec('reset role; set role anon;');
    for(const table of TABLES)anonHidden&&=Number((await db.query(`select count(*)::int count from public.${table}`)).rows[0].count)===0;
    await db.exec('reset role;');
  }
  const rlsVerification={authenticated_owner_visible:ownVisible,authenticated_other_hidden:otherHidden,anon_hidden:anonHidden};
  const passed=countComparison.every(x=>x.match)&&catalogComparison.every(x=>x.match)&&relations&&sequenceState.every(x=>x.ready)&&Object.values(rlsVerification).every(Boolean);
  const report={status:passed?'PASS':'FAIL',verified_at:new Date().toISOString(),target:'local-isolated-pglite',source:{project_ref:PROD_REF,captured_at:backup.captured_at,postgres_version:backup.postgres_version},backup:{file:path.basename(inputPath),bytes:Buffer.byteLength(raw),sha256:sha(raw),payload_bytes:Buffer.byteLength(decoded),payload_sha256:sha(decoded)},schema:{file:'schema-v2.sql',bytes:Buffer.byteLength(schema),sha256:sha(schema)},count_comparison:countComparison,catalog_comparison:catalogComparison,orphan_relations_zero:relations,sequences:sequenceState,rls_verification:rlsVerification,limitations:['Auth passwords/tokens are excluded; identity stubs preserve V2 ownership and foreign keys.','PGlite validates PostgreSQL schema/data/RLS metadata, not GoTrue or PostgREST runtime behavior.']};
  const output=path.resolve(String(args.output||'artifacts/v3-backup-restore-validation'));
  await mkdir(output,{recursive:true});
  await writeFile(path.join(output,'schema-v2.sql'),schema,'utf8');
  const reportPath=path.join(output,'restore-verification.json');
  await writeFile(reportPath,JSON.stringify(report,null,2),'utf8');
  const manifest={created_at:new Date().toISOString(),source_project_ref:PROD_REF,source_captured_at:backup.captured_at,target:'local-isolated-pglite',files:[report.backup,report.schema,{file:'restore-verification.json',bytes:Buffer.byteLength(JSON.stringify(report,null,2)),sha256:sha(JSON.stringify(report,null,2))}]};
  await writeFile(path.join(output,'backup-manifest.json'),JSON.stringify(manifest,null,2),'utf8');
  console.log(JSON.stringify({status:report.status,report:reportPath,backup_sha256:report.backup.sha256,counts:report.count_comparison,catalog:report.catalog_comparison},null,2));
  if(!passed)process.exitCode=1;
}finally{await db.close();}
