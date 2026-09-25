import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const READINESS='11111111-1111-4111-8111-111111111111';
const MATCH='22222222-2222-4222-8222-222222222222';
const TRAINING='33333333-3333-4333-8333-333333333333';
const REVIEW='44444444-4444-4444-8444-444444444444';
const date='2041-01-15';

async function database(){
  const {PGlite}=await import('@electric-sql/pglite');
  const db=new PGlite();
  await db.exec(await readFile(new URL('../supabase/test-v3-local-bootstrap.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migration-v3-schema.sql',import.meta.url),'utf8'));
  return db;
}

const defectiveFunction=`
create or replace function nico_fit_v3.signals_identity_guard() returns trigger language plpgsql
set search_path=pg_catalog,nico_fit_v3 as $$
begin
  if tg_op='UPDATE' and (new.id<>old.id or new.user_id<>old.user_id or new.local_date<>old.local_date) then
    raise exception using errcode='23514',message='signal identity and date are immutable';
  end if;
  if tg_table_name='match_reviews' and new.football_session_id is not null and new.deleted_at is null then
    if not exists(select 1 from nico_fit_v3.football_sessions f where f.id=new.football_session_id and f.user_id=new.user_id and f.local_date=new.local_date and f.session_type='match' and f.deleted_at is null) then
      raise exception using errcode='23514',message='review requires live owned same-date match';
    end if;
  end if;
  if tg_table_name='football_sessions' and new.session_type<>'match' and new.deleted_at is null and exists(select 1 from nico_fit_v3.match_reviews r where r.football_session_id=new.id and r.user_id=new.user_id and r.deleted_at is null) then
    raise exception using errcode='23514',message='match with reviews cannot change type';
  end if;
  return new;
end $$;`;

test('additive repair fixes the deployed shared-record failure and is idempotent',async()=>{
  const db=await database();
  try{
    await db.exec(await readFile(new URL('../supabase/migration-v3-signals.sql',import.meta.url),'utf8'));
    await db.exec(defectiveFunction);
    await db.exec(`insert into auth.users(id) values ('${A}'),('${B}'); grant usage on schema nico_fit_v3 to authenticated; grant select,insert,update on nico_fit_v3.daily_readiness,nico_fit_v3.football_sessions,nico_fit_v3.match_reviews to authenticated; set role authenticated; select set_config('request.jwt.claim.sub','${A}',false);`);
    await assert.rejects(
      db.exec(`insert into nico_fit_v3.daily_readiness(id,user_id,local_date,sleep,energy,freshness,pain) values('${READINESS}','${A}','${date}',4,4,4,0)`),
      error=>error.code==='42703'
    );
    await db.exec('reset role');
    const repair=await readFile(new URL('../supabase/migration-v3-signals-identity-guard-fix.sql',import.meta.url),'utf8');
    await db.exec(repair);
    await db.exec(repair);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${A}',false);`);
    await db.exec(`insert into nico_fit_v3.daily_readiness(id,user_id,local_date,sleep,energy,freshness,pain) values('${READINESS}','${A}','${date}',4,4,4,0)`);
    await db.exec(`insert into nico_fit_v3.football_sessions(id,user_id,local_date,session_type,duration_minutes,rpe) values('${MATCH}','${A}','${date}','match',90,8),('${TRAINING}','${A}','${date}','training',60,5)`);
    await db.exec(`insert into nico_fit_v3.match_reviews(id,user_id,local_date,football_session_id,energy,legs,performance) values('${REVIEW}','${A}','${date}','${MATCH}',4,4,4)`);
    await assert.rejects(db.exec(`insert into nico_fit_v3.match_reviews(id,user_id,local_date,football_session_id,energy,legs,performance) values(gen_random_uuid(),'${A}','${date}','${TRAINING}',4,4,4)`),error=>error.code==='23514');
    await assert.rejects(db.exec(`update nico_fit_v3.daily_readiness set version=2,user_id='${B}' where id='${READINESS}'`));
    await db.exec(`select set_config('request.jwt.claim.sub','${B}',false);`);
    assert.equal((await db.query(`select id from nico_fit_v3.daily_readiness where id='${READINESS}'`)).rows.length,0);
    await assert.rejects(db.exec(`insert into nico_fit_v3.football_sessions(id,user_id,local_date,session_type,duration_minutes,rpe) values(gen_random_uuid(),'${A}','${date}','match',90,8)`),error=>error.code==='42501');
  }finally{
    await db.close();
  }
});

test('clean canonical install twice supports every signal trigger shape',async()=>{
  const db=await database();
  try{
    const canonical=await readFile(new URL('../supabase/migration-v3-signals.sql',import.meta.url),'utf8');
    await db.exec(canonical);
    await db.exec(canonical);
    await db.exec(`insert into auth.users(id) values ('${A}'); grant usage on schema nico_fit_v3 to authenticated; grant select,insert,update on nico_fit_v3.daily_readiness,nico_fit_v3.football_sessions,nico_fit_v3.match_reviews to authenticated; set role authenticated; select set_config('request.jwt.claim.sub','${A}',false); insert into nico_fit_v3.daily_readiness(id,user_id,local_date,sleep,energy,freshness,pain) values('${READINESS}','${A}','${date}',4,4,4,0); insert into nico_fit_v3.football_sessions(id,user_id,local_date,session_type,duration_minutes,rpe) values('${MATCH}','${A}','${date}','match',90,8); insert into nico_fit_v3.match_reviews(id,user_id,local_date,football_session_id,energy,legs,performance) values('${REVIEW}','${A}','${date}','${MATCH}',4,4,4);`);
    assert.equal((await db.query('select count(*)::int as count from nico_fit_v3.daily_readiness')).rows[0].count,1);
    assert.equal((await db.query('select count(*)::int as count from nico_fit_v3.football_sessions')).rows[0].count,1);
    assert.equal((await db.query('select count(*)::int as count from nico_fit_v3.match_reviews')).rows[0].count,1);
  }finally{
    await db.close();
  }
});
