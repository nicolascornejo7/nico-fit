import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {databaseNameForUser} from '../js/v3/indexed-db.js';
import {importV2LocalData,stableClientUuid} from '../js/v3/import-v2.js';
import {isV3LocalStorageEnabled,setV3LocalStorageEnabled} from '../js/v3/feature-flags.js';

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const memoryStorage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const open=(indexedDB,userId)=>V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
const sessionPayload=(overrides={})=>({session_date:'2026-09-14',label:'Martes',status:'draft',...overrides});

test('V3 flag is disabled by default and requires explicit activation',async()=>{
  const storage=memoryStorage(),indexedDB=new IDBFactory();
  assert.equal(isV3LocalStorageEnabled(storage),false);
  await assert.rejects(()=>V3LocalRepository.open({indexedDB,userId:'user-a',flagStorage:storage}),/disabled/i);
  setV3LocalStorageEnabled(true,storage);
  const repository=await V3LocalRepository.open({indexedDB,userId:'user-a',flagStorage:storage});
  assert.equal(isV3LocalStorageEnabled(storage),true);repository.close();
});

test('V2 app remains the default path and every V3 PWA asset exists',async()=>{
  const [app,worker]=await Promise.all([
    readFile(new URL('../js/app.js',import.meta.url),'utf8'),
    readFile(new URL('../sw.js',import.meta.url),'utf8')
  ]);
  assert.doesNotMatch(app,/\.\/v3\//);
  for(const module of ['client-storage.js','feature-flags.js','indexed-db.js','repository.js','import-v2.js']){
    assert.match(worker,new RegExp(`js/v3/${module.replace('.','\\.')}`));
    await access(new URL(`../js/v3/${module}`,import.meta.url));
  }
});

test('IndexedDB databases and records are strictly isolated by user',async()=>{
  const indexedDB=new IDBFactory(),a=await open(indexedDB,'user-a'),b=await open(indexedDB,'user-b'),id='10000000-0000-4000-8000-000000000001';
  await a.create('workout_sessions',sessionPayload({label:'A'}),{id});
  await b.create('workout_sessions',sessionPayload({label:'B'}),{id});
  assert.notEqual(databaseNameForUser('user-a'),databaseNameForUser('user-b'));
  assert.equal((await a.get('workout_sessions',id)).label,'A');
  assert.equal((await b.get('workout_sessions',id)).label,'B');
  await assert.rejects(()=>open(indexedDB,'guest'),/authenticated user/i);a.close();b.close();
});

test('records and queue persist after closing and reopening the PWA',async()=>{
  const indexedDB=new IDBFactory(),operationId='20000000-0000-4000-8000-000000000001';
  let repository=await open(indexedDB,'reload-user');
  const created=await repository.create('workout_sessions',sessionPayload(),{operationId});repository.close();
  repository=await open(indexedDB,'reload-user');
  assert.equal((await repository.get('workout_sessions',created.id)).id,created.id);
  assert.equal((await repository.listOperations())[0].operation_id,operationId);repository.close();
});

test('client UUIDs and repeated operation ids remain stable',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'uuid-user'),operationId='30000000-0000-4000-8000-000000000001';
  const first=await repository.create('workout_sessions',sessionPayload(),{operationId});
  const second=await repository.create('workout_sessions',sessionPayload({label:'Ignored retry'}),{operationId});
  assert.match(first.id,uuidPattern);assert.equal(second.id,first.id);assert.equal((await repository.listOperations()).length,1);
  assert.equal(await stableClientUuid('same-source'),await stableClientUuid('same-source'));repository.close();
});

test('insert, update, and soft delete create an ordered persistent queue',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'queue-user');
  const session=await repository.create('workout_sessions',sessionPayload(),{operationId:'40000000-0000-4000-8000-000000000001'});
  await repository.update('workout_sessions',session.id,{label:'Martes actualizado'},{operationId:'40000000-0000-4000-8000-000000000002'});
  await repository.softDelete('workout_sessions',session.id,{operationId:'40000000-0000-4000-8000-000000000003'});
  const operations=await repository.listOperations();
  assert.deepEqual(operations.map(item=>item.type),['insert','update','soft_delete']);
  assert.deepEqual(operations.map(item=>item.sequence),[1,2,3]);
  assert.ok(operations.every(item=>item.status==='pending'));repository.close();
});

test('updates preserve remote version and enforce local optimistic revision',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'version-user');
  const session=await repository.create('workout_sessions',sessionPayload({remote_version:7}),{operationId:'50000000-0000-4000-8000-000000000001'});
  const updated=await repository.update('workout_sessions',session.id,{label:'V2'},{expectedLocalRevision:1,operationId:'50000000-0000-4000-8000-000000000002'});
  const repeated=await repository.update('workout_sessions',session.id,{label:'ignored'},{operationId:'50000000-0000-4000-8000-000000000002'});
  assert.equal(updated.remote_version,7);assert.equal(updated.local_revision,2);
  assert.equal(repeated.local_revision,2);assert.equal(repeated.label,'V2');
  const updateOperation=(await repository.listOperations()).find(item=>item.type==='update');
  assert.equal(updateOperation.base_remote_version,7);
  await assert.rejects(()=>repository.update('workout_sessions',session.id,{label:'stale'},{expectedLocalRevision:1}),/revision conflict/i);repository.close();
});

test('soft delete is idempotent and tombstones cannot be updated',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'delete-user'),operationId='60000000-0000-4000-8000-000000000002';
  const session=await repository.create('workout_sessions',sessionPayload(),{operationId:'60000000-0000-4000-8000-000000000001'});
  const first=await repository.softDelete('workout_sessions',session.id,{operationId}),second=await repository.softDelete('workout_sessions',session.id,{operationId});
  assert.equal(second.deleted_at,first.deleted_at);assert.equal((await repository.listOperations()).length,2);
  assert.equal((await repository.listSessions()).length,0);assert.equal((await repository.listSessions({includeDeleted:true})).length,1);
  await assert.rejects(()=>repository.update('workout_sessions',session.id,{label:'resurrect'}),/immutable/i);repository.close();
});

test('failed and conflicting operations can be retried',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'retry-user'),operationId='70000000-0000-4000-8000-000000000001';
  await repository.create('workout_sessions',sessionPayload(),{operationId});
  const [claimed]=await repository.claimPendingOperations(1);assert.equal(claimed.status,'syncing');assert.equal(claimed.attempts,1);
  assert.equal((await repository.listSessions({syncStatus:'syncing'})).length,1);
  await repository.setOperationStatus(operationId,'failed',{error:'offline'});
  assert.equal((await repository.retryOperation(operationId)).status,'pending');
  await repository.setOperationStatus(operationId,'conflict',{error:'409'});
  assert.equal((await repository.retryOperation(operationId)).status,'pending');repository.close();
});

test('server acknowledgements preserve the confirmed remote version locally',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'ack-user'),operationId='75000000-0000-4000-8000-000000000001';
  const session=await repository.create('workout_sessions',sessionPayload(),{operationId});
  await repository.claimPendingOperations();await repository.setOperationStatus(operationId,'synced',{remoteVersion:1});
  const saved=await repository.get('workout_sessions',session.id);
  assert.equal(saved.remote_version,1);assert.equal(saved.sync_status,'synced');assert.equal('version' in saved,false);repository.close();
});

test('syncing operations recover to pending after an unexpected close',async()=>{
  const indexedDB=new IDBFactory(),operationId='80000000-0000-4000-8000-000000000001';
  let repository=await open(indexedDB,'crash-user');await repository.create('workout_sessions',sessionPayload(),{operationId});
  await repository.claimPendingOperations();repository.close();
  repository=await open(indexedDB,'crash-user');const [operation]=await repository.listOperations();
  assert.equal(operation.status,'pending');assert.equal(operation.attempts,1);assert.match(operation.last_error,/interrupted/i);repository.close();
});

test('sessions can be queried by date, state, and exercise',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'query-user');
  const first=await repository.create('workout_sessions',sessionPayload({status:'completed'}));
  await repository.create('workout_sessions',sessionPayload({session_date:'2026-09-15',label:'Jueves'}));
  await repository.create('session_exercises',{session_id:first.id,exercise_catalog_id:'catalog-press',exercise_key:'press-banca',position:0,exercise_name_snapshot:'Press banca'});
  assert.equal((await repository.listSessions({date:'2026-09-14'})).length,1);
  assert.equal((await repository.listSessions({status:'completed'})).length,1);
  assert.equal((await repository.listSessions({syncStatus:'pending'})).length,2);
  assert.equal((await repository.listSessions({exerciseId:'catalog-press'}))[0].id,first.id);
  assert.equal((await repository.listSessions({exerciseId:'press-banca'}))[0].id,first.id);repository.close();
});

test('catalog, session exercise, and set stores enforce their parent graph',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'graph-user');
  const catalog=await repository.create('exercise_catalog',{stable_key:'remo',canonical_name:'Remo',measurement_kind:'reps'});
  const session=await repository.create('workout_sessions',sessionPayload());
  const exercise=await repository.create('session_exercises',{session_id:session.id,exercise_catalog_id:catalog.id,exercise_key:'remo',position:0,exercise_name_snapshot:'Remo'});
  const set=await repository.create('exercise_sets',{session_exercise_id:exercise.id,position:0,reps:10,is_completed:true});
  assert.equal((await repository.listChildren('exercise_sets',exercise.id))[0].id,set.id);
  await assert.rejects(()=>repository.create('session_exercises',{session_id:'missing',position:0,exercise_name_snapshot:'Inválido'}),/parent workout_session/i);
  await assert.rejects(()=>repository.create('exercise_sets',{session_exercise_id:'missing',position:0}),/parent session_exercise/i);repository.close();
});

test('V2 import is idempotent and does not invent ambiguous relationships or measurements',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'import-user');
  const v2={
    sessions:[
      {date:'2026-09-14',label:'Mañana',startedAt:'2026-09-14T10:00:00.000Z',endedAt:'2026-09-14T11:00:00.000Z'},
      {date:'2026-09-14',label:'Tarde',startedAt:'2026-09-14T18:00:00.000Z',endedAt:'2026-09-14T19:00:00.000Z'}
    ],
    workouts:[
      {date:'2026-09-14',exerciseId:'press-banca',exercise:'Press banca',sets:[{kg:80,reps:8,rir:2,done:true}]},
      {date:'2026-09-15',exercise:'',sets:[{}]}
    ]
  };
  const first=await importV2LocalData(repository,v2),mappingCount=(await repository.listMigrationMappings()).length;
  const second=await importV2LocalData(repository,v2);
  assert.equal(first.reconstructedSessions,1);assert.equal(first.skipped,1);
  assert.deepEqual(second,{sessions:0,reconstructedSessions:0,exercises:0,sets:0,pendingReview:0,skipped:0});
  assert.equal((await repository.listMigrationMappings()).length,mappingCount);
  const reconstructed=(await repository.listSessions({date:'2026-09-14'})).find(item=>item.reconstructed);
  assert.ok(reconstructed);assert.match(reconstructed.migration_note,/no parent was inferred/i);
  const [exercise]=await repository.listChildren('session_exercises',reconstructed.id);
  const [set]=await repository.listChildren('exercise_sets',exercise.id);
  assert.equal(set.reps,null);assert.equal(set.duration_seconds,null);assert.equal(set.legacy_value_snapshot,8);assert.equal(set.is_completed,false);
  assert.equal((await repository.listOperations()).length,0);repository.close();
});

test('reviewing an imported local-only record queues its first remote action as insert',async()=>{
  const indexedDB=new IDBFactory(),repository=await open(indexedDB,'review-user');
  await importV2LocalData(repository,{sessions:[],workouts:[{date:'2026-09-14',exercise:'Remo',sets:[{reps:10,done:true}]}]});
  const [session]=await repository.listSessions(),[exercise]=await repository.listChildren('session_exercises',session.id),[set]=await repository.listChildren('exercise_sets',exercise.id);
  await repository.update('exercise_sets',set.id,{reps:10,is_completed:true,migration_status:'migrated',migration_note:''});
  const [operation]=await repository.listOperations();assert.equal(operation.type,'insert');assert.equal(operation.base_remote_version,null);repository.close();
});
