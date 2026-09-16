import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {PGlite} from '@electric-sql/pglite';
import {decodeLogicalBackupCsv,reviewProductionMappings} from './lib/v3-production-mapping-review.mjs';

const args=Object.fromEntries(process.argv.slice(2).map((value,index,list)=>value.startsWith('--')?[value.slice(2),list[index+1]?.startsWith('--')?true:list[index+1]]:null).filter(Boolean));
if(!args.input)throw new Error('Uso: node scripts/v3-review-production-mappings.mjs --input <backup.csv> [--mapping <json>] [--output <dir>]');
const mappingPath=path.resolve(String(args.mapping||'config/v3-production-workout-mappings.v1.json'));
const backup=decodeLogicalBackupCsv(await readFile(path.resolve(String(args.input)),'utf8'));
const mappings=JSON.parse(await readFile(mappingPath,'utf8'));
const report=reviewProductionMappings(backup,mappings);
const root=new URL('../',import.meta.url),tables=['readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones'];
const db=new PGlite(),quote=value=>value==null?'null':`'${String(value).replaceAll("'","''")}'`;
try{
  await db.exec(await readFile(new URL('supabase/test-v2-restore-bootstrap.sql',root),'utf8'));
  await db.exec(await readFile(new URL('supabase/schema.sql',root),'utf8'));
  for(const user of backup.data.auth_users||[])await db.exec(`insert into auth.users(id,email) values (${quote(user.id)}::uuid,${quote(user.email)})`);
  for(const table of tables)for(const row of backup.data[table]||[]){
    const columns=Object.keys(row),values=columns.map(column=>column==='sets'?`${quote(JSON.stringify(row[column]))}::jsonb`:quote(row[column]&&typeof row[column]==='object'?JSON.stringify(row[column]):row[column]));
    await db.exec(`insert into public.${table} (${columns.map(column=>`"${column}"`).join(',')}) values (${values.join(',')})`);
  }
  const preflightSql=await readFile(new URL('supabase/preflight-v3-production-readonly.sql',root),'utf8');
  const classify=results=>results.flatMap(result=>result.rows||[]).filter(row=>row.entity).map(row=>({entity:row.entity,migrated:Number(row.migrated),pending_review:Number(row.pending_review),skipped:Number(row.skipped)}));
  const classification=classify(await db.exec(preflightSql)),repeated=classify(await db.exec(preflightSql));
  if(JSON.stringify(classification)!==JSON.stringify(repeated))throw new Error('El preflight SQL no fue idempotente.');
  for(const entity of ['session_exercises','exercise_sets']){
    const sqlRow=classification.find(row=>row.entity===entity);
    if(!sqlRow||JSON.stringify(sqlRow)!==JSON.stringify({entity,...report.projected[entity]}))throw new Error(`El preflight SQL no coincide con el manifiesto para ${entity}.`);
  }
  report.sql_preflight={target:'local-isolated-pglite',transaction:'read_only',idempotent:true,classification};
}finally{await db.close();}
const output=path.resolve(String(args.output||'artifacts/v3-review-production-mappings'));
await mkdir(output,{recursive:true});
const reportPath=path.join(output,'preflight-approved-mappings.json');
await writeFile(reportPath,JSON.stringify(report,null,2),'utf8');
console.log(JSON.stringify({status:report.projected.session_exercises.pending_review===0&&report.projected.exercise_sets.pending_review===0?'PASS':'FAIL',report:reportPath,projected:report.projected},null,2));
if(report.projected.session_exercises.pending_review||report.projected.exercise_sets.pending_review)process.exitCode=1;
