import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3ConflictService} from '../js/v3/conflict-service.js';
import {createLocalDeviceInventory,discoverLocalInventoryUsers,sanitizeInventoryValue,validateLocalDeviceInventory} from '../js/local-device-inventory.js';

const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const date='2026-09-20T12:00:00.000Z';
function storage(){const map=new Map();return {get length(){return map.size;},key:index=>[...map.keys()][index]??null,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};}
function setup(){const localStorage=storage(),indexedDB=new IDBFactory();return {localStorage,indexedDB,options:{storage:localStorage,indexedDB,locationLike:{origin:'https://nico.example'},navigatorLike:{userAgent:'Mozilla Edg/120',platform:'Win32'},cacheStorage:{keys:async()=>['nico-fit-v15']},documentLike:{querySelector:()=>({content:'test-build'})},cryptoImpl:crypto,now:()=>new Date(date)}};}
const exportFor=(env,userId=A)=>createLocalDeviceInventory({...env.options,userId});

test('V2 export includes scoped data and active session, never another user or Auth storage',async()=>{
  const env=setup();
  env.localStorage.setItem(`gymFutbolAppV2:${A}`,JSON.stringify({readiness:[{date:'2026-09-20',energy:4}],workouts:[{date:'2026-09-20',exercise:'press',sets:[{kg:60,reps:8,done:true}]}],sessions:[{date:'2026-09-20'}]}));
  env.localStorage.setItem(`gymFutbolActiveSessionV2:${A}`,JSON.stringify({startedAt:date,currentExerciseId:'press',sets:[{kg:60}]}));
  env.localStorage.setItem(`gymFutbolAppV2:${B}`,JSON.stringify({workouts:[{notes:'OTHER_USER'}]}));
  env.localStorage.setItem('sb-project-auth-token',JSON.stringify({access_token:'ACCESS_SECRET',refresh_token:'REFRESH_SECRET'}));
  const output=await exportFor(env),report=await validateLocalDeviceInventory(output);
  assert.equal(output.summary.v2.workouts,1);assert.equal(output.summary.activeSessions,1);assert.equal(report.activeSession,true);
  assert.deepEqual(await discoverLocalInventoryUsers({storage:env.localStorage,indexedDB:env.indexedDB}),[A,B]);
  assert.ok(!JSON.stringify(output).includes('OTHER_USER'));assert.ok(!JSON.stringify(output).includes('ACCESS_SECRET'));assert.ok(!JSON.stringify(output).includes('REFRESH_SECRET'));
  assert.equal(report.valid,true);assert.equal(report.shouldSyncBeforeCutover,true);
});

test('V3 export preserves per-user entities, pending queue, conflict, resolution and checkpoint',async()=>{
  const env=setup(),a=await V3LocalRepository.open({userId:A,indexedDB:env.indexedDB,featureEnabled:true});
  const b=await V3LocalRepository.open({userId:B,indexedDB:env.indexedDB,featureEnabled:true});
  const session=await a.create('workout_sessions',{session_date:'2026-09-20',label:'Local session'});
  await b.create('workout_sessions',{session_date:'2026-09-20',label:'OTHER_USER'});
  const [operation]=await a.listOperations();
  await a.recordConflict({entity:'workout_sessions',recordId:session.id,operationIds:[operation.operation_id],reason:'remote_version_conflict',localPayload:session,remotePayload:{...session,version:2}});
  await a.setSyncCheckpoint('workout_sessions',{updatedAt:date,id:session.id});
  await a.recordSyncAttempt(crypto.randomUUID(),{startedAt:date,finishedAt:date,status:'completed'});
  await a.acquireLease(`nico-fit-v3-sync:${A}`,'LOCK_SECRET',{ttlMs:30000});
  const output=await exportFor(env),report=await validateLocalDeviceInventory(output);
  assert.equal(output.summary.v3Entities.workout_sessions,1);assert.equal(output.summary.operations.conflict,1);assert.equal(output.summary.conflicts,1);assert.equal(output.summary.checkpoints,1);assert.equal(output.summary.activeSessions,1);assert.equal(output.summary.syncState.lastSuccessfulAt,date);
  assert.equal(report.conflicts,true);assert.equal(report.pendingSync,1);assert.ok(!JSON.stringify(output).includes('OTHER_USER'));assert.ok(!JSON.stringify(output).includes('LOCK_SECRET'));
  a.close();b.close();
});

test('pending, syncing and failed operations remain distinguishable; resolved conflict audit remains available',async()=>{
  const env=setup(),repo=await V3LocalRepository.open({userId:A,indexedDB:env.indexedDB,featureEnabled:true});
  await repo.create('workout_sessions',{session_date:'2026-09-20',label:'Pending'});
  await repo.create('workout_sessions',{session_date:'2026-09-21',label:'Syncing'});
  await repo.create('workout_sessions',{session_date:'2026-09-22',label:'Failed'});
  const operations=await repo.listOperations();
  await repo.setOperationStatus(operations[1].operation_id,'syncing');
  await repo.setOperationStatus(operations[2].operation_id,'failed',{lastError:'Bearer abcdefghijklmnopqrstuvwxyz'});
  const output=await exportFor(env);
  assert.equal(output.summary.operations.pending,1);assert.equal(output.summary.operations.syncing,1);assert.equal(output.summary.operations.failed,1);
  assert.ok(!JSON.stringify(output).includes('abcdefghijklmnopqrstuvwxyz'));
  assert.equal((await validateLocalDeviceInventory(output)).pendingSync,3);
  repo.close();
});

test('offline resolution decision remains in export with a pending sync operation',async()=>{
  const env=setup(),repo=await V3LocalRepository.open({userId:A,indexedDB:env.indexedDB,featureEnabled:true});
  const session=await repo.create('workout_sessions',{session_date:'2026-09-20',label:'Offline'}),[operation]=await repo.listOperations();
  await repo.recordConflict({entity:'workout_sessions',recordId:session.id,operationIds:[operation.operation_id],reason:'remote_version_conflict',remotePayload:{...session,user_id:A,version:2}});
  const service=new V3ConflictService({repository:repo,locks:null}),view=(await service.list())[0];
  await service.resolve(view,'keep_local');
  const output=await exportFor(env);
  assert.equal(output.summary.resolutionDecisions,1);assert.equal(output.summary.resolutionsPending,1);assert.equal(output.summary.conflicts,1);
  assert.equal((await validateLocalDeviceInventory(output)).shouldSyncBeforeCutover,true);
  repo.close();
});

test('empty user, corrupt local payload, malformed JSON and checksum tampering are reported',async()=>{
  const env=setup();let output=await exportFor(env);
  let report=await validateLocalDeviceInventory(output);
  assert.equal(report.valid,true);assert.equal(report.complete,true);assert.equal(report.shouldSyncBeforeCutover,false);
  env.localStorage.setItem(`gymFutbolAppV2:${A}`,'{broken');output=await exportFor(env);report=await validateLocalDeviceInventory(output);
  assert.equal(report.valid,true);assert.equal(report.complete,false);assert.equal(report.shouldSyncBeforeCutover,true);
  assert.equal((await validateLocalDeviceInventory('{broken')).corrupt,true);
  output.summary.v2.workouts=99;assert.equal((await validateLocalDeviceInventory(output)).corrupt,true);
  const malformed={...output,payload:{localStorage:[null],indexedDB:[]}};
  assert.equal((await validateLocalDeviceInventory(malformed)).corrupt,true);
});

test('secret fields are excluded recursively and stable format is idempotent for unchanged input',async()=>{
  const env=setup();env.localStorage.setItem(`gymFutbolAppV2:${A}`,JSON.stringify({notes:'normal',password:'BAD_PASSWORD',nested:{access_token:'BAD_ACCESS',apiKey:'BAD_KEY',error:'Bearer abcdefghijklmnopqrstuvwxyz user@example.com'}}));
  const first=await exportFor(env),second=await exportFor(env);
  assert.deepEqual(first,second);assert.equal(first.schemaVersion,1);assert.match(first.checksum.value,/^[a-f0-9]{64}$/);
  const serialized=JSON.stringify(first);for(const secret of ['BAD_PASSWORD','BAD_ACCESS','BAD_KEY','abcdefghijklmnopqrstuvwxyz','user@example.com'])assert.ok(!serialized.includes(secret));
  assert.equal((await validateLocalDeviceInventory(first)).valid,true);
  assert.deepEqual(sanitizeInventoryValue({refresh_token:'secret',safe:1}),{safe:1});
});

test('guest legacy data is inventoried separately from authenticated data',async()=>{
  const env=setup();env.localStorage.setItem('gymFutbolAppV1',JSON.stringify({workouts:[{exercise:'legacy'}]}));env.localStorage.setItem(`gymFutbolAppV2:${A}`,JSON.stringify({workouts:[{exercise:'scoped'}]}));
  const guest=await exportFor(env,'guest'),owner=await exportFor(env,A);
  assert.equal(guest.summary.v2.workouts,1);assert.equal(owner.summary.v2.workouts,1);
  assert.ok(!JSON.stringify(guest).includes('scoped'));assert.ok(!JSON.stringify(owner).includes('legacy'));
});

test('V3 export works without indexedDB.databases and does not create an absent database',async()=>{
  const env=setup(),withoutEnumeration={open:(...args)=>env.indexedDB.open(...args)};
  const empty=await createLocalDeviceInventory({...env.options,indexedDB:withoutEnumeration,userId:A});
  assert.equal(empty.summary.indexedDatabases,0);assert.deepEqual(await env.indexedDB.databases(),[]);
  const repo=await V3LocalRepository.open({userId:A,indexedDB:env.indexedDB,featureEnabled:true});
  await repo.create('workout_sessions',{session_date:'2026-09-20',label:'Fallback'});repo.close();
  const output=await createLocalDeviceInventory({...env.options,indexedDB:withoutEnumeration,userId:A});
  assert.equal(output.summary.v3Entities.workout_sessions,1);
});

test('a damaged user database never exports a row owned by another user',async()=>{
  const env=setup(),repo=await V3LocalRepository.open({userId:A,indexedDB:env.indexedDB,featureEnabled:true});
  const transaction=repo.database.transaction('workout_sessions','readwrite');
  transaction.objectStore('workout_sessions').put({id:B,owner_id:B,session_date:'2026-09-20',label:'OTHER_USER'});
  await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=reject;});
  const output=await exportFor(env),report=await validateLocalDeviceInventory(output);
  assert.equal(output.summary.v3Entities.workout_sessions,0);assert.equal(report.complete,false);
  assert.ok(!JSON.stringify(output).includes('OTHER_USER'));
  repo.close();
});
