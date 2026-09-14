import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';
import {compactOperations,remotePayloadForOperation} from '../js/v3/sync-protocol.js';

const USER_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sessionPayload=(label='Local')=>({session_date:'2026-09-14',label,status:'draft',notes:''});
const error=(message,code,status)=>Object.assign(new Error(message),{code,status});

class MockRemote{
  constructor(userId=USER_A){
    this.userId=userId;this.tables=Object.fromEntries(['workout_sessions','session_exercises','exercise_sets','exercise_catalog'].map(name=>[name,new Map()]));
    this.tick=0;this.fetchCalls=0;this.mutateCalls=0;this.failures=[];this.authError=null;this.beforeMutate=null;
  }
  time(){return new Date(Date.UTC(2026,8,14,0,0,++this.tick)).toISOString();}
  seed(entity,record){
    const timestamp=record.updated_at||this.time();
    this.tables[entity].set(record.id,{...structuredClone(record),version:record.version||1,created_at:record.created_at||timestamp,updated_at:timestamp,deleted_at:record.deleted_at??null});
  }
  async authenticatedUserId(){if(this.authError)throw this.authError;return this.userId;}
  async fetchChanges(entity,{cursor,pageSize}){
    this.fetchCalls+=1;
    return [...this.tables[entity].values()].filter(row=>{
      if(entity==='workout_sessions'&&row.user_id!==this.userId)return false;
      if(entity==='exercise_catalog'&&row.owner_user_id!=null&&row.owner_user_id!==this.userId)return false;
      return !cursor||row.updated_at>cursor.updatedAt||(row.updated_at===cursor.updatedAt&&row.id>cursor.id);
    }).sort((a,b)=>a.updated_at.localeCompare(b.updated_at)||a.id.localeCompare(b.id)).slice(0,pageSize).map(row=>structuredClone(row));
  }
  async fetchById(entity,id){const row=this.tables[entity].get(id);return row?structuredClone(row):null;}
  async mutate(operation,userId){
    this.mutateCalls+=1;if(this.beforeMutate)await this.beforeMutate();
    const failure=this.failures.shift();if(failure)throw failure;
    const payload=remotePayloadForOperation(operation,userId),table=this.tables[operation.entity],current=table.get(operation.record_id);
    if(operation.type==='insert'){
      if(current)throw error('duplicate','23505',409);
      const timestamp=this.time(),row={...payload,created_at:payload.created_at||timestamp,updated_at:timestamp,deleted_at:payload.deleted_at??null};
      table.set(row.id,row);return structuredClone(row);
    }
    if(!current)throw error('missing','REMOTE_ROW_MISSING',404);
    if(current.deleted_at)throw error('deleted immutable','55000',409);
    if(payload.version!==current.version+1)throw error('stale','PT409',409);
    const row={...current,...payload,created_at:current.created_at,updated_at:this.time()};table.set(row.id,row);return structuredClone(row);
  }
}

class TestLocks{
  constructor(){this.held=false;}
  async request(_name,_options,callback){
    if(this.held)return callback(null);
    this.held=true;try{return await callback({name:'lock'});}finally{this.held=false;}
  }
}

const open=(indexedDB,userId=USER_A)=>V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
const engine=(repository,remote,options={})=>new V3SyncEngine({repository,remote,featureEnabled:true,locks:null,random:()=>0, ...options});

test('V3 sync stays separate from V2 and staging rejects production secrets',async()=>{
  const [app,v2Sync,runner,flags]=await Promise.all([
    readFile(new URL('../js/app.js',import.meta.url),'utf8'),readFile(new URL('../js/sync.js',import.meta.url),'utf8'),
    readFile(new URL('../scripts/v3-sync-staging.mjs',import.meta.url),'utf8'),readFile(new URL('../js/v3/feature-flags.js',import.meta.url),'utf8')
  ]);
  assert.doesNotMatch(app,/client-sync|V3SyncEngine|V3_SYNC_FLAG/);assert.doesNotMatch(v2Sync,/nico_fit_v3|V3SyncEngine/);
  assert.match(runner,/Production project is forbidden/);assert.match(runner,/Service-role JWT is forbidden/);assert.match(runner,/sb_secret_/);
  assert.match(flags,/V3_SYNC_FLAG='nicoFit\.v3\.sync\.enabled'/);
});

test('sync flag remains disabled unless explicitly enabled',async()=>{
  const repository=await open(new IDBFactory()),remote=new MockRemote();
  const result=await new V3SyncEngine({repository,remote,flagStorage:{getItem:()=>null},locks:null}).syncOnce();
  assert.deepEqual(result,{skipped:'disabled'});assert.equal(remote.fetchCalls,0);repository.close();
});

test('first sync downloads remote data and uploads an offline insert',async()=>{
  const repository=await open(new IDBFactory()),remote=new MockRemote();
  remote.seed('workout_sessions',{id:'10000000-0000-4000-8000-000000000001',user_id:USER_A,...sessionPayload('Remote')});
  const local=await repository.create('workout_sessions',sessionPayload('Offline'));
  const result=await engine(repository,remote).syncOnce();
  assert.equal((await repository.get('workout_sessions',local.id)).sync_status,'synced');
  assert.equal((await repository.listSessions()).length,2);assert.equal(result.pulled,1);assert.equal(result.pushed,1);repository.close();
});

test('offline update reconnects with the exact next server version',async()=>{
  const repository=await open(new IDBFactory()),remote=new MockRemote(),id='20000000-0000-4000-8000-000000000001';
  remote.seed('workout_sessions',{id,user_id:USER_A,...sessionPayload('One')});await engine(repository,remote).syncOnce();
  await repository.update('workout_sessions',id,{label:'Two'});await engine(repository,remote).syncOnce();
  assert.equal((await remote.fetchById('workout_sessions',id)).version,2);assert.equal((await repository.get('workout_sessions',id)).remote_version,2);repository.close();
});

test('consecutive updates compact safely while a final tombstone is preserved',async()=>{
  const repository=await open(new IDBFactory()),remote=new MockRemote(),id='25000000-0000-4000-8000-000000000001';
  remote.seed('workout_sessions',{id,user_id:USER_A,...sessionPayload('Base')});await engine(repository,remote).syncOnce();
  await repository.update('workout_sessions',id,{label:'Two'});await repository.update('workout_sessions',id,{label:'Three'});await repository.softDelete('workout_sessions',id);
  const groups=compactOperations((await repository.listOperations()).filter(item=>item.status==='pending'));
  assert.equal(groups.length,1);assert.equal(groups[0].type,'soft_delete');assert.ok(groups[0].payload.deleted_at);
  const calls=remote.mutateCalls;await engine(repository,remote).syncOnce();assert.equal(remote.mutateCalls,calls+1);assert.ok((await remote.fetchById('workout_sessions',id)).deleted_at);repository.close();
});

test('offline soft delete uploads a tombstone without physical deletion',async()=>{
  const repository=await open(new IDBFactory()),remote=new MockRemote(),id='30000000-0000-4000-8000-000000000001';
  remote.seed('workout_sessions',{id,user_id:USER_A,...sessionPayload()});await engine(repository,remote).syncOnce();
  await repository.softDelete('workout_sessions',id);await engine(repository,remote).syncOnce();
  assert.ok((await remote.fetchById('workout_sessions',id)).deleted_at);assert.ok((await repository.get('workout_sessions',id)).deleted_at);repository.close();
});

test('two devices can sync changes to different entities',async()=>{
  const remote=new MockRemote(),a=await open(new IDBFactory()),b=await open(new IDBFactory());
  const session=await a.create('workout_sessions',sessionPayload('A'));
  const catalog=await b.create('exercise_catalog',{stable_key:'press-banca',canonical_name:'Press banca',measurement_kind:'reps',metadata:{}});
  await engine(a,remote).syncOnce();await engine(b,remote).syncOnce();await engine(a,remote).syncOnce();
  assert.ok(await a.get('exercise_catalog',catalog.id));assert.ok(await b.get('workout_sessions',session.id));a.close();b.close();
});

test('two devices editing the same entity create a persistent conflict',async()=>{
  const remote=new MockRemote(),id='40000000-0000-4000-8000-000000000001';remote.seed('workout_sessions',{id,user_id:USER_A,...sessionPayload('Base')});
  const a=await open(new IDBFactory()),b=await open(new IDBFactory());await engine(a,remote).syncOnce();await engine(b,remote).syncOnce();
  await a.update('workout_sessions',id,{label:'Device A'});await b.update('workout_sessions',id,{label:'Device B'});await engine(a,remote).syncOnce();
  const result=await engine(b,remote).syncOnce(),conflicts=await b.listConflicts();
  assert.equal(result.conflicts,1);assert.equal(conflicts[0].remote_payload.label,'Device A');assert.equal(conflicts[0].local_payload.label,'Device B');a.close();b.close();
});

test('PT409 is persisted as conflict and is never scheduled for retry',async()=>{
  const repository=await open(new IDBFactory()),remote=new MockRemote(),local=await repository.create('workout_sessions',sessionPayload());
  remote.failures.push(error('stale','PT409',409));await engine(repository,remote).syncOnce();
  const [operation]=await repository.listOperations();assert.equal(operation.status,'conflict');assert.equal(operation.next_attempt_at,null);assert.equal((await repository.listConflicts()).length,1);
  const calls=remote.mutateCalls;await engine(repository,remote).syncOnce();assert.equal(remote.mutateCalls,calls);assert.equal(local.id,operation.record_id);repository.close();
});

test('a remote tombstone conflicts with an old local update before upload',async()=>{
  const repository=await open(new IDBFactory()),remote=new MockRemote(),id='50000000-0000-4000-8000-000000000001';remote.seed('workout_sessions',{id,user_id:USER_A,...sessionPayload()});
  await engine(repository,remote).syncOnce();await repository.update('workout_sessions',id,{label:'Old local'});
  const row=await remote.fetchById('workout_sessions',id);remote.seed('workout_sessions',{...row,version:2,deleted_at:remote.time(),updated_at:remote.time()});
  const calls=remote.mutateCalls;await engine(repository,remote).syncOnce();
  assert.equal(remote.mutateCalls,calls);assert.equal((await repository.get('workout_sessions',id)).sync_status,'conflict');repository.close();
});

test('a duplicated insert after a lost acknowledgement is idempotent',async()=>{
  const repository=await open(new IDBFactory()),remote=new MockRemote(),local=await repository.create('workout_sessions',sessionPayload());
  const [operation]=await repository.listOperations(),remoteRow=await remote.mutate(operation,USER_A);
  await engine(repository,remote).syncOnce();
  assert.equal((await repository.listOperations())[0].status,'synced');assert.equal((await repository.get('workout_sessions',local.id)).remote_version,remoteRow.version);repository.close();
});

test('an unexpected close while syncing recovers and completes the operation',async()=>{
  const indexedDB=new IDBFactory();let repository=await open(indexedDB);const local=await repository.create('workout_sessions',sessionPayload());
  await repository.claimPendingOperations();repository.close();repository=await open(indexedDB);const remote=new MockRemote();
  const result=await engine(repository,remote).syncOnce();assert.equal(result.pushed,1);assert.ok(await remote.fetchById('workout_sessions',local.id));repository.close();
});

test('expired persistent leases are recoverable',async()=>{
  const indexedDB=new IDBFactory(),a=await open(indexedDB),b=await open(indexedDB),name=`nico-fit-v3-sync:${USER_A}`;
  assert.equal(await a.acquireLease(name,'one',{ttlMs:100,now:1000}),true);assert.equal(await b.acquireLease(name,'two',{ttlMs:100,now:1050}),false);
  assert.equal(await b.acquireLease(name,'two',{ttlMs:100,now:1101}),true);a.close();b.close();
});

test('Web Locks prevents two tabs from processing the queue together',async()=>{
  const indexedDB=new IDBFactory(),a=await open(indexedDB),b=await open(indexedDB),remote=new MockRemote(),locks=new TestLocks();await a.create('workout_sessions',sessionPayload());
  let release;const gate=new Promise(resolve=>{release=resolve;});remote.beforeMutate=()=>gate;
  const first=engine(a,remote,{locks}).syncOnce();await new Promise(resolve=>setTimeout(resolve,0));const second=engine(b,remote,{locks}).syncOnce();release();
  const [,secondResult]=await Promise.all([first,second]);assert.deepEqual(secondResult,{skipped:'locked'});assert.equal(remote.mutateCalls,1);a.close();b.close();
});

test('remote downloads are fully paginated with a persistent cursor',async()=>{
  const indexedDB=new IDBFactory();let repository=await open(indexedDB),remote=new MockRemote();
  for(let index=0;index<5;index++)remote.seed('workout_sessions',{id:`60000000-0000-4000-8000-00000000000${index}`,user_id:USER_A,...sessionPayload(String(index))});
  await engine(repository,remote,{pageSize:2}).syncOnce();assert.equal((await repository.listSessions()).length,5);
  let checkpoint=await repository.getSyncCheckpoint('workout_sessions');assert.equal(checkpoint.id,'60000000-0000-4000-8000-000000000004');repository.close();
  repository=await open(indexedDB);checkpoint=await repository.getSyncCheckpoint('workout_sessions');assert.equal(checkpoint.id,'60000000-0000-4000-8000-000000000004');repository.close();
});

test('network failures use bounded backoff before retrying',async()=>{
  let now=1000;const repository=await open(new IDBFactory()),remote=new MockRemote(),local=await repository.create('workout_sessions',sessionPayload());remote.failures.push(error('offline','NETWORK_ERROR',0));
  await engine(repository,remote,{now:()=>now}).syncOnce();let [operation]=await repository.listOperations();assert.equal(operation.status,'failed');assert.ok(Date.parse(operation.next_attempt_at)>now);
  const calls=remote.mutateCalls;await engine(repository,remote,{now:()=>now}).syncOnce();assert.equal(remote.mutateCalls,calls);
  now=Date.parse(operation.next_attempt_at);await engine(repository,remote,{now:()=>now}).syncOnce();assert.ok(await remote.fetchById('workout_sessions',local.id));repository.close();
});

test('an expired Supabase session stops before reading or claiming the queue',async()=>{
  const repository=await open(new IDBFactory()),remote=new MockRemote();await repository.create('workout_sessions',sessionPayload());remote.authError=error('expired','PGRST301',401);
  await assert.rejects(()=>engine(repository,remote).syncOnce(),/expired/);assert.equal(remote.fetchCalls,0);assert.equal((await repository.listOperations())[0].status,'pending');repository.close();
});

test('authenticated identity must match the isolated local user database',async()=>{
  const repository=await open(new IDBFactory(),USER_A),remote=new MockRemote(USER_B);
  await assert.rejects(()=>engine(repository,remote).syncOnce(),/does not match/);assert.equal(remote.fetchCalls,0);repository.close();
});
