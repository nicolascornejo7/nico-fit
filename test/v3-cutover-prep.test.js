import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const withoutCommentsAndStrings=sql=>sql.replace(/--.*$/gm,'').replace(/'(?:''|[^'])*'/g,"''");

test('production inventory evidence is privacy-safe and matches observed V2 counts',async()=>{
  const report=JSON.parse(await read('docs/v3-cutover-production-inventory.json'));
  assert.equal(report.mode,'read_only');
  assert.equal(report.project.ref,'xaklsoqyzwowtjwcpwmb');
  assert.equal(report.schema.nico_fit_v3_exists,false);
  assert.deepEqual(report.raw_counts,{auth_users:1,readiness:5,workouts:4,workout_sets:12,match_reviews:0,football_sessions:1,workout_sessions:1,sync_tombstones:0});
  assert.equal(report.preflight.session_exercises.pending_review,4);
  assert.equal(report.preflight.exercise_sets.migrated_if_known_map_approved,12);
  assert.equal(JSON.stringify(report).includes('user_id'),false);
});

test('inventory and preflight SQL cannot mutate production',async()=>{
  for(const path of ['supabase/production-inventory-readonly.sql','supabase/preflight-v3-production-readonly.sql']){
    const sql=await read(path),normalized=withoutCommentsAndStrings(sql);
    assert.match(normalized,/begin transaction read only/i);
    assert.doesNotMatch(normalized,/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\s/i);
    assert.doesNotMatch(normalized,/\b(do|call|copy)\s/i);
  }
});

test('write freeze and rollback require exact production ref and separate approval markers',async()=>{
  const freeze=await read('supabase/cutover-freeze-v2-writes.sql'),rollback=await read('supabase/rollback-unfreeze-v2-writes.sql');
  for(const sql of [freeze,rollback]){assert.match(sql,/xaklsoqyzwowtjwcpwmb/);assert.match(sql,/current_setting/);assert.match(sql,/public\.sync_tombstones/);}
  assert.match(freeze,/revoke insert,update,delete,truncate/i);
  assert.match(rollback,/grant insert,update,delete,truncate/i);
  assert.notEqual(freeze.match(/approved[^']*/i)?.[0],rollback.match(/approved[^']*/i)?.[0]);
});

test('backup and restore scripts fail closed and restoration rejects production',async()=>{
  const backup=await read('ops/v3-cutover/backup-production.ps1'),restore=await read('ops/v3-cutover/restore-verify-isolated.ps1');
  assert.match(backup,/approved-read-only-backup/);assert.match(backup,/default_transaction_read_only=on/);assert.match(backup,/Get-FileHash -Algorithm SHA256/);
  assert.match(restore,/approved-isolated-restore/);assert.match(restore,/Restore target must never be production/);assert.match(restore,/Restore target must never be the retained staging project/);assert.match(restore,/disposable-local-supabase/);assert.match(restore,/--clean --if-exists/);
});

test('local backup excludes auth tokens and restore requires origin plus typed consent',async()=>{
  const backup=await read('ops/v3-cutover/local-backup-browser.js'),restore=await read('ops/v3-cutover/local-restore-browser.js');
  assert.match(backup,/gymFutbolAppV2/);assert.match(backup,/nico-fit-v3-local:/);assert.doesNotMatch(backup,/supabase\.auth|access_token|refresh_token/);
  assert.match(restore,/RESTORE AND REPLACE LOCAL NICO FIT DATA/);assert.match(restore,/payload\.origin!==location\.origin/);assert.match(restore,/store\.clear\(\)/);
});

test('runbook keeps activation ordered, rollback boundary explicit and current decision conditional',async()=>{
  const doc=await read('docs/v3-cutover-runbook.md'),order=['**Storage V3**','**Signals**','**Routines**','**Training**','**Sync**','**Conflicts**','**Observability**','**Coach**'];
  let prior=-1;for(const label of order){const index=doc.indexOf(label);assert.ok(index>prior,`${label} is out of order`);prior=index;}
  assert.match(doc,/punto de no retorno simple es la primera escritura V3 aceptada/i);
  assert.match(doc,/CONDITIONAL GO para producción/);
  assert.match(doc,/standalone PWA/i);assert.match(doc,/Android/i);assert.match(doc,/iPhone\/iOS/i);assert.match(doc,/dos pestañas/i);
  assert.match(doc,/365 días/);assert.match(doc,/eliminación de cuenta/i);
});

test('prepared SQL runs read-only and write freeze is reversible in isolated PostgreSQL',async()=>{
  const {PGlite}=await import('@electric-sql/pglite'),db=new PGlite();
  try{
    await db.exec(await read('supabase/test-v3-local-bootstrap.sql'));
    await db.exec(await read('supabase/schema.sql'));
    await db.exec("insert into auth.users(id,email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fixture@example.invalid'); insert into public.readiness(user_id,date,sleep,energy,fatigue,pain) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-09-15',4,4,2,0);");
    await db.exec(await read('supabase/production-inventory-readonly.sql'));
    await db.exec(await read('supabase/preflight-v3-production-readonly.sql'));
    await assert.rejects(db.exec(await read('supabase/cutover-freeze-v2-writes.sql')),/locked/);await db.exec('rollback');
    await db.exec("select set_config('nico_fit.cutover_v2_write_freeze','approved',false);select set_config('nico_fit.expected_project_ref','xaklsoqyzwowtjwcpwmb',false);");
    await db.exec(await read('supabase/cutover-freeze-v2-writes.sql'));
    assert.equal((await db.query("select has_table_privilege('authenticated','public.readiness','INSERT') allowed")).rows[0].allowed,false);
    await db.exec("select set_config('nico_fit.rollback_v2_write_freeze','approved',false);");
    await db.exec(await read('supabase/rollback-unfreeze-v2-writes.sql'));
    assert.equal((await db.query("select has_table_privilege('authenticated','public.readiness','INSERT') allowed")).rows[0].allowed,true);
  }finally{await db.close();}
});
