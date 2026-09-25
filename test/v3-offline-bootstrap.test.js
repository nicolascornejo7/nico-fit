import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';
import {V3RolloutControl} from '../js/v3/rollout-control.js';
import {cachedV3Identity} from '../js/v3/offline-auth.js';
import {fetchPublicConfig,PUBLIC_CONFIG_CACHE_KEY} from '../js/v3/public-config.js';
import {SyncService} from '../js/sync.js';
import {reconnectV3Auth} from '../js/v3/auth-reconnect.js';
import {syncV3Repository} from '../js/v3/sync-runtime.js';

const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
const config=(version=1,patch={})=>({singleton_id:true,config_version:version,minimum_client_version:'nico-fit-v30',maintenance_mode:false,updated_at:'2026-09-22T00:00:00Z',...Object.fromEntries(['v3_enabled','v3_storage_enabled','v3_signals_enabled','v3_routines_enabled','v3_training_enabled','v3_sync_enabled','v3_conflicts_enabled','v3_observability_enabled','v3_coach_enabled'].map(name=>[name,false])),v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_sync_enabled:true,...patch});
const control=(storage,fetchConfig)=>new V3RolloutControl({storage,fetchConfig,buildId:'nico-fit-v30',Channel:null,windowLike:null,ttlMs:1000});

test('online public config and SDK session identify the same user after two offline reopens without copying tokens',async()=>{
  const storage=memory();
  await fetchPublicConfig({storage,fetchImpl:async()=>({ok:true,json:async()=>({url:'https://tmydirzzlmlmtjgwqcgh.supabase.co',publishableKey:'sb_publishable_staging'})})});
  storage.setItem('sb-tmydirzzlmlmtjgwqcgh-auth-token',JSON.stringify({access_token:'sdk-owned-token',expires_at:2000000000,user:{id:userId,email:'local@example.test'}}));
  for(let reopen=0;reopen<2;reopen++)assert.deepEqual(cachedV3Identity(storage),{id:userId,email:'local@example.test',source:'offline-local'});
  assert.doesNotMatch(storage.getItem(PUBLIC_CONFIG_CACHE_KEY),/sdk-owned-token|access_token|refresh_token/);
});

test('no cached session or public config means no offline identity',()=>{
  const storage=memory();assert.equal(cachedV3Identity(storage),null);
  storage.setItem(PUBLIC_CONFIG_CACHE_KEY,JSON.stringify({url:'https://tmydirzzlmlmtjgwqcgh.supabase.co',publishableKey:'sb_publishable_staging'}));
  assert.equal(cachedV3Identity(storage),null);
  storage.setItem('sb-tmydirzzlmlmtjgwqcgh-auth-token','broken');assert.equal(cachedV3Identity(storage),null);
});

test('offline reopens retain local training and queue; reconnect checks new minimum/maintenance before sync',async()=>{
  const storage=memory(),indexedDB=new IDBFactory();let remote=config(),online=true;
  let manager=control(storage,async()=>{if(!online)throw new Error('offline');return remote;});
  await manager.start();manager.stop();online=false;
  const repository=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  try{
    for(let reopen=0;reopen<2;reopen++){
      manager=control(storage,async()=>{throw new Error('offline');});await manager.start();
      assert.equal(manager.snapshot().source,'stale-offline');assert.equal(manager.snapshot().flags.v3_training_enabled,true);assert.equal(manager.snapshot().flags.v3_storage_enabled,true);assert.equal(manager.snapshot().remoteWritesAllowed,false);
      manager.stop();
    }
    await repository.create('workout_sessions',{session_date:'2026-09-22',label:'Offline',status:'completed'});
    let mutations=0,authReads=0;
    manager=control(storage,async()=>{if(!online)throw new Error('offline');return remote;});await manager.start();
    const engine=new V3SyncEngine({repository,featureEnabled:true,locks:null,online:()=>online,remote:{authenticatedUserId:async()=>{authReads++;return userId;},fetchChanges:async()=>[],mutate:async operation=>{mutations++;return {...operation.payload,id:operation.record_id,user_id:userId,version:1,updated_at:'2026-09-22T01:00:00Z',created_at:'2026-09-22T01:00:00Z',deleted_at:null};}}});
    assert.equal((await engine.syncOnce()).skipped,'rollout_blocked');assert.equal(mutations,0);
    online=true;remote=config(2,{minimum_client_version:'nico-fit-v31'});
    assert.equal((await engine.syncOnce()).skipped,'rollout_blocked');assert.equal(manager.snapshot().updateRequired,true);assert.equal(authReads,0);
    remote=config(3,{maintenance_mode:true});await manager.refresh({force:true});assert.equal((await engine.syncOnce()).skipped,'rollout_blocked');assert.equal(mutations,0);
    remote=config(4);await manager.refresh({force:true});assert.equal((await engine.syncOnce()).pushed,1);assert.equal(mutations,1);assert.equal(authReads,1);
  }finally{manager.stop();repository.close();}
});

test('V3 entry guards offline login before any null client auth call',async()=>{
  const entry=await readFile(new URL('../js/v3/training-entry.js',import.meta.url),'utf8');
  assert.match(entry,/stopImmediatePropagation\(\)/);
  assert.match(entry,/cachedV3Identity\(\)/);
  assert.doesNotMatch(entry,/this\.client\.auth/);
  const auth=new SyncService({getData:()=>({}),setData:()=>{},onState:()=>{}});
  await assert.rejects(()=>auth.signIn('test@example.test','password'),/Sin conexión con Auth/);
  await assert.rejects(()=>auth.signUp('test@example.test','password'),/Sin conexión con Auth/);
});

test('offline client reconnects to the same persisted session, validates Auth, then permits sync',async()=>{
  const storage=memory(),order=[],users=[];
  storage.setItem(PUBLIC_CONFIG_CACHE_KEY,JSON.stringify({url:'https://tmydirzzlmlmtjgwqcgh.supabase.co',publishableKey:'sb_publishable_staging'}));
  const client={auth:{getSession:async()=>{order.push('session');return {data:{session:{user:{id:userId}}},error:null};},getUser:async()=>{order.push('verify');return {data:{user:{id:userId,email:'local@example.test'}},error:null};},onAuthStateChange:()=>{order.push('subscribe');}}};
  const sync=new SyncService({getData:()=>({}),setData:()=>{}});sync.onAuth=user=>users.push(user?.id||null);
  const rollout={refresh:async()=>{order.push('rollout');return {source:'remote'};}};
  const options={sync,rollout,storage,fetchConfig:async()=>{order.push('config');return JSON.parse(storage.getItem(PUBLIC_CONFIG_CACHE_KEY));},loadSdk:async()=>({createClient:()=>{order.push('client');return client;}})};
  for(let cycle=0;cycle<2;cycle++){
    if(cycle===0)assert.equal(sync.client,null);
    const result=await reconnectV3Auth(options);
    assert.equal(result.status,'authenticated');assert.equal(sync.user.id,userId);
  }
  assert.deepEqual(order,['rollout','config','client','session','verify','subscribe','rollout','config','session','verify']);
  assert.deepEqual(users,[userId,userId]);
});

test('expired Auth asks for login, while failed rollout or network leaves pending data untouched',async()=>{
  const storage=memory();storage.setItem(PUBLIC_CONFIG_CACHE_KEY,JSON.stringify({url:'https://tmydirzzlmlmtjgwqcgh.supabase.co',publishableKey:'sb_publishable_staging'}));
  let clientCalls=0;
  const sync=new SyncService({getData:()=>({}),setData:()=>{}});
  const base={sync,storage,fetchConfig:async()=>{throw new Error('offline config');},loadSdk:async()=>({createClient:()=>{clientCalls++;return {auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>{}}};}})};
  assert.equal((await reconnectV3Auth({...base,rollout:{refresh:async()=>({source:'stale-offline'})}})).status,'offline');
  assert.equal(clientCalls,0);
  const result=await reconnectV3Auth({...base,rollout:{refresh:async()=>({source:'remote'})}});
  assert.equal(result.status,'login_required');assert.equal(sync.user,null);assert.equal(clientCalls,1);
});

test('Auth network failure does not turn a cached identity into login_required',async()=>{
  const service=new SyncService({getData:()=>({}),setData:()=>{}});
  await assert.rejects(()=>service.reconnectAuth({config:{url:'https://tmydirzzlmlmtjgwqcgh.supabase.co',publishableKey:'sb_publishable_staging'},createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:userId}}},error:null}),getUser:async()=>({error:Object.assign(new Error('network'),{status:503})})}})}),/network/);
  assert.equal(service.client,null);
});

test('manual V3 sync validates rollout and Auth before constructing the engine',async()=>{
  const repository={userId},order=[];
  class Adapter {constructor({client}){this.client=client;order.push('adapter');}}
  class Engine {constructor(options){this.options=options;order.push('engine');}async syncOnce(){order.push('sync');return {pushed:1,conflicts:0};}}
  const client={auth:{getUser:async()=>{order.push('auth');return {data:{user:{id:userId}},error:null};}}};
  const result=await syncV3Repository(repository,{online:()=>true,storageEnabled:()=>true,syncEnabled:()=>true,refreshRollout:async()=>{order.push('rollout');return {source:'remote',remoteWritesAllowed:true};},fetchConfig:async()=>{order.push('config');return {url:'https://tmydirzzlmlmtjgwqcgh.supabase.co',publishableKey:'sb_publishable_staging'};},loadSdk:async()=>({createClient:()=>{order.push('client');return client;}}),Adapter,Engine});
  assert.deepEqual(result,{pushed:1,conflicts:0});assert.deepEqual(order,['rollout','config','client','auth','adapter','engine','sync']);
});

test('manual V3 sync remains pending when offline, stale, maintenance, disabled, invalid Auth, or a transient error occurs',async()=>{
  const repository={userId};
  const enabled={storageEnabled:()=>true,syncEnabled:()=>true};
  assert.equal((await syncV3Repository(repository,{...enabled,online:()=>false})).skipped,'offline');
  const stale=await syncV3Repository(repository,{...enabled,online:()=>true,refreshRollout:async()=>({source:'stale-offline',remoteWritesAllowed:false})});assert.equal(stale.skipped,'rollout_blocked');
  const maintenance=await syncV3Repository(repository,{...enabled,online:()=>true,refreshRollout:async()=>({source:'remote',remoteWritesAllowed:false})});assert.equal(maintenance.skipped,'rollout_blocked');
  assert.equal((await syncV3Repository(repository,{online:()=>true,storageEnabled:()=>false,syncEnabled:()=>true})).skipped,'disabled');
  await assert.rejects(()=>syncV3Repository(repository,{...enabled,online:()=>true,refreshRollout:async()=>({source:'remote',remoteWritesAllowed:true}),fetchConfig:async()=>({url:'https://tmydirzzlmlmtjgwqcgh.supabase.co',publishableKey:'sb_publishable_staging'}),loadSdk:async()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:null},error:{status:401}})}})})}),/sesión Auth/);
});
