import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const read=file=>readFile(new URL(`../${file}`,import.meta.url),'utf8');
const OLD='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NEW='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('full export enforces read-only production source and creates checksummed split bundle',async()=>{
  const source=await read('ops/v3-dr/export-full-readonly.ps1');
  assert.match(source,/default_transaction_read_only=on/);
  assert.match(source,/forensic-full\.dump/);
  for(const file of ['roles.sql','schema.sql','data.sql','expected-verification.json','manifest.json'])assert.match(source,new RegExp(file.replace('.','\\.')));
  assert.match(source,/Get-FileHash -Algorithm SHA256/);
  assert.match(source,/orphaned_v2_rows/);
  assert.match(source,/xaklsoqyzwowtjwcpwmb/);
  assert.match(source,/tmydirzzlmlmtjgwqcgh/);
});

test('restore and Auth verifier reject production and retained staging',async()=>{
  const restore=await read('ops/v3-dr/restore-full-isolated.ps1'),auth=await read('scripts/v3-dr-auth-verify.mjs');
  for(const ref of ['xaklsoqyzwowtjwcpwmb','tmydirzzlmlmtjgwqcgh']){assert.match(restore,new RegExp(ref));assert.match(auth,new RegExp(ref));}
  assert.match(restore,/Restore target ref is protected/);
  assert.match(restore,/Checksum or size mismatch/);
  assert.match(restore,/Restore mismatch for/);
  assert.match(restore,/v2_rls_tables/);
  assert.match(auth,/Protected Supabase project ref/);
});

test('Auth verifier supports preserved hash login and recovery token login without logging secrets',async()=>{
  const source=await read('scripts/v3-dr-auth-verify.mjs');
  assert.match(source,/signInWithPassword/);
  assert.match(source,/generateLink\(\{type:'recovery'/);
  assert.match(source,/verifyOtp/);
  assert.match(source,/updateUser/);
  assert.doesNotMatch(source,/console\.log\([^)]*(password|SERVICE_ROLE)/i);
});

test('strategy B remaps every V2 owner atomically and rejects protected target',async()=>{
  const db=new PGlite();
  try{
    await db.exec(await read('supabase/test-v2-restore-bootstrap.sql'));
    await db.exec(await read('supabase/schema.sql'));
    await db.exec(`insert into auth.users(id,email) values ('${OLD}','old@example.invalid'),('${NEW}','new@example.invalid');
      insert into public.readiness(user_id,date,sleep,energy,fatigue,pain) values ('${OLD}','2040-01-01',4,4,2,0);
      insert into public.workouts(user_id,date,day,exercise) values ('${OLD}','2040-01-01','Martes','Fixture');
      insert into public.match_reviews(user_id,date,energy,legs,performance) values ('${OLD}','2040-01-01',4,4,4);
      insert into public.football_sessions(user_id,date,session_type,duration_minutes,rpe) values ('${OLD}','2040-01-01','training',60,5);
      insert into public.workout_sessions(user_id,date,day,label) values ('${OLD}','2040-01-01','Martes','Fixture');
      insert into public.sync_tombstones(user_id,entity,record_key) values ('${OLD}','workout','fixture');
      select set_config('nico_fit.dr_target_ref','local-isolated-supabase',false);
      select set_config('nico_fit.dr_old_user_id','${OLD}',false);
      select set_config('nico_fit.dr_new_user_id','${NEW}',false);`);
    await db.exec(await read('supabase/v3-dr-remap-v2-ownership.sql'));
    for(const table of ['readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones']){
      const rows=(await db.query(`select user_id::text from public.${table}`)).rows;
      assert.deepEqual(rows,[{user_id:NEW}]);
    }
    await db.exec(`select set_config('nico_fit.dr_target_ref','xaklsoqyzwowtjwcpwmb',false);select set_config('nico_fit.dr_old_user_id','${NEW}',false);select set_config('nico_fit.dr_new_user_id','${OLD}',false);`);
    await assert.rejects(db.exec(await read('supabase/v3-dr-remap-v2-ownership.sql')),/Protected or missing/);
    await db.exec('rollback');
  }finally{await db.close();}
});

test('documentation distinguishes preserved Auth from recreated Auth and remains NO-GO',async()=>{
  const docs=await read('docs/v3-full-disaster-recovery.md');
  assert.match(docs,/Estrategia A: dump y restore completos/);
  assert.match(docs,/Estrategia B: datos y recreación de Auth/);
  assert.match(docs,/Hash de contraseña/);
  assert.match(docs,/UUID de usuario/);
  assert.match(docs,/Objetos que no deben copiarse ciegamente/);
  assert.match(docs,/Elementos que se recrean manualmente/);
  assert.match(docs,/NO-GO para considerar cerrado disaster recovery/);
});
