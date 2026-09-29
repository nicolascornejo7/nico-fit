import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3RoutineService} from '../js/v3/routine-service.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';
import {remotePayloadForOperation} from '../js/v3/sync-protocol.js';
import {UnifiedProgress} from '../js/v3/unified-progress.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';
import {pullV3Repository} from '../js/v3/sync-runtime.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {V3TrainingUI} from '../js/v3/training-ui.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAMP='2026-09-29T18:37:09.000Z';
const serverRecord=(record,version=1)=>({...record,version,created_at:'2026-09-25T10:00:00.000Z',updated_at:STAMP,deleted_at:record.deleted_at??null});

class ReadOnlyRemote{
  constructor(){this.rows=new Map();this.mutationEntities=[];this.reads=0;}
  add(entity,row){if(!this.rows.has(entity))this.rows.set(entity,new Map());this.rows.get(entity).set(row.id,structuredClone(row));}
  async authenticatedUserId(){return USER;}
  async fetchChanges(entity,{cursor,pageSize}){
    this.reads++;
    return [...(this.rows.get(entity)?.values()??[])].filter(row=>!cursor||row.updated_at>cursor.updatedAt||row.updated_at===cursor.updatedAt&&row.id>cursor.id)
      .sort((a,b)=>a.updated_at.localeCompare(b.updated_at)||a.id.localeCompare(b.id)).slice(0,pageSize).map(row=>structuredClone(row));
  }
  async mutate(operation){this.mutationEntities.push(operation.entity);throw new Error('The recovered seeds must never be sent remotely.');}
}

class TestNode{
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.listeners={};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,handler){this.listeners[name]=handler;}
  setAttribute(name,value){this[name]=value;}
  focus(){}
  set innerHTML(_value){throw new Error('Unsafe HTML');}
}
const descendants=(node,condition)=>[...(condition(node)?[node]:[]),...node.children.flatMap(child=>descendants(child,condition))];

function remoteWorkout(remote,{discarded=false,exerciseCount=9,setCount=15,routine=null}={}){
  const sessionId=crypto.randomUUID(),deleted_at=discarded?STAMP:null;
  remote.add('workout_sessions',serverRecord({id:sessionId,user_id:USER,session_date:'2026-09-29',label:discarded?'Discarded':'Completed',session_type:'routine',status:discarded?'draft':'completed',started_at:'2026-09-29T15:20:24.000Z',ended_at:discarded?null:'2026-09-29T16:33:57.000Z',duration_seconds:discarded?null:4413,deleted_at,
    ...(routine?{routine_id:routine.template.id,routine_version:1,routine_version_id:routine.version.id,routine_snapshot:routine.snapshot}:{})}));
  for(let position=0;position<exerciseCount;position++){
    const exerciseId=crypto.randomUUID();
    const replacement=routine&&!discarded&&position===0?routine.snapshot.exercises[1]:null;
    remote.add('session_exercises',serverRecord({id:exerciseId,session_id:sessionId,exercise_catalog_id:replacement?.exercise_catalog_id??null,position,exercise_name_snapshot:replacement?.exercise_name_snapshot??`Exercise ${position}`,prescription_snapshot:{sets:3},deleted_at}));
    for(let index=0;index<(!discarded&&position<5?Math.min(3,setCount-position*3):0);index++)remote.add('exercise_sets',serverRecord({id:crypto.randomUUID(),session_exercise_id:exerciseId,position:index,load_kg:20,reps:8,rir:2,is_completed:true,completed_at:'2026-09-29T16:00:00.000Z'}));
  }
  return sessionId;
}

test('pull-only restores completed workout without pushing 48 local routine seeds',async()=>{
  const db=new IDBFactory(),repository=await V3LocalRepository.open({indexedDB:db,userId:USER,featureEnabled:true});
  const state={source:'remote',updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:true,v3_routines_enabled:true}};
  const reset=installRolloutControl({snapshot:()=>state,refreshIfDue:async()=>state});
  try{
    const defaults=await new V3RoutineService({repository,featureEnabled:true}).seedDefaults();
    const pending=await repository.listOperations({status:'pending'});
    assert.equal(pending.length,48);
    assert.deepEqual(Object.fromEntries(['exercise_catalog','routine_templates','routine_versions','routine_exercises'].map(entity=>[entity,pending.filter(op=>op.entity===entity).length])),{exercise_catalog:19,routine_templates:3,routine_versions:3,routine_exercises:23});
    assert.equal(await repository.getSyncCheckpoint('workout_sessions'),null);
    const remote=new ReadOnlyRemote();
    for(const operation of pending){
      const record=remotePayloadForOperation(operation,USER);
      remote.add(operation.entity,serverRecord(record,2));
    }
    for(let index=0;index<11;index++)remote.add('exercise_catalog',serverRecord({id:crypto.randomUUID(),owner_user_id:USER,stable_key:`extra-${index}`,canonical_name:`Extra ${index}`,measurement_kind:'reps',metadata:{}}));
    const completedId=remoteWorkout(remote,{routine:defaults[0]}),discardedId=remoteWorkout(remote,{discarded:true,exerciseCount:7,setCount:0,routine:defaults[0]});
    const sync=new V3SyncEngine({repository,remote,featureEnabled:true,routinesSyncEnabled:true,locks:null,pageSize:5});
    const result=await sync.pullOnly();
    assert.deepEqual(remote.mutationEntities,[]);
    assert.ok(remote.reads>0);
    assert.equal(result.conflicts,0);
    assert.equal(result.pushed,0);
    assert.equal(result.confirmed,48);
    assert.equal((await repository.listOperations({status:'pending'})).length,0);
    const syncedSeeds=await repository.listOperations({status:'synced'});
    assert.equal(syncedSeeds.length,48);
    assert.equal((await repository.listOperations({status:'superseded'})).length,0);
    assert.deepEqual(Object.fromEntries(['exercise_catalog','routine_templates','routine_versions','routine_exercises'].map(entity=>[entity,syncedSeeds.filter(op=>op.entity===entity).length])),{exercise_catalog:19,routine_templates:3,routine_versions:3,routine_exercises:23});
    for(const operation of syncedSeeds){const row=await repository.get(operation.entity,operation.record_id);assert.equal(row.remote_version,2);assert.equal(row.sync_status,'synced');}
    assert.equal((await repository.listConflicts()).length,0);
    assert.equal((await repository.get('workout_sessions',completedId)).status,'completed');
    assert.ok((await repository.get('workout_sessions',discardedId)).deleted_at);
    assert.equal((await repository.listSessions()).length,1);
    assert.equal((await repository.listSessions({includeDeleted:true})).length,2);
    assert.equal((await repository.getTrainingState())?.activeSessionId??null,null);
    assert.equal((await repository.listRecords('session_exercises',{includeDeleted:true})).length,16);
    assert.equal((await repository.listRecords('exercise_sets')).length,15);
    assert.equal((await repository.listRecords('exercise_catalog')).length,30);
    const progress=await new UnifiedProgress({repository,v2Reader:{read:async()=>({workouts:[],sessions:[],readiness:[],football:[],matches:[]})}}).load();
    assert.equal(progress.metrics.completedSessions,1);
    assert.equal(progress.sessions.length,1);
    assert.equal(progress.metrics.volume,2400);
    assert.equal((await repository.get('routine_templates',pending.find(op=>op.entity==='routine_templates').record_id)).remote_version,2);
    // The training screen rerenders after recovery and seeds its defaults again.
    await new V3RoutineService({repository,featureEnabled:true}).seedDefaults();
    assert.equal((await repository.listOperations({status:'pending'})).length,0);
    const remoteCounts=Object.fromEntries([...remote.rows].map(([entity,rows])=>[entity,rows.size]));
    const normal=await sync.syncOnce();
    assert.equal(normal.pushed,0);
    assert.equal(normal.conflicts,0);
    assert.equal(normal.failed,0);
    assert.deepEqual(remote.mutationEntities,[]);
    assert.deepEqual(Object.fromEntries([...remote.rows].map(([entity,rows])=>[entity,rows.size])),remoteCounts);
    assert.equal((await repository.listOperations({status:'pending'})).length,0);
    assert.equal((await repository.listOperations({status:'synced'})).length,48);
    assert.equal((await repository.listConflicts()).length,0);
    assert.equal((await repository.get('workout_sessions',completedId)).status,'completed');
    assert.ok((await repository.get('workout_sessions',discardedId)).deleted_at);
    assert.equal((await repository.listRecords('exercise_sets')).length,15);
    const priorDocument=globalThis.document;
    globalThis.document={createElement:tag=>new TestNode(tag)};
    try{
      const beforeView=(await repository.listOperations()).length;
      const training=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now:()=>new Date('2026-09-29T12:00:00-03:00')});
      const root=new TestNode('section'),ui=new V3TrainingUI({root,engine:training,onClose:()=>{}});
      await ui.render();
      assert.equal(descendants(root,node=>node.textContent==='✓ Completado').length,1);
      assert.equal(descendants(root,node=>node.textContent==='9 ejercicios · 15 series completadas').length,1);
      assert.equal(descendants(root,node=>node.textContent==='Comenzar entrenamiento').length,0);
      const view=descendants(root,node=>node.tag==='button'&&node.textContent==='Ver entrenamiento realizado')[0];
      assert.ok(view);
      await view.listeners.click();
      assert.equal(descendants(root,node=>node.className==='v3-completed-exercise').length,9);
      assert.equal(descendants(root,node=>node.className==='v3-completed-set').length,15);
      assert.equal(descendants(root,node=>node.textContent===`Sustituyó a ${defaults[0].snapshot.exercises[0].exercise_name_snapshot}`).length,1);
      assert.equal((await repository.get('workout_sessions',completedId)).status,'completed');
      assert.equal((await repository.getTrainingState())?.activeSessionId??null,null);
      assert.equal((await repository.listOperations()).length,beforeView);
      assert.deepEqual(remote.mutationEntities,[]);
    }finally{globalThis.document=priorDocument;}
    const again=await sync.pullOnly();
    assert.equal(again.conflicts,0);
    assert.deepEqual(remote.mutationEntities,[]);
    assert.equal((await repository.listSessions({includeDeleted:true})).length,2);
    assert.equal((await repository.listRecords('session_exercises',{includeDeleted:true})).length,16);
    assert.equal((await repository.listRecords('exercise_sets')).length,15);
  }finally{reset();repository.close();}
});

test('pull-only keeps a functional seed mismatch as conflict and still downloads workout',async()=>{
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  const state={source:'remote',updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:true,v3_routines_enabled:true}};
  const reset=installRolloutControl({snapshot:()=>state,refreshIfDue:async()=>state});
  try{
    await new V3RoutineService({repository,featureEnabled:true}).seedDefaults();
    const operations=await repository.listOperations({status:'pending'}),remote=new ReadOnlyRemote();
    const changed=operations.find(item=>item.entity==='routine_templates');
    for(const operation of operations){const record=serverRecord(remotePayloadForOperation(operation,USER));if(operation.operation_id===changed.operation_id)record.name='Different functional name';remote.add(operation.entity,record);}
    const sessionId=remoteWorkout(remote,{exerciseCount:9,setCount:15});
    const result=await new V3SyncEngine({repository,remote,featureEnabled:true,routinesSyncEnabled:true,locks:null}).pullOnly();
    assert.equal(result.pushed,0);
    assert.deepEqual(remote.mutationEntities,[]);
    assert.equal(result.conflicts,1);
    assert.equal((await repository.listConflicts()).length,1);
    assert.equal((await repository.listOperations({status:'conflict'}))[0].record_id,changed.record_id);
    assert.equal((await repository.listOperations({status:'synced'})).length,47);
    assert.equal((await repository.get('workout_sessions',sessionId)).status,'completed');
    assert.equal((await repository.listRecords('exercise_sets')).length,15);
    const after=await new V3SyncEngine({repository,remote,featureEnabled:true,routinesSyncEnabled:true,locks:null}).syncOnce();
    assert.equal(after.pushed,0);
    assert.deepEqual(remote.mutationEntities,[]);
    assert.equal((await repository.listOperations({status:'conflict'})).length,1);
  }finally{reset();repository.close();}
});

test('training entry starts a missing routine and continues an active draft without showing a second start CTA',async()=>{
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  const state={source:'remote',updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:true,v3_training_enabled:true,v3_routines_enabled:true,v3_coach_enabled:false}};
  const reset=installRolloutControl({snapshot:()=>state,refreshIfDue:async()=>state}),priorDocument=globalThis.document;
  globalThis.document={createElement:tag=>new TestNode(tag)};
  try{
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now:()=>new Date('2026-09-29T12:00:00-03:00')}),root=new TestNode('section'),ui=new V3TrainingUI({root,engine,onClose:()=>{}});
    await ui.render();
    assert.equal(descendants(root,node=>node.textContent==='Comenzar entrenamiento').length,1);
    const started=await engine.createSession({dayIndex:2,useRoutine:true});
    await engine.saveUIState({view:'active'});
    await ui.render();
    assert.equal((await repository.get('workout_sessions',started.session.id)).status,'draft');
    assert.equal(descendants(root,node=>node.textContent==='Continuar entrenamiento').length,1);
    assert.equal(descendants(root,node=>node.textContent==='Comenzar entrenamiento').length,0);
  }finally{globalThis.document=priorDocument;reset();repository.close();}
});

test('pull-only refuses wrong Auth owner and offline without touching queue or server',async()=>{
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  const state={source:'remote',updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_sync_enabled:true,v3_routines_enabled:true}};
  const reset=installRolloutControl({snapshot:()=>state,refreshIfDue:async()=>state});
  try{
    await new V3RoutineService({repository,featureEnabled:true}).seedDefaults();
    const remote=new ReadOnlyRemote(),sync=new V3SyncEngine({repository,remote,featureEnabled:true,routinesSyncEnabled:true,locks:null,online:()=>false});
    assert.deepEqual(await sync.pullOnly(),{skipped:'offline'});
    remote.authenticatedUserId=async()=>crypto.randomUUID();
    await assert.rejects(new V3SyncEngine({repository,remote,featureEnabled:true,routinesSyncEnabled:true,locks:null}).pullOnly(),/does not match/);
    assert.equal(remote.reads,0);
    assert.deepEqual(remote.mutationEntities,[]);
    assert.equal((await repository.listOperations({status:'pending'})).length,48);
  }finally{reset();repository.close();}
});

test('recovery runtime uses authenticated authorized project and only invokes pullOnly',async()=>{
  const calls=[];
  class Adapter {constructor(){calls.push('adapter');}}
  class Engine {async pullOnly(){calls.push('pull');return {pulled:31,confirmed:48,pushed:0};}async syncOnce(){throw new Error('push path must not run');}}
  const options=url=>({online:()=>true,storageEnabled:()=>true,syncEnabled:()=>true,refreshRollout:async()=>{calls.push('rollout');return {source:'remote',remoteWritesAllowed:true};},fetchConfig:async()=>({url,publishableKey:'sb_publishable_fixture'}),loadSdk:async()=>({createClient:()=>({auth:{getUser:async()=>{calls.push('auth');return {data:{user:{id:USER}},error:null};}}})}),Adapter,Engine});
  const result=await pullV3Repository({userId:USER},options('https://xaklsoqyzwowtjwcpwmb.supabase.co'));
  assert.deepEqual(result,{pulled:31,confirmed:48,pushed:0});
  assert.deepEqual(calls,['rollout','auth','adapter','pull']);
  await assert.rejects(pullV3Repository({userId:USER},options('https://unauthorized.supabase.co')),/destino de sync V3/);
  assert.deepEqual(await pullV3Repository({userId:USER},{...options('https://xaklsoqyzwowtjwcpwmb.supabase.co'),refreshRollout:async()=>({source:'stale-offline',remoteWritesAllowed:false})}),{skipped:'rollout_blocked'});
});
