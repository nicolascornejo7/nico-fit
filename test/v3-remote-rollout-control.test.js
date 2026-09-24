import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';
import {SyncService} from '../js/sync.js';
import {mayStartNewWork} from '../js/pwa-update-gate.js';
import {collectPwaUpdateSafety} from '../js/pwa-update-safety.js';
import {V3RolloutControl,ROLLOUT_CACHE_KEY,fetchRolloutConfig} from '../js/v3/rollout-control.js';
import {EMPTY_FLAGS,resolveRollout,validateRolloutConfig} from '../js/v3/rollout-policy.js';
import {rolloutSnapshot,rolloutAllowsLocalTraining} from '../js/v3/rollout-state.js';
import {isV3TrainingEnabled,isV3SyncEnabled,isV3CoachEnabled,isV3SignalsSyncEnabled,isV3RoutinesSyncEnabled} from '../js/v3/feature-flags.js';

const row=(patch={})=>({singleton_id:true,config_version:1,minimum_client_version:'nico-fit-v18',maintenance_mode:false,...EMPTY_FLAGS,updated_at:'2026-09-21T00:00:00Z',...patch});
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
const control=(options={})=>new V3RolloutControl({buildId:'nico-fit-v18',storage:memory(),Channel:null,windowLike:null,...options});

test('rollout reader sends the publishable key as both API key and bearer token',async()=>{
  const requests=[];
  const fetchImpl=async(input,init={})=>{
    requests.push({input,headers:init.headers});
    if(String(input)==='/api/config')return {ok:true,json:async()=>({url:'https://tmydirzzlmlmtjgwqcgh.supabase.co',publishableKey:'sb_publishable_staging'})};
    return {ok:true,json:async()=>[row({config_version:11})]};
  };
  const config=await fetchRolloutConfig({fetchImpl});
  assert.equal(config.config_version,11);
  assert.equal(requests[1].headers.apikey,'sb_publishable_staging');
  assert.equal(requests[1].headers.Authorization,'Bearer sb_publishable_staging');
  assert.equal(requests[1].headers['Accept-Profile'],'nico_fit_v3');
});

test('valid singleton config requires exact booleans, version and timestamp',()=>{
  assert.equal(validateRolloutConfig(row()).config_version,1);
  for(const bad of [{singleton_id:false},{config_version:0},{v3_sync_enabled:'true'},{minimum_client_version:'latest'},{updated_at:'bad'}])assert.throws(()=>validateRolloutConfig(row(bad)));
});

test('flags are off by default and never enable one another',()=>{
  const off=resolveRollout(validateRolloutConfig(row()),{buildId:'nico-fit-v18'});
  assert.deepEqual(off.flags,EMPTY_FLAGS);
  const only=resolveRollout(validateRolloutConfig(row({v3_enabled:true,v3_training_enabled:true})),{buildId:'nico-fit-v18'});
  assert.equal(only.flags.v3_training_enabled,true);assert.equal(only.flags.v3_storage_enabled,false);assert.equal(only.flags.v3_sync_enabled,false);
});

test('minimum build permits equal version and blocks older or unknown clients',()=>{
  const config=validateRolloutConfig(row({v3_enabled:true,v3_storage_enabled:true,minimum_client_version:'nico-fit-v18'}));
  assert.equal(resolveRollout(config,{buildId:'nico-fit-v18'}).updateRequired,false);
  assert.equal(resolveRollout(config,{buildId:'nico-fit-v17'}).updateRequired,true);
  assert.equal(resolveRollout(config,{buildId:'unknown'}).flags.v3_storage_enabled,false);
});

test('valid remote read populates cache and effective flags; missing and invalid config fail closed',async()=>{
  const storage=memory(),manager=control({storage,fetchConfig:async()=>row({v3_enabled:true,v3_training_enabled:true})});
  try{await manager.start();assert.equal(manager.snapshot().source,'remote');assert.equal(isV3TrainingEnabled(),true);assert.equal(isV3SyncEnabled(),false);assert.equal(isV3CoachEnabled(),false);assert.ok(storage.getItem(ROLLOUT_CACHE_KEY));}
  finally{manager.stop();}
  const missing=control({fetchConfig:async()=>{throw new Error('missing');}});try{await missing.start();assert.equal(missing.snapshot().source,'fallback');assert.deepEqual(missing.snapshot().flags,EMPTY_FLAGS);}finally{missing.stop();}
  const invalid=control({fetchConfig:async()=>row({v3_sync_enabled:'yes'})});try{await invalid.start();assert.equal(invalid.snapshot().source,'fallback');}finally{invalid.stop();}
});

test('network failure preserves last-known-good local flags but blocks remote writes',async()=>{
  let now=100000,reads=0;const storage=memory();
  const first=control({storage,now:()=>now,ttlMs:1000,fetchConfig:async()=>{reads++;return row({v3_enabled:true,v3_sync_enabled:true});}});await first.start();first.stop();
  now+=500;const fresh=control({storage,now:()=>now,ttlMs:1000,fetchConfig:async()=>{throw new Error('offline');}});try{await fresh.start();assert.equal(fresh.snapshot().source,'stale-offline');assert.equal(fresh.snapshot().flags.v3_sync_enabled,true);assert.equal(fresh.snapshot().remoteWritesAllowed,false);assert.equal(fresh.snapshot().cacheAgeMs,500);}finally{fresh.stop();}
  now+=501;const expired=control({storage,now:()=>now,ttlMs:1000,fetchConfig:async()=>{throw new Error('timeout');}});try{await expired.start();assert.equal(expired.snapshot().source,'stale-offline');assert.equal(expired.snapshot().flags.v3_sync_enabled,true);assert.equal(expired.snapshot().remoteWritesAllowed,false);}finally{expired.stop();}
  assert.equal(reads,1);
});

test('an expired cache keeps an already-known minimum build restriction',async()=>{
  let now=100000;const storage=memory();const first=control({storage,now:()=>now,ttlMs:1000,buildId:'nico-fit-v17',fetchConfig:async()=>row()});await first.start();first.stop();
  now+=1001;const expired=control({storage,now:()=>now,ttlMs:1000,buildId:'nico-fit-v17',fetchConfig:async()=>{throw new Error('offline');}});
  try{await expired.start();assert.equal(expired.snapshot().source,'stale-offline');assert.equal(expired.snapshot().updateRequired,true);assert.deepEqual(expired.snapshot().flags,EMPTY_FLAGS);}finally{expired.stop();}
});

test('a nonresponding config request aborts at its timeout',async()=>{
  let aborted=false;
  await assert.rejects(fetchRolloutConfig({timeoutMs:10,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('aborted','AbortError'));}))}),/abort/i);
  assert.equal(aborted,true);
});

test('routine and signal flags do not implicitly enable their separate sync choices',async()=>{
  const manager=control({fetchConfig:async()=>row({v3_enabled:true,v3_sync_enabled:true,v3_signals_enabled:true,v3_routines_enabled:true})});
  try{await manager.start();assert.equal(isV3SignalsSyncEnabled(memory()),false);assert.equal(isV3RoutinesSyncEnabled(memory()),false);}finally{manager.stop();}
});

test('maintenance pauses remote work while preserving explicit local flags',()=>{
  const state=resolveRollout(validateRolloutConfig(row({v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:true,maintenance_mode:true})),{buildId:'nico-fit-v18'});
  assert.equal(state.flags.v3_storage_enabled,true);assert.equal(state.remoteWritesAllowed,false);assert.match(state.reason,/Mantenimiento/);
});

test('maintenance does not block local V3 training access',async()=>{
  const manager=control({fetchConfig:async()=>row({v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_sync_enabled:true,maintenance_mode:true})});
  try{await manager.start();assert.equal(rolloutAllowsLocalTraining(),true);assert.equal(rolloutSnapshot().remoteWritesAllowed,false);}finally{manager.stop();}
});

test('minimum build blocks new local records without deleting the existing queue',async()=>{
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:owner,featureEnabled:true});
  const manager=control({buildId:'nico-fit-v17',fetchConfig:async()=>row()});
  try{await manager.start();await assert.rejects(()=>repository.create('workout_sessions',{session_date:'2026-09-21',label:'Blocked',status:'completed'}),/Actualización requerida/);assert.equal((await repository.operationalSnapshot()).queue.operations,0);}finally{manager.stop();repository.close();}
});

test('minimum build and maintenance pause the V2 sync coordinator on the new client',async()=>{
  let config=row({maintenance_mode:true});const manager=control({fetchConfig:async()=>config});await manager.start();
  const states=[],service=new SyncService({getData:()=>({}),setData:()=>{},onState:(kind,text)=>states.push({kind,text})});
  try{assert.equal(await service.syncAll(),false);assert.match(states.at(-1).text,/pausada/);
    config=row({config_version:2,minimum_client_version:'nico-fit-v19'});await manager.refresh({force:true});assert.equal(mayStartNewWork(),false);assert.equal(await service.syncAll(),false);assert.match(states.at(-1).text,/Actualización requerida/);
  }finally{manager.stop();}
});

test('flag change during an active session preserves it and keeps the safe-update guard',async()=>{
  const indexedDB=new IDBFactory(),owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const repository=await V3LocalRepository.open({indexedDB,userId:owner,featureEnabled:true});
  const session=await repository.create('workout_sessions',{session_date:'2026-09-21',label:'Activa',status:'draft'});
  let config=row({v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true});const manager=control({fetchConfig:async()=>config});
  try{await manager.start();config=row({config_version:2,v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:false});await manager.refresh({force:true});assert.equal(isV3TrainingEnabled(),false);
    assert.equal((await repository.get('workout_sessions',session.id)).status,'draft');
    const safe=await collectPwaUpdateSafety({storage:memory(),indexedDB,userId:owner});assert.equal(safe.safe,false);assert.match(safe.reasons.join(),/sesión V3 activa/);
  }finally{manager.stop();repository.close();}
});

test('maintenance pauses and resumes queued remote sync without deleting local data',async()=>{
  let config=row({config_version:1,v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:true,maintenance_mode:true});const manager=control({fetchConfig:async()=>config});await manager.start();
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:owner,featureEnabled:true});
  try{await repository.create('workout_sessions',{session_date:'2026-09-21',label:'Local',status:'completed'});let calls=0;const engine=new V3SyncEngine({repository,remote:{authenticatedUserId:async()=>owner,fetchChanges:async()=>[],mutate:async operation=>{calls++;return {...operation.payload,id:operation.record_id,user_id:owner,version:1,updated_at:'2026-09-21T00:01:00Z',created_at:'2026-09-21T00:01:00Z',deleted_at:null};}},featureEnabled:true,locks:null});
    assert.equal((await engine.syncOnce()).skipped,'rollout_blocked');assert.equal(calls,0);assert.equal((await repository.operationalSnapshot()).counts.pending,1);
    config=row({config_version:2,v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:true});await manager.refresh({force:true});assert.equal((await engine.syncOnce()).pushed,1);assert.equal(calls,1);
  }finally{repository.close();manager.stop();}
});

test('kill switch keeps pending queue and resumes without duplicate after a remote toggle',async()=>{
  let config=row({v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:false});
  const manager=control({fetchConfig:async()=>config});await manager.start();
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:owner,featureEnabled:true});
  try{
    const saved=await repository.create('workout_sessions',{session_date:'2026-09-21',label:'Local',status:'completed'});
    let mutations=0;const remote={authenticatedUserId:async()=>owner,fetchChanges:async()=>[],mutate:async operation=>{mutations++;return {...operation.payload,id:operation.record_id,user_id:owner,version:1,updated_at:'2026-09-21T00:01:00Z',created_at:'2026-09-21T00:01:00Z',deleted_at:null};}};
    const engine=new V3SyncEngine({repository,remote,featureEnabled:true,locks:null,online:()=>true});
    assert.equal((await engine.syncOnce()).skipped,'rollout_blocked');assert.equal((await repository.operationalSnapshot()).counts.pending,1);
    config=row({config_version:2,v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:true});await manager.refresh({force:true});
    assert.equal((await engine.syncOnce()).pushed,1);assert.equal(mutations,1);assert.equal((await repository.get('workout_sessions',saved.id)).sync_status,'synced');
    config=row({config_version:3,v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:false});await manager.refresh({force:true});
    assert.equal((await engine.syncOnce()).skipped,'rollout_blocked');assert.equal(mutations,1);
  }finally{repository.close();manager.stop();}
});

test('two tabs share only the public cache and the latest version is observable',async()=>{
  let now=200000,config=row({v3_enabled:true,v3_observability_enabled:true});const storage=memory();
  const a=control({storage,now:()=>now,fetchConfig:async()=>config}),b=control({storage,now:()=>now,fetchConfig:async()=>{throw new Error('offline');}});
  try{await a.start();await b.start();assert.equal(b.snapshot().source,'stale-offline');assert.equal(b.snapshot().remoteWritesAllowed,false);assert.equal(rolloutSnapshot().configVersion,1);
    now+=500;config=row({config_version:2,v3_enabled:true,v3_observability_enabled:false});await a.refresh({force:true});b.consumeCache();assert.equal(b.snapshot().configVersion,2);assert.equal(b.snapshot().flags.v3_observability_enabled,false);
  }finally{b.stop();a.stop();}
});

test('rollout SQL is idempotent, anon read-only and versioned in isolated PostgreSQL',async()=>{
  const db=new PGlite();try{
    await db.exec("create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;");
    const sql=await readFile(new URL('../supabase/migration-v3-rollout-control.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
    assert.equal((await db.query('select count(*)::int as n from nico_fit_v3.rollout_config')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int as n from nico_fit_v3.rollout_config_history')).rows[0].n,1);
    await assert.rejects(()=>db.exec("update nico_fit_v3.rollout_config set v3_sync_enabled=true where singleton_id=true"),/version/i);
    await db.exec("update nico_fit_v3.rollout_config set config_version=2,v3_sync_enabled=true where singleton_id=true");
    assert.equal((await db.query('select count(*)::int as n from nico_fit_v3.rollout_config_history')).rows[0].n,2);
    await db.exec('set role anon');assert.equal(Number((await db.query('select config_version from nico_fit_v3.rollout_config')).rows[0].config_version),2);
    await assert.rejects(()=>db.exec("update nico_fit_v3.rollout_config set config_version=3"),/permission denied/);await db.exec('reset role');
  }finally{await db.close();}
});
