import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

const ref='tmydirzzlmlmtjgwqcgh';
const productionRef='xaklsoqyzwowtjwcpwmb';
assert.equal(process.env.SUPABASE_STAGING_PROJECT_REF,ref,'Staging ref required.');
assert.equal(process.env.SUPABASE_STAGING_URL,`https://${ref}.supabase.co`,'Staging URL required.');
const connectionString=process.env.SUPABASE_STAGING_DATABASE_URL;
assert.ok(connectionString&&!connectionString.includes(productionRef),'Private staging PostgreSQL connection required.');
const host=new URL(connectionString).hostname;
assert.ok(host.endsWith('.supabase.com')&&!host.includes(productionRef),'Protected destination.');
const client=new pg.Client({connectionString,ssl:{rejectUnauthorized:process.env.SUPABASE_STAGING_DB_SSL_ALLOW_SELF_SIGNED!=='true'},connectionTimeoutMillis:15000});
const mode=process.argv[2]??'inspect';
assert.ok(['inspect','apply'].includes(mode));
try{
  await client.connect();
  const inspect=async()=>{
    const result=await client.query(`select c.relname as table_name, c.relrowsecurity as rls,
      has_schema_privilege('authenticated','nico_fit_v3','USAGE') as auth_schema,
      has_table_privilege('authenticated',c.oid,'SELECT') as auth_select,
      has_table_privilege('authenticated',c.oid,'INSERT') as auth_insert,
      has_table_privilege('authenticated',c.oid,'UPDATE') as auth_update,
      has_table_privilege('authenticated',c.oid,'DELETE') as auth_delete,
      has_schema_privilege('anon','nico_fit_v3','USAGE') as anon_schema,
      has_table_privilege('anon',c.oid,'SELECT') as anon_select,
      (select count(*)::int from pg_policies p where p.schemaname='nico_fit_v3' and p.tablename=c.relname and p.policyname in ('routines_read_own','routines_insert_own','routines_update_own')) as own_policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='nico_fit_v3' and c.relname in ('routine_templates','routine_versions','routine_exercises') order by c.relname`);
    return result.rows;
  };
  const before=await inspect();
  if(mode==='apply'){
    const sql=await readFile(new URL('../supabase/staging-v3-routines-api-grants.sql',import.meta.url),'utf8');
    await client.query(sql);
  }
  const after=await inspect();
  console.log(JSON.stringify({ref,mode,before,after}));
}catch(error){
  console.error(JSON.stringify({ref,mode,errorCode:error.code??'CONNECTION_OR_SQL_ERROR',message:'Staging grants inspection/application failed; details withheld.'}));
  process.exitCode=1;
}finally{await client.end();}
