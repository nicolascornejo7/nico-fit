import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';

const env=process.env;
const productionRef='xaklsoqyzwowtjwcpwmb';
const required=[
  'SUPABASE_STAGING_PROJECT_REF','SUPABASE_STAGING_URL','SUPABASE_STAGING_PUBLISHABLE_KEY',
  'SUPABASE_STAGING_USER_A_EMAIL','SUPABASE_STAGING_USER_A_PASSWORD',
  'SUPABASE_STAGING_USER_B_EMAIL','SUPABASE_STAGING_USER_B_PASSWORD'
];
for(const name of required)assert.ok(env[name],`Missing ${name}`);
assert.notEqual(env.SUPABASE_STAGING_PROJECT_REF,productionRef,'Production project is forbidden.');
assert.ok(env.SUPABASE_STAGING_URL.includes(env.SUPABASE_STAGING_PROJECT_REF));

const fetchWithTimeout=(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(15000)});
const options={
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:fetchWithTimeout}
};
const anon=createClient(env.SUPABASE_STAGING_URL,env.SUPABASE_STAGING_PUBLISHABLE_KEY,options);
const clientA=createClient(env.SUPABASE_STAGING_URL,env.SUPABASE_STAGING_PUBLISHABLE_KEY,options);
const clientB=createClient(env.SUPABASE_STAGING_URL,env.SUPABASE_STAGING_PUBLISHABLE_KEY,options);
const report={projectRef:env.SUPABASE_STAGING_PROJECT_REF,steps:[]};

async function step(name,fn){
  try{
    const detail=await fn();
    report.steps.push({name,status:'passed',detail});
    console.log(`PASS ${name}`);
  }catch(error){
    report.steps.push({name,status:'failed',error:error.message});
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}
const expectOk=result=>{if(result.error)throw result.error;return result.data;};

try{
  await step('anonymous V3 access is denied',async()=>{
    const result=await anon.schema('nico_fit_v3').from('workout_sessions').select('id').limit(1);
    assert.ok(result.error,'anon unexpectedly read V3');
    assert.notEqual(result.error.code,'PGRST106','V3 schema is not exposed through PostgREST');
    return {code:result.error.code};
  });

  await step('authenticate two real Supabase Auth users',async()=>{
    expectOk(await clientA.auth.signInWithPassword({email:env.SUPABASE_STAGING_USER_A_EMAIL,password:env.SUPABASE_STAGING_USER_A_PASSWORD}));
    expectOk(await clientB.auth.signInWithPassword({email:env.SUPABASE_STAGING_USER_B_EMAIL,password:env.SUPABASE_STAGING_USER_B_PASSWORD}));
  });

  await step('PostgREST schema visibility and pagination',async()=>{
    const result=await clientA.schema('nico_fit_v3').from('workout_sessions')
      .select('id,user_id,session_date,label',{count:'exact'}).order('session_date').range(0,1);
    const rows=expectOk(result);
    assert.equal(rows.length,2);
    assert.ok(result.count>=2);
    assert.ok(rows.every(row=>row.user_id==='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    return {pageSize:rows.length,ownerCount:result.count};
  });

  await step('RLS rejects cross-user reads and writes',async()=>{
    const bRows=expectOk(await clientB.schema('nico_fit_v3').from('workout_sessions').select('user_id'));
    assert.ok(bRows.length>=1);
    assert.ok(bRows.every(row=>row.user_id==='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    const cross=await clientA.schema('nico_fit_v3').from('workout_sessions').insert({
      id:randomUUID(),user_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',session_date:'2026-09-20',label:'Forbidden'
    });
    assert.ok(cross.error,'cross-user insert unexpectedly succeeded');
    return {writeCode:cross.error.code};
  });

  await step('multiple sessions and repeated exercise survive backfill',async()=>{
    const sessions=expectOk(await clientA.schema('nico_fit_v3').from('workout_sessions')
      .select('id').eq('session_date','2026-09-02'));
    assert.equal(sessions.length,2);
    const repeated=expectOk(await clientA.schema('nico_fit_v3').from('session_exercises')
      .select('id').eq('session_id','ec4e4cee-bf1d-4c38-5f44-a176e30fa430'));
    assert.equal(repeated.length,2);
  });

  await step('version conflicts and soft-delete resurrection are rejected',async()=>{
    const active=expectOk(await clientA.schema('nico_fit_v3').from('workout_sessions')
      .select('id,label,version').is('deleted_at',null).order('created_at').limit(1).single());
    const nextVersion=active.version+1;
    expectOk(await clientA.schema('nico_fit_v3').from('workout_sessions')
      .update({label:active.label,version:nextVersion}).eq('id',active.id));
    const stale=await clientA.schema('nico_fit_v3').from('workout_sessions')
      .update({label:'Stale',version:nextVersion}).eq('id',active.id);
    assert.equal(stale.error?.code,'PT409');
    const jump=await clientA.schema('nico_fit_v3').from('workout_sessions')
      .update({label:'Jump',version:nextVersion+2}).eq('id',active.id);
    assert.equal(jump.error?.code,'PT409');

    const tombstoneId='f3000000-0000-4000-8000-000000000001';
    const existing=expectOk(await clientA.schema('nico_fit_v3').from('workout_sessions')
      .select('id,version,deleted_at').eq('id',tombstoneId).maybeSingle());
    let tombstone=existing;
    if(!tombstone){
      expectOk(await clientA.schema('nico_fit_v3').from('workout_sessions').insert({
        id:tombstoneId,user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',session_date:'2026-09-21',label:'JS tombstone',version:1
      }));
      expectOk(await clientA.schema('nico_fit_v3').from('workout_sessions')
        .update({deleted_at:new Date().toISOString(),version:2}).eq('id',tombstoneId));
      tombstone={version:2,deleted_at:'created'};
    }
    assert.ok(tombstone.deleted_at);
    const resurrect=await clientA.schema('nico_fit_v3').from('workout_sessions')
      .update({deleted_at:null,version:tombstone.version+1}).eq('id',tombstoneId);
    assert.equal(resurrect.error?.code,'55000');
    return {stale:stale.error.code,jump:jump.error.code,resurrection:resurrect.error.code};
  });

  await step('backfill mappings and tombstones match PGlite',async()=>{
    const [sessions,workouts,sets]=await Promise.all([
      clientA.schema('nico_fit_v3').from('v2_workout_session_map').select('migration_status'),
      clientA.schema('nico_fit_v3').from('v2_workout_map').select('migration_status'),
      clientA.schema('nico_fit_v3').from('v2_set_map').select('migration_status')
    ]);
    const s=expectOk(sessions),w=expectOk(workouts),x=expectOk(sets);
    assert.equal(s.length,8);
    assert.equal(w.length,7);
    assert.equal(x.length,7);
    assert.equal(s.filter(row=>row.migration_status==='pending_review').length,1);
    assert.equal(w.filter(row=>row.migration_status==='skipped').length,2);
    assert.equal(x.filter(row=>row.migration_status==='pending_review').length,2);
    return {ownerA:{sessionMappings:s.length,workoutMappings:w.length,setMappings:x.length}};
  });
}finally{
  await Promise.allSettled([clientA.auth.signOut(),clientB.auth.signOut()]);
  console.log(JSON.stringify(report,null,2));
}
