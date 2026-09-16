import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=file=>readFile(new URL(`../${file}`,import.meta.url),'utf8');

test('production export is a single SELECT-only payload in a read-only transaction',async()=>{
  const sql=await read('supabase/backup-v2-production-readonly.sql');
  assert.match(sql,/begin transaction read only/i);
  assert.match(sql,/payload_base64/i);
  assert.match(sql,/xaklsoqyzwowtjwcpwmb/);
  assert.doesNotMatch(sql,/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|call|do|copy)\b/i);
  for(const table of ['readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones'])assert.match(sql,new RegExp(`public\\.${table}`));
});

test('export excludes Auth credentials while preserving identity stubs',async()=>{
  const sql=await read('supabase/backup-v2-production-readonly.sql');
  assert.match(sql,/jsonb_build_object\('id',id,'email',email\)/);
  assert.doesNotMatch(sql,/encrypted_password|confirmation_token|recovery_token|refresh_token/i);
});

test('restore runner rejects protected targets and records hashes plus comparisons',async()=>{
  const source=await read('scripts/v3-backup-restore-verify.mjs');
  assert.match(source,/xaklsoqyzwowtjwcpwmb/);
  assert.match(source,/tmydirzzlmlmtjgwqcgh/);
  assert.match(source,/Restore target ref is protected/);
  assert.match(source,/sha256/);
  assert.match(source,/countComparison/);
  assert.match(source,/catalogComparison/);
  assert.match(source,/orphan_relations_zero/);
  assert.match(source,/rls_verification/);
  assert.match(source,/setval\(pg_get_serial_sequence/);
  assert.match(source,/backup-manifest\.json/);
});

test('isolated restore bootstrap does not precreate any V2 application table',async()=>{
  const sql=await read('supabase/test-v2-restore-bootstrap.sql');
  assert.match(sql,/create table auth\.users/i);
  assert.doesNotMatch(sql,/create table public\./i);
});
