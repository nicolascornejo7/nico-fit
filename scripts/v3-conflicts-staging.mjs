import assert from 'node:assert/strict';
import {randomUUID,randomInt} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3SignalsRepository} from '../js/v3/signals-repository.js';
import {V3ConflictService} from '../js/v3/conflict-service.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';
import {SupabaseV3Adapter} from '../js/v3/supabase-v3-adapter.js';
import {withV3SyncLock} from '../js/v3/sync-lock.js';

const env=process.env,ref='tmydirzzlmlmtjgwqcgh',url=`https://${ref}.supabase.co`;
assert.equal(env.SUPABASE_STAGING_PROJECT_REF,ref,'Only nico-fit-v3-staging is allowed.');
assert.equal(env.SUPABASE_STAGING_URL,url,'Exact staging URL required.');
const key=env.SUPABASE_STAGING_PUBLISHABLE_KEY;assert.ok(key&&!key.startsWith('sb_secret_'),'Publishable key required.');
if(key.split('.').length===3)assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role,'anon','Service role forbidden.');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}};
const clients=[createClient(url,key,options),createClient(url,key,options)],anon=createClient(url,key,options),repositories=[];
const report={project:'nico-fit-v3-staging',ref,runId:randomUUID(),storage:'fake-indexeddb; real repository/sync/HTTP/RLS',steps:[]};
const date=new Date(Date.UTC(2040,0,1)+randomInt(100000)*86400000).toISOString().slice(0,10);
const ok=result=>{if(result.error)throw Object.assign(new Error(result.error.message),result.error,{status:result.status});return result.data;};
const table=(client,entity)=>client.schema('nico_fit_v3').from(entity);
async function step(name,task){try{const detail=await task();report.steps.push({name,status:'passed',detail});console.log(`PASS ${name}`);return detail;}catch(error){report.steps.push({name,status:'failed',error:error.message});throw error;}}
async function device(userId,client,indexedDB=new IDBFactory()){
  const repository=await V3LocalRepository.open({userId,indexedDB,featureEnabled:true});repositories.push(repository);
  return {repository,signals:new V3SignalsRepository({repository,featureEnabled:true}),service:new V3ConflictService({repository,locks:null}),remote:new SupabaseV3Adapter({client})};
}
const sync=device=>new V3SyncEngine({repository:device.repository,remote:device.remote,featureEnabled:true,signalsSyncEnabled:true,locks:null,pageSize:20,batchSize:100}).syncOnce();
const view=async(device,id)=>(await device.service.list()).find(row=>row.record_id===id);
async function editRemote(entity,id,patch){const row=ok(await table(clients[0],entity).select('*').eq('id',id).single());return ok(await table(clients[0],entity).update({...patch,version:row.version+1}).eq('id',id).select().single());}
const football={local_date:date,session_type:'training',duration_minutes:60,rpe:6,minutes_played:null,notes:`Conflict test ${report.runId}`};
let a,b,other,userA,userB;
try{
  await step('real Auth A/B and anon rejection',async()=>{const users=await Promise.all(clients.map((client,i)=>client.auth.signInWithPassword({email:env[`SUPABASE_STAGING_USER_${i?'B':'A'}_EMAIL`],password:env[`SUPABASE_STAGING_USER_${i?'B':'A'}_PASSWORD`]})));[userA,userB]=users.map(result=>ok(result).user.id);assert.notEqual(userA,userB);a=await device(userA,clients[0]);b=await device(userA,clients[0]);other=await device(userB,clients[1]);assert.equal((await table(anon,'football_sessions').select('id').limit(1)).error?.code,'42501');return {users:2,anonDenied:true};});
  await step('version conflict, accept remote, archives and audit, no loops',async()=>{
    const row=await a.signals.save('football_sessions',football);await sync(a);await sync(b);
    await b.signals.save('football_sessions',{...football,rpe:5},{id:row.id,expectedLocalRevision:1});const remote=await editRemote('football_sessions',row.id,{rpe:8});
    const stale=await table(clients[0],'football_sessions').update({version:remote.version,rpe:4}).eq('id',row.id).select();assert.equal(stale.status,409);assert.equal(stale.error.code,'PT409');
    await sync(b);const conflict=await view(b,row.id);assert.equal(conflict.status,'open');await b.service.resolve(conflict,'accept_remote');assert.equal((await b.repository.get('football_sessions',row.id)).rpe,8);assert.ok((await b.repository.listOperations()).some(op=>op.record_id===row.id&&op.status==='superseded'));
    for(let i=0;i<2;i++){await sync(b);assert.equal((await view(b,row.id)).status,'resolved');}return {http:409,audit:true,noLoops:true};
  });
  await step('keep local offline, new operation correct remote base, reconnect confirms, no loops',async()=>{
    const row=await a.signals.save('football_sessions',football);await sync(a);await sync(b);await b.signals.save('football_sessions',{...football,rpe:5},{id:row.id,expectedLocalRevision:1});const remote=await editRemote('football_sessions',row.id,{rpe:9});await sync(b);
    const audit=await b.service.resolve(await view(b,row.id),'keep_local'),op=(await b.repository.listOperations()).find(op=>audit.operation_ids.includes(op.operation_id));assert.equal(op.base_remote_version,remote.version);assert.equal(op.status,'pending');
    const online=b.remote;b.remote={authenticatedUserId:()=>online.authenticatedUserId(),fetchChanges:async()=>{throw new TypeError('Simulated offline');}};await assert.rejects(sync(b),/Simulated offline/);assert.equal((await view(b,row.id)).status,'resolution_pending');b.remote=online;await sync(b);
    assert.equal((await online.fetchById('football_sessions',row.id)).version,remote.version+1);assert.equal((await view(b,row.id)).status,'resolved');assert.equal((await b.service.history()).find(item=>item.id===audit.id).confirmation,'server_confirmed');for(let i=0;i<2;i++){await sync(b);assert.equal((await view(b,row.id)).status,'resolved');}return {base:remote.version,confirmed:remote.version+1,newOperation:op.operation_id,noLoops:true};
  });
  await step('remote tombstone vs local update cannot revive identity',async()=>{
    const row=await a.signals.save('football_sessions',football);await sync(a);await sync(b);await b.signals.save('football_sessions',{...football,rpe:5},{id:row.id,expectedLocalRevision:1});await editRemote('football_sessions',row.id,{deleted_at:new Date().toISOString()});await sync(b);const conflict=await view(b,row.id);assert.deepEqual(conflict.strategies,['defer','accept_remote']);await assert.rejects(b.service.resolve(conflict,'keep_local'));await b.service.resolve(conflict,'accept_remote');await sync(b);assert.ok((await b.repository.get('football_sessions',row.id)).deleted_at);assert.ok((await b.remote.fetchById('football_sessions',row.id)).deleted_at);return {revived:false};
  });
  await step('keep both only football session and new UUID confirms',async()=>{
    const row=await a.signals.save('football_sessions',football);await sync(a);await sync(b);await b.signals.save('football_sessions',{...football,rpe:5},{id:row.id,expectedLocalRevision:1});await editRemote('football_sessions',row.id,{rpe:9});await sync(b);const conflict=await view(b,row.id);assert.ok(conflict.strategies.includes('keep_both'));const audit=await b.service.resolve(conflict,'keep_both');assert.notEqual(audit.target_id,row.id);await sync(b);assert.equal((await b.remote.fetchById('football_sessions',audit.target_id)).rpe,5);assert.equal((await b.remote.fetchById('football_sessions',row.id)).rpe,9);assert.equal((await view(b,row.id)).status,'resolved');await sync(b);assert.equal((await view(b,row.id)).status,'resolved');return {newId:audit.target_id,noLoops:true};
  });
  await step('readiness, workout session and set never offer both',async()=>{
    const readiness=await a.signals.save('daily_readiness',{local_date:date,sleep:4,energy:4,freshness:4,pain:0});const session=await a.repository.create('workout_sessions',{session_date:date,label:'Conflict staging',status:'draft'});const exercise=await a.repository.create('session_exercises',{session_id:session.id,position:0,exercise_name_snapshot:'Staging custom',prescription_snapshot:{}});const set=await a.repository.create('exercise_sets',{session_exercise_id:exercise.id,position:0,reps:8,load_kg:30,rir:2,is_completed:false});await sync(a);await sync(b);
    for(const [entity,row,patch] of [['daily_readiness',readiness,{energy:2}],['workout_sessions',session,{notes:'remote note'}],['exercise_sets',set,{reps:10}]]){await b.repository.update(entity,row.id,entity==='daily_readiness'?{energy:3}:entity==='exercise_sets'?{reps:9}:{notes:'local note'});await editRemote(entity,row.id,patch);await sync(b);const conflict=await view(b,row.id);assert.ok(conflict&&!conflict.strategies.includes('keep_both'));await assert.rejects(b.service.resolve(conflict,'keep_both'));await b.service.resolve(conflict,'accept_remote');}
    return {readiness:false,workoutSessions:false,sets:false};
  });
  await step('two users RLS and local audit isolation',async()=>{
    const row=await a.signals.save('football_sessions',football);await sync(a);assert.deepEqual(ok(await table(clients[1],'football_sessions').select('id').eq('id',row.id)),[]);assert.deepEqual(ok(await table(clients[1],'football_sessions').update({rpe:1,version:2}).eq('id',row.id).select()),[]);assert.equal((await table(clients[1],'football_sessions').insert({id:randomUUID(),user_id:userA,...football})).error?.code,'42501');assert.equal((await other.service.history()).length,0);assert.equal(await other.repository.get('football_sessions',row.id),null);const own=await other.signals.save('football_sessions',football);await sync(other);assert.equal((await other.remote.fetchById('football_sessions',own.id)).user_id,userB);return {crossRead:false,crossWrite:false,ownWrite:true};
  });
  await step('two instances Web Locks plus lease cannot process same queue',async()=>{
    const database=new IDBFactory(),one=await device(userA,clients[0],database),two=await device(userA,clients[0],database),queued=await one.signals.save('football_sessions',football);let release,entered;const ready=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve),originalFetch=one.remote.fetchChanges.bind(one.remote);let gate=true;
    one.remote.fetchChanges=async(...args)=>{if(gate){gate=false;entered();await hold;}return originalFetch(...args);};
    const firstSync=new V3SyncEngine({repository:one.repository,remote:one.remote,featureEnabled:true,signalsSyncEnabled:true,locks:globalThis.navigator?.locks,pageSize:20,batchSize:100}).syncOnce();await ready;
    let result;try{result=await sync(two);assert.equal(result.skipped,'locked');}finally{release();}
    assert.equal((await firstSync).pushed,1);const resumed=await sync(two);assert.notEqual(resumed.skipped,'locked');assert.equal(resumed.pushed,0);assert.equal((await one.remote.fetchById('football_sessions',queued.id)).version,1);return {webLocksAvailable:!!globalThis.navigator?.locks,secondSkipped:true,leaseReleased:true,serverWrites:1,secondPushes:0};
  });
}finally{
  for(const repository of repositories)repository.close();await Promise.allSettled(clients.map(client=>client.auth.signOut()));await mkdir(new URL('../.tmp/',import.meta.url),{recursive:true});await writeFile(new URL('../.tmp/v3-conflicts-staging-result.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
