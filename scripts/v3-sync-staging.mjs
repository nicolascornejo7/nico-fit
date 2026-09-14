import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {SupabaseV3Adapter} from '../js/v3/supabase-v3-adapter.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';

const env=process.env,productionRef='xaklsoqyzwowtjwcpwmb',stagingRef='tmydirzzlmlmtjgwqcgh';
const required=['SUPABASE_STAGING_PROJECT_REF','SUPABASE_STAGING_URL','SUPABASE_STAGING_PUBLISHABLE_KEY','SUPABASE_STAGING_USER_A_EMAIL','SUPABASE_STAGING_USER_A_PASSWORD'];
for(const name of required)assert.ok(env[name],`Missing ${name}`);
assert.notEqual(env.SUPABASE_STAGING_PROJECT_REF,productionRef,'Production project is forbidden.');
assert.equal(env.SUPABASE_STAGING_PROJECT_REF,stagingRef,'This runner only targets nico-fit-v3-staging.');
assert.ok(env.SUPABASE_STAGING_URL.includes(stagingRef),'Staging URL and project ref do not match.');
assert.ok(!env.SUPABASE_STAGING_PUBLISHABLE_KEY.startsWith('sb_secret_'),'Secret/service keys are forbidden.');
if(env.SUPABASE_STAGING_PUBLISHABLE_KEY.split('.').length===3){
  const payload=JSON.parse(Buffer.from(env.SUPABASE_STAGING_PUBLISHABLE_KEY.split('.')[1],'base64url').toString('utf8'));
  assert.notEqual(payload.role,'service_role','Service-role JWT is forbidden.');
}

const client=createClient(env.SUPABASE_STAGING_URL,env.SUPABASE_STAGING_PUBLISHABLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}
});
const report={projectRef:env.SUPABASE_STAGING_PROJECT_REF,steps:[]};
const step=async(name,task)=>{const detail=await task();report.steps.push({name,status:'passed',detail});console.log(`PASS ${name}`);return detail;};

let repositoryA,repositoryB;
try{
  const auth=await client.auth.signInWithPassword({email:env.SUPABASE_STAGING_USER_A_EMAIL,password:env.SUPABASE_STAGING_USER_A_PASSWORD});
  assert.ifError(auth.error);const userId=auth.data.user.id,remote=new SupabaseV3Adapter({client,pageSize:2});
  repositoryA=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId,featureEnabled:true});
  repositoryB=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId,featureEnabled:true});
  const engineA=new V3SyncEngine({repository:repositoryA,remote,featureEnabled:true,locks:null,pageSize:2});
  const engineB=new V3SyncEngine({repository:repositoryB,remote,featureEnabled:true,locks:null,pageSize:2});
  const id=randomUUID();

  await step('paginated initial pull and offline insert',async()=>{
    await repositoryA.create('workout_sessions',{session_date:'2026-09-14',label:`Sync staging ${id.slice(0,8)}`,status:'draft',notes:''},{id});
    const result=await engineA.syncOnce(),row=await remote.fetchById('workout_sessions',id);
    assert.equal(row.version,1);assert.equal((await repositoryA.get('workout_sessions',id)).sync_status,'synced');return result;
  });
  await step('second device pulls the client UUID',async()=>{
    await engineB.syncOnce();assert.equal((await repositoryB.get('workout_sessions',id)).remote_version,1);return {id};
  });
  await step('offline update advances server version exactly once',async()=>{
    await repositoryA.update('workout_sessions',id,{label:`Updated ${id.slice(0,8)}`});await engineA.syncOnce();
    const row=await remote.fetchById('workout_sessions',id);assert.equal(row.version,2);return {version:row.version};
  });
  await step('same-entity device conflict persists locally',async()=>{
    await repositoryB.update('workout_sessions',id,{label:`Conflicting ${id.slice(0,8)}`});const result=await engineB.syncOnce();
    const [conflict]=await repositoryB.listConflicts();assert.equal(result.conflicts,1);assert.equal(conflict.remote_payload.version,2);return {reason:conflict.reason};
  });
  await step('soft delete remains a server tombstone',async()=>{
    await repositoryA.softDelete('workout_sessions',id);await engineA.syncOnce();const row=await remote.fetchById('workout_sessions',id);
    assert.equal(row.version,3);assert.ok(row.deleted_at);return {version:row.version,deletedAt:row.deleted_at};
  });
  await step('repeated sync is idempotent',async()=>{
    const before=await remote.fetchById('workout_sessions',id);await engineA.syncOnce();const after=await remote.fetchById('workout_sessions',id);
    assert.deepEqual(after,before);return {version:after.version};
  });
  await step('expired session is rejected before synchronization',async()=>{
    await client.auth.signOut();await assert.rejects(()=>engineA.syncOnce());return {rejected:true};
  });
}finally{
  repositoryA?.close();repositoryB?.close();await client.auth.signOut().catch(()=>{});console.log(JSON.stringify(report,null,2));
}
