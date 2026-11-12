import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3RoutineService} from '../js/v3/routine-service.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';
import {pullV3Repository} from '../js/v3/sync-runtime.js';
import {bootstrapV3Repository} from '../js/v3/bootstrap.js';
import {V3RecoveryError,V3_RECOVERY_TIMEOUT_MS,recoveryError,recoveryUserMessage,runV3Recovery} from '../js/v3/recovery.js';
import {withV3SyncLock} from '../js/v3/sync-lock.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAMP='2026-10-01T10:00:00.000Z';
const URL_OK='https://xaklsoqyzwowtjwcpwmb.supabase.co';
const FLAGS={source:'remote',updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:true,v3_routines_enabled:true}};
const never=signal=>new Promise((_,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));

class Remote{
  constructor(){this.rows=new Map();this.reads=0;this.mutations=0;this.fail=null;this.hang=false;this.signalAware=true;}
  add(entity,row){if(!this.rows.has(entity))this.rows.set(entity,new Map());this.rows.get(entity).set(row.id,structuredClone(row));}
  async authenticatedUserId(){return USER;}
  async fetchChanges(entity,{cursor,pageSize}){
    this.reads++;
    if(this.hang)return new Promise(()=>{});
    if(this.fail)throw this.fail;
    return [...(this.rows.get(entity)?.values()??[])].filter(row=>!cursor||row.updated_at>cursor.updatedAt||row.updated_at===cursor.updatedAt&&row.id>cursor.id)
      .sort((a,b)=>a.updated_at.localeCompare(b.updated_at)||a.id.localeCompare(b.id)).slice(0,pageSize).map(row=>structuredClone(row));
  }
  async mutate(){this.mutations++;throw new Error('recovery must never push');}
}

async function fixture({seed=false}={}){
  const reset=installRolloutControl({snapshot:()=>FLAGS,refreshIfDue:async()=>FLAGS});
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  if(seed)await new V3RoutineService({repository,featureEnabled:true}).seedDefaults();
  const remote=new Remote(),engine=new V3SyncEngine({repository,remote,featureEnabled:true,routinesSyncEnabled:true,locks:null,pageSize:50});
  const counters={seeds:0},traces=[];
  const bootstrap=(extra={})=>bootstrapV3Repository(repository,{online:()=>true,pullOnly:options=>engine.pullOnly(options),routinesEnabled:()=>true,seedDefaults:async()=>{counters.seeds++;},onRecoveryTrace:entry=>traces.push(entry),recoveryTimeoutMs:2000,...extra});
  const snapshot=async()=>({state:(await repository.getBootstrapState()).state,operations:(await repository.listOperations()).map(op=>`${op.id}:${op.status}`).sort(),catalog:(await repository.listRecords('exercise_catalog',{includeDeleted:true})).length});
  return {repository,remote,engine,counters,traces,bootstrap,snapshot,close(){reset();repository.close();}};
}

const catalogRow=()=>({id:crypto.randomUUID(),owner_user_id:USER,stable_key:`remote-${crypto.randomUUID()}`,canonical_name:'Remote press',measurement_kind:'reps',metadata:{},version:1,created_at:STAMP,updated_at:STAMP,deleted_at:null});

async function assertPendingUntouched(f,before){
  const after=await f.snapshot();
  assert.equal(after.state,'pending');
  assert.deepEqual(after.operations,before.operations);
  assert.equal(after.catalog,before.catalog);
  assert.equal(f.counters.seeds,0);
  assert.equal(f.remote.mutations,0);
}

test('timeout is centralised and not aggressive for slow mobile networks',()=>{
  assert.ok(V3_RECOVERY_TIMEOUT_MS>=30000&&V3_RECOVERY_TIMEOUT_MS<=60000);
});

test('1. normal recovery pulls, hydrates, seeds once and traces only safe fields',async()=>{
  const f=await fixture();f.remote.add('exercise_catalog',catalogRow());
  try{
    const result=await f.bootstrap();
    assert.equal(result.status,'hydrated');assert.equal(f.counters.seeds,1);assert.equal(f.remote.mutations,0);
    assert.equal((await f.repository.getBootstrapState()).state,'hydrated');
    const stages=f.traces.map(entry=>entry.stage);
    for(const stage of ['recovery:start','pull:start','pull:entity:exercise_catalog','reconcile:start','reconcile:done','pull:entity:done:exercise_catalog','hydrate:start','hydrate:done','recovery:complete'])assert.ok(stages.includes(stage),stage);
    assert.ok(stages.indexOf('hydrate:done')>stages.indexOf('pull:start'));
    for(const entry of f.traces)assert.deepEqual(Object.keys(entry).sort(),['code','durationMs','entity','stage']);
  }finally{f.close();}
});

test('2+3. a remote pull that never settles times out, releases single-flight and lease, and a retry completes',async()=>{
  const f=await fixture({seed:true});const before=await f.snapshot();
  try{
    f.remote.hang=true;
    await assert.rejects(f.bootstrap({recoveryTimeoutMs:20}),error=>error instanceof V3RecoveryError&&error.code==='RECOVERY_TIMEOUT'&&error.retryable);
    await assertPendingUntouched(f,before);
    assert.ok(f.traces.some(entry=>entry.stage==='recovery:error'&&entry.code==='RECOVERY_TIMEOUT'));
    // Lease was released: a fresh lease can be taken immediately.
    assert.equal(await f.repository.acquireLease(`nico-fit-v3-sync:${USER}`,'probe',{ttlMs:1000}),true);
    await f.repository.releaseLease(`nico-fit-v3-sync:${USER}`,'probe');
    f.remote.hang=false;f.remote.add('exercise_catalog',catalogRow());
    const retried=await f.bootstrap();
    assert.equal(retried.status,'hydrated');assert.equal(f.counters.seeds,1);assert.equal(f.remote.mutations,0);
    assert.deepEqual((await f.snapshot()).operations,before.operations);
  }finally{f.close();}
});

test('2b. abort reaches an abortable pull and the Web Lock callback settles',async()=>{
  let aborted=0,held=false;
  const locks={request:async(_name,_options,callback)=>{held=true;try{return await callback({});}finally{held=false;}}};
  const repository={acquireLease:async()=>true,renewLease:async()=>{},releaseLease:async()=>{}};
  await assert.rejects(runV3Recovery(recovery=>withV3SyncLock({repository,userId:USER,locks,signal:recovery.signal,task:()=>never(recovery.signal).catch(error=>{aborted++;throw error;})}),{timeoutMs:15}),error=>error.code==='RECOVERY_TIMEOUT');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(aborted,1);assert.equal(held,false);
});

const runtimeOptions=(overrides={})=>({online:()=>true,storageEnabled:()=>true,syncEnabled:()=>true,refreshRollout:async()=>({source:'remote',remoteWritesAllowed:true}),fetchConfig:async()=>({url:URL_OK,publishableKey:'sb_publishable_fixture'}),loadSdk:async()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:USER}},error:null})}})}),Adapter:class{},Engine:class{async pullOnly(){return {pulled:0};}},...overrides});

test('4. configuration timeout is recoverable and a retry passes configuration',async()=>{
  let attempts=0;
  const fetchConfig=({signal})=>++attempts===1?never(signal):Promise.resolve({url:URL_OK,publishableKey:'sb_publishable_fixture'});
  const run=()=>runV3Recovery(recovery=>pullV3Repository({userId:USER},runtimeOptions({fetchConfig,recovery,signal:recovery.signal})),{timeoutMs:15});
  await assert.rejects(run(),error=>error.code==='RECOVERY_TIMEOUT'&&error.stage==='config:start');
  assert.deepEqual(await run(),{pulled:0});
  const failed=await run().then(()=>null,error=>error);assert.equal(failed,null);
  await assert.rejects(runV3Recovery(recovery=>pullV3Repository({userId:USER},runtimeOptions({fetchConfig:async()=>{throw new Error('Config pública no disponible.');},recovery})),{timeoutMs:100}),error=>error.code==='RECOVERY_CONFIG');
});

test('5. Auth timeout during recovery never signs out or destroys the client',async()=>{
  let signOuts=0,clients=0;
  const loadSdk=async()=>({createClient:()=>{clients++;return {auth:{getUser:()=>new Promise(()=>{}),signOut:async()=>{signOuts++;}}};}});
  await assert.rejects(runV3Recovery(recovery=>pullV3Repository({userId:USER},runtimeOptions({loadSdk,recovery,signal:recovery.signal})),{timeoutMs:15}),error=>error.code==='RECOVERY_TIMEOUT'&&error.stage==='auth:start');
  assert.equal(clients,1);assert.equal(signOuts,0);
  await assert.rejects(runV3Recovery(recovery=>pullV3Repository({userId:USER},runtimeOptions({loadSdk:async()=>({createClient:()=>({auth:{getUser:async()=>({data:null,error:{message:'jwt expired'}}),signOut:async()=>{signOuts++;}}})}),recovery})),{timeoutMs:100}),error=>error.code==='RECOVERY_AUTH');
  assert.equal(signOuts,0);
});

for(const [status,code] of [[401,'RECOVERY_AUTH'],[403,'RECOVERY_AUTH'],[404,'RECOVERY_REMOTE'],[500,'RECOVERY_REMOTE'],[503,'RECOVERY_REMOTE']]){
  test(`6. remote ${status} rejects as ${code}, keeps pending and allows retry`,async()=>{
    const f=await fixture({seed:true});const before=await f.snapshot();
    try{
      f.remote.fail=Object.assign(new Error(`HTTP ${status}`),{status});
      await assert.rejects(f.bootstrap(),error=>error.code===code&&!/HTTP/.test(error.message));
      await assertPendingUntouched(f,before);
      f.remote.fail=null;
      assert.equal((await f.bootstrap()).status,'hydrated');
    }finally{f.close();}
  });
}

test('7. failed reconcile keeps pending, no seed, no push, and retry works',async()=>{
  const f=await fixture({seed:true});f.remote.add('exercise_catalog',catalogRow());const before=await f.snapshot();
  const original=f.repository.applyRemoteRecord.bind(f.repository);let fail=true;
  f.repository.applyRemoteRecord=async(...args)=>{if(fail)throw new Error('reconcile exploded');return original(...args);};
  try{
    await assert.rejects(f.bootstrap(),error=>error.code==='RECOVERY_RECONCILE');
    await assertPendingUntouched(f,before);
    fail=false;assert.equal((await f.bootstrap()).status,'hydrated');
  }finally{f.close();}
});

test('8. IndexedDB failure keeps pending, no seed, no push, and retry works',async()=>{
  const f=await fixture({seed:true});f.remote.add('exercise_catalog',catalogRow());const before=await f.snapshot();
  const original=f.repository.setSyncCheckpoint.bind(f.repository);let fail=true;
  f.repository.setSyncCheckpoint=async(...args)=>{if(fail)throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});return original(...args);};
  try{
    await assert.rejects(f.bootstrap(),error=>error.code==='RECOVERY_INDEXEDDB');
    const after=await f.snapshot();assert.equal(after.state,'pending');assert.deepEqual(after.operations,before.operations);assert.equal(f.counters.seeds,0);assert.equal(f.remote.mutations,0);
    fail=false;assert.equal((await f.bootstrap()).status,'hydrated');
  }finally{f.close();}
});

test('9. a busy lock returns pending promptly instead of waiting',async()=>{
  const f=await fixture({seed:true});const before=await f.snapshot();
  try{
    assert.equal(await f.repository.acquireLease(`nico-fit-v3-sync:${USER}`,'other-tab',{ttlMs:60000}),true);
    const started=Date.now(),result=await f.bootstrap({recoveryTimeoutMs:5000});
    assert.deepEqual(result,{status:'pending',reason:'locked'});assert.ok(Date.now()-started<1000);
    await assertPendingUntouched(f,before);
    await f.repository.releaseLease(`nico-fit-v3-sync:${USER}`,'other-tab');
    assert.equal((await f.bootstrap()).status,'hydrated');
  }finally{f.close();}
});

test('10. new database with an empty server completes',async()=>{
  const f=await fixture();
  try{assert.equal((await f.bootstrap()).status,'hydrated');assert.equal(f.counters.seeds,1);assert.equal(f.remote.mutations,0);}finally{f.close();}
});

test('11. existing pending database with remote data recovers and completes',async()=>{
  const f=await fixture({seed:true});const before=await f.snapshot();
  for(let index=0;index<3;index++)f.remote.add('exercise_catalog',catalogRow());
  try{
    assert.equal((await f.bootstrap()).status,'hydrated');
    assert.equal((await f.snapshot()).catalog,before.catalog+3);assert.equal(f.remote.mutations,0);
  }finally{f.close();}
});

test('12. offline then online: first attempt is recoverable, second completes',async()=>{
  const f=await fixture({seed:true});const before=await f.snapshot();
  try{
    assert.deepEqual(await f.bootstrap({online:()=>false}),{status:'pending',reason:'offline'});
    f.remote.fail=new TypeError('Failed to fetch');
    await assert.rejects(f.bootstrap(),error=>error.code==='RECOVERY_NETWORK'&&recoveryUserMessage(error).includes('conexión'));
    await assertPendingUntouched(f,before);
    f.remote.fail=null;assert.equal((await f.bootstrap()).status,'hydrated');
  }finally{f.close();}
});

test('13. a timeout leaves sessions, operations and local data intact and never pushes',async()=>{
  const f=await fixture({seed:true});const before=await f.snapshot();
  try{
    f.remote.hang=true;
    for(let attempt=0;attempt<3;attempt++)await assert.rejects(f.bootstrap({recoveryTimeoutMs:10}),error=>error.code==='RECOVERY_TIMEOUT');
    await assertPendingUntouched(f,before);
    assert.equal((await f.repository.listRecords('workout_sessions',{includeDeleted:true})).length,0);
  }finally{f.close();}
});

test('late hydration after abort is honoured as success and still seeds',async()=>{
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});let seeds=0;
  try{
    const pullOnly=async({signal})=>{await repository.markBootstrapHydrated();await never(signal);};
    const result=await bootstrapV3Repository(repository,{online:()=>true,pullOnly,routinesEnabled:()=>true,seedDefaults:async()=>{seeds++;},recoveryTimeoutMs:15});
    assert.equal(result.status,'hydrated');assert.equal(seeds,1);
  }finally{repository.close();}
});

test('structured errors never expose internal messages',()=>{
  const error=recoveryError(Object.assign(new Error('token=secret-value'),{status:500}),{stage:'pull:page'});
  assert.equal(error.code,'RECOVERY_REMOTE');assert.ok(!error.message.includes('secret'));
});
