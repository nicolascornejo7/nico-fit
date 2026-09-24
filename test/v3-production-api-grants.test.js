import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sqlPath=new URL('../sql/v3-production-api-grants.sql',import.meta.url);
const wrapperPath=new URL('../supabase/cutover-v3.sql',import.meta.url);

test('production grants are guarded, idempotent SQL with no staging dependency',async()=>{
  const sql=await readFile(sqlPath,'utf8');
  assert.match(sql,/nico_fit\.allow_v3_cutover/);
  assert.match(sql,/alter role authenticator set pgrst\.db_schemas = 'public, storage, graphql_public, nico_fit_v3'/);
  assert.doesNotMatch(sql,/staging/i);
  assert.doesNotMatch(sql,/service[_-]?role\s*key|secret\s*key/i);
  assert.doesNotMatch(sql,/create policy|drop policy/i);
});

test('authenticated receives the approved minimum table privileges',async()=>{
  const sql=(await readFile(sqlPath,'utf8')).replace(/\s+/g,' ');
  for(const table of [
    'exercise_catalog','workout_sessions','session_exercises','exercise_sets',
    'daily_readiness','football_sessions','match_reviews',
    'routine_templates','routine_versions','routine_exercises'
  ]) assert.match(sql,new RegExp(`nico_fit_v3\\.${table}`));
  assert.match(sql,/grant select, insert, update on .* to authenticated;/);
  assert.match(sql,/grant select, insert on nico_fit_v3\.operational_audit to authenticated;/);
  assert.doesNotMatch(sql,/grant delete/i);
});

test('anonymous access is limited to rollout_config',async()=>{
  const sql=await readFile(sqlPath,'utf8');
  assert.match(sql,/revoke all on all tables in schema nico_fit_v3 from public, anon, authenticated/);
  assert.match(sql,/grant select on nico_fit_v3\.rollout_config to anon, authenticated/);
  assert.doesNotMatch(sql,/grant[^;]+(?:exercise_catalog|workout_sessions|daily_readiness|routine_templates)[^;]+to anon/is);
});

test('legacy cutover entry point invokes only the canonical artifact',async()=>{
  const wrapper=await readFile(wrapperPath,'utf8');
  assert.match(wrapper,/\\ir \.\.\/sql\/v3-production-api-grants\.sql/);
  assert.doesNotMatch(wrapper,/staging-v3/);
});
