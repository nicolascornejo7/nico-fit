import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('V3 schema is additive and isolated from V2 names',async()=>{
  const sql=await read('supabase/migration-v3-schema.sql');
  assert.match(sql,/create schema if not exists nico_fit_v3/i);
  for(const table of ['workout_sessions','session_exercises','exercise_sets','exercise_catalog'])assert.match(sql,new RegExp(`create table if not exists nico_fit_v3\\.${table}`,'i'));
  assert.doesNotMatch(sql,/drop table\s+public\.|alter table\s+public\.(workouts|workout_sessions)/i);
});

test('server trigger rejects stale versions and version jumps',async()=>{
  const sql=await read('supabase/migration-v3-schema.sql');
  assert.match(sql,/new\.version <> old\.version \+ 1/i);
  assert.match(sql,/errcode = 'PT409'/i);
  assert.match(sql,/deleted records are immutable/i);
});

test('traceability tables contain required migration audit fields',async()=>{
  const sql=await read('supabase/migration-v3-schema.sql');
  for(const table of ['v2_workout_session_map','v2_workout_map','v2_set_map','v2_exercise_name_map']){
    const start=sql.indexOf(`create table if not exists nico_fit_v3.${table}`),end=sql.indexOf('\n);',start),definition=sql.slice(start,end);
    for(const column of ['migration_status','migration_note','source_payload','migration_started_at','migration_completed_at'])assert.match(definition,new RegExp(`\\b${column}\\b`));
  }
});

test('schema, backfill, and cutover remain separate',async()=>{
  const [schema,sessions,workouts,cutover,grants]=await Promise.all([
    read('supabase/migration-v3-schema.sql'),read('supabase/backfill-v2-sessions.sql'),read('supabase/backfill-v2-workouts.sql'),read('supabase/cutover-v3.sql'),read('sql/v3-production-api-grants.sql')
  ]);
  assert.doesNotMatch(schema,/grant (select|insert|update).*authenticated/i);
  assert.match(schema,/revoke all on schema nico_fit_v3 from public, anon, authenticated/i);
  assert.match(sessions,/public\.workout_sessions/i);
  assert.match(workouts,/public\.workouts/i);
  assert.match(cutover,/\\ir \.\.\/sql\/v3-production-api-grants\.sql/i);
  assert.match(grants,/grant usage on schema nico_fit_v3 to anon, authenticated/i);
  assert.doesNotMatch(grants,/grant delete/i);
});

test('backfill preserves tombstones and is duplicate-safe',async()=>{
  const [sessions,workouts]=await Promise.all([read('supabase/backfill-v2-sessions.sql'),read('supabase/backfill-v2-workouts.sql')]);
  for(const sql of [sessions,workouts]){
    assert.match(sql,/sync_tombstones/i);
    assert.match(sql,/on conflict .* do nothing/i);
  }
});

test('RLS ownership follows the parent session and normal clients cannot hard-delete',async()=>{
  const [schema,cutover]=await Promise.all([read('supabase/migration-v3-schema.sql'),read('supabase/cutover-v3.sql')]);
  assert.match(schema,/create policy session_exercises_insert[\s\S]*s\.id = session_id and s\.user_id = auth\.uid\(\)/i);
  assert.match(schema,/create policy session_exercises_insert[\s\S]*c\.id = exercise_catalog_id[\s\S]*c\.owner_user_id = auth\.uid\(\)/i);
  assert.match(schema,/create policy exercise_sets_insert[\s\S]*join nico_fit_v3\.workout_sessions s[\s\S]*s\.user_id = auth\.uid\(\)/i);
  assert.doesNotMatch(schema,/create policy\s+\w+\s+on\s+nico_fit_v3\.\w+\s+for delete/i);
  assert.doesNotMatch(cutover,/grant delete/i);
});

test('ordered duplicates and typed set values are represented explicitly',async()=>{
  const sql=await read('supabase/migration-v3-schema.sql');
  assert.match(sql,/session_exercises_active_position_uidx[\s\S]*\(session_id, position\) where deleted_at is null/i);
  assert.match(sql,/exercise_sets_active_position_uidx[\s\S]*\(session_exercise_id, position\) where deleted_at is null/i);
  assert.match(sql,/num_nonnulls\(reps, duration_seconds\) <= 1/i);
  assert.doesNotMatch(sql,/unique\s*\(session_id,\s*exercise_catalog_id\)/i);
});

test('free workouts are an explicit additive session type',async()=>{
  const sql=await read('supabase/migration-v3-schema.sql');
  const migration=await read('supabase/migration-v3-free-workouts.sql');
  assert.match(sql,/session_type text not null default 'routine' check \(session_type in \('routine', 'free_workout'\)\)/i);
  assert.match(migration,/add column if not exists session_type text not null default 'routine'/i);
});
