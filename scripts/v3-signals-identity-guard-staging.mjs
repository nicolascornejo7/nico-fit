import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';

const {Client}=pg;
const env=process.env;
const projectRef='tmydirzzlmlmtjgwqcgh';
const projectUrl=`https://${projectRef}.supabase.co`;
assert.equal(env.SUPABASE_STAGING_PROJECT_REF,projectRef,'Exact staging project ref required.');
assert.equal(env.SUPABASE_STAGING_URL,projectUrl,'Exact staging URL required.');
assert.ok(env.SUPABASE_STAGING_DATABASE_URL,'Staging database URL required.');
assert.ok(env.SUPABASE_STAGING_DATABASE_URL.includes(projectRef),'Database URL must identify nico-fit-v3-staging.');
assert.ok(!env.SUPABASE_STAGING_DATABASE_URL.includes('xaklsoqyzwowtjwcpwmb'),'Production database URL is forbidden.');
const key=env.SUPABASE_STAGING_PUBLISHABLE_KEY;
assert.ok(key&&!key.startsWith('sb_secret_'),'Staging publishable key required; secret keys are forbidden.');
for(const label of ['A','B'])for(const field of ['EMAIL','PASSWORD'])assert.ok(env[`SUPABASE_STAGING_USER_${label}_${field}`],`Missing staging test user ${label} ${field}.`);

const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}};
const a=createClient(projectUrl,key,options),b=createClient(projectUrl,key,options),anon=createClient(projectUrl,key,options);
const database=new Client({connectionString:env.SUPABASE_STAGING_DATABASE_URL,ssl:{rejectUnauthorized:false},statement_timeout:30000,query_timeout:30000});
const ids={readiness:randomUUID(),match:randomUUID(),training:randomUUID(),review:randomUUID(),otherFootball:randomUUID()};
const counts=async()=>{const {rows:[row]}=await database.query(`select (select count(*)::int from nico_fit_v3.daily_readiness) as daily_readiness,(select count(*)::int from nico_fit_v3.football_sessions) as football_sessions,(select count(*)::int from nico_fit_v3.match_reviews) as match_reviews`);return row;};
const table=(client,name)=>client.schema('nico_fit_v3').from(name);
const ok=result=>{if(result.error)throw Object.assign(new Error(result.error.message),result.error,{status:result.status});return result.data;};
const report={projectRef,steps:[]};
const step=async(name,fn)=>{const detail=await fn();report.steps.push({name,status:'PASS',detail});console.log(`PASS ${name}`);};
let userA,userB,date,before;
try{
  await database.connect();
  before=await counts();
  const migration=await readFile(new URL('../supabase/migration-v3-signals-identity-guard-fix.sql',import.meta.url),'utf8');
  await step('migration applies twice',async()=>{await database.query(migration);await database.query(migration);const {rows}=await database.query(`select pg_get_functiondef('nico_fit_v3.signals_identity_guard()'::regprocedure) as definition`);assert.match(rows[0].definition,/to_jsonb\(new\)/i);return {idempotent:true};});
  await step('two authenticated staging users',async()=>{userA=ok(await a.auth.signInWithPassword({email:env.SUPABASE_STAGING_USER_A_EMAIL,password:env.SUPABASE_STAGING_USER_A_PASSWORD})).user.id;userB=ok(await b.auth.signInWithPassword({email:env.SUPABASE_STAGING_USER_B_EMAIL,password:env.SUPABASE_STAGING_USER_B_PASSWORD})).user.id;assert.notEqual(userA,userB);const used=(await database.query(`select local_date::text from nico_fit_v3.daily_readiness where user_id=$1`,[userA])).rows.map(row=>row.local_date);for(let day=1;day<=365;day++){const candidate=new Date(Date.UTC(2098,0,day)).toISOString().slice(0,10);if(!used.includes(candidate)){date=candidate;break;}}assert.ok(date);return {distinctUsers:true};});
  await step('anon remains denied',async()=>{for(const name of ['daily_readiness','football_sessions','match_reviews'])assert.equal((await table(anon,name).select('id').limit(1)).error?.code,'42501');return {tables:3};});
  await step('valid inserts for every signal shape',async()=>{
    ok(await table(a,'daily_readiness').insert({id:ids.readiness,user_id:userA,local_date:date,sleep:4,energy:4,freshness:4,pain:0}).select('id').single());
    ok(await table(a,'football_sessions').insert([{id:ids.match,user_id:userA,local_date:date,session_type:'match',duration_minutes:90,rpe:8},{id:ids.training,user_id:userA,local_date:date,session_type:'training',duration_minutes:60,rpe:5}]).select('id'));
    ok(await table(a,'match_reviews').insert({id:ids.review,user_id:userA,local_date:date,football_session_id:ids.match,energy:4,legs:4,performance:4}).select('id').single());
    return {dailyReadiness:true,footballSession:true,matchReview:true};
  });
  await step('relationship and immutable identity guards',async()=>{const invalidParent=await table(a,'match_reviews').insert({id:randomUUID(),user_id:userA,local_date:date,football_session_id:ids.training,energy:4,legs:4,performance:4});assert.equal(invalidParent.error?.code,'23514');const immutable=await table(a,'daily_readiness').update({version:2,local_date:'2099-12-31'}).eq('id',ids.readiness).select('id');assert.equal(immutable.error?.code,'23514');return {invalidParent:'23514',immutableIdentity:'23514'};});
  await step('RLS ownership and cross-user isolation',async()=>{for(const [name,id] of [['daily_readiness',ids.readiness],['football_sessions',ids.match],['match_reviews',ids.review]])assert.deepEqual(ok(await table(b,name).select('id').eq('id',id)),[]);const forged=await table(b,'football_sessions').insert({id:randomUUID(),user_id:userA,local_date:date,session_type:'match',duration_minutes:90,rpe:8});assert.equal(forged.error?.code,'42501');ok(await table(b,'football_sessions').insert({id:ids.otherFootball,user_id:userB,local_date:date,session_type:'match',duration_minutes:90,rpe:8}));const crossParent=await table(b,'match_reviews').insert({id:randomUUID(),user_id:userB,local_date:date,football_session_id:ids.match,energy:4,legs:4,performance:4});assert.ok(crossParent.error);return {crossRead:false,forgedOwner:'42501',crossParentRejected:true};});
}finally{
  if(database._connected){
    await database.query('begin');
    try{
      await database.query('delete from nico_fit_v3.match_reviews where id=$1',[ids.review]);
      await database.query('delete from nico_fit_v3.football_sessions where id=any($1::uuid[])',[[ids.match,ids.training,ids.otherFootball]]);
      await database.query('delete from nico_fit_v3.daily_readiness where id=$1',[ids.readiness]);
      await database.query('commit');
    }catch(error){await database.query('rollback');throw error;}
    const after=await counts();
    assert.deepEqual(after,before,'Staging functional counts must match after fixture cleanup.');
    report.before=before;report.after=after;report.cleanup='PASS';
    await database.end();
  }
  await Promise.allSettled([a.auth.signOut(),b.auth.signOut()]);
}
console.log(JSON.stringify(report,null,2));
