import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('staging runners refuse the production Supabase ref',async()=>{
  const [builder,runner]=await Promise.all([
    read('scripts/build-v3-staging-bundle.mjs'),
    read('scripts/v3-supabase-staging.mjs')
  ]);
  for(const source of [builder,runner]){
    assert.match(source,/xaklsoqyzwowtjwcpwmb/);
    assert.match(source,/production/i);
    assert.match(source,/assert\.notEqual|projectRef===productionRef/);
  }
});

test('staging phases keep schema, backfill, API grants, and validation separate',async()=>{
  const builder=await read('scripts/build-v3-staging-bundle.mjs');
  assert.match(builder,/const phases=\[[\s\S]*migration,\s*\n\s*migration,\s*\n\s*fixtures,/);
  assert.match(builder,/\[sessions,workouts\][\s\S]*\[sessions,workouts\][\s\S]*grants,\s*\n\s*tests/);
  assert.match(builder,/eight staged SQL phases/i);
});

test('staging API exposure is authenticated-only',async()=>{
  const sql=await read('supabase/staging-v3-api-grants.sql');
  assert.match(sql,/grant usage on schema nico_fit_v3 to authenticated/i);
  assert.match(sql,/revoke all on schema nico_fit_v3 from anon/i);
  assert.match(sql,/pgrst\.db_schemas = 'public, nico_fit_v3'/i);
  assert.doesNotMatch(sql,/grant delete/i);
});

test('hosted conflict errors map to HTTP 409 without serialization retries',async()=>{
  const [schema,runner]=await Promise.all([
    read('supabase/migration-v3-schema.sql'),
    read('scripts/v3-supabase-staging.mjs')
  ]);
  assert.match(schema,/errcode = 'PT409'/i);
  assert.doesNotMatch(schema,/errcode = '40001'/i);
  assert.match(runner,/stale\.error\?\.code,'PT409'/);
});
