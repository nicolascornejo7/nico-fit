import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {isV3TrainingEnabled,setV3TrainingEnabled,isV3SyncEnabled} from '../js/v3/feature-flags.js';
import {sessionMetrics} from '../js/v3/training-metrics.js';
import {v3Progression} from '../js/v3/training-progression.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';
import {remotePayloadForOperation} from '../js/v3/sync-protocol.js';

const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function setup(indexedDB=new IDBFactory()){
  const repository=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  let now=new Date('2026-09-15T12:00:00Z');
  const engine=new V3TrainingEngine({repository,featureEnabled:true,now:()=>new Date(now)});
  return {repository,engine,indexedDB,setNow:value=>{now=new Date(value);}};
}
async function custom(engine,mode='reps'){
  const catalog=await engine.createCustomExercise({name:'Ejercicio propio',measurementKind:mode});
  return engine.addExercise(catalog.id,{sets:2,min:6,max:10,step:2.5});
}
const setInput=(patch={})=>({load_kg:50,reps:10,duration_seconds:null,rir:2,is_completed:true,...patch});

test('training flag defaults off and never enables sync',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  assert.equal(isV3TrainingEnabled(storage),false);setV3TrainingEnabled(true,storage);assert.equal(isV3TrainingEnabled(storage),true);assert.equal(isV3SyncEnabled(storage),false);
  const {repository}=await setup();assert.throws(()=>new V3TrainingEngine({repository,flagStorage:{getItem:()=>null}}),/disabled/);repository.close();
});

test('creating a routine session stores the full graph and historical prescription',async()=>{
  const {repository,engine}=await setup();const snapshot=await engine.createSession();
  assert.equal(snapshot.session.status,'draft');assert.equal(snapshot.exercises.length,7);
  const exercise=snapshot.exercises[0];assert.ok(exercise.exercise_catalog_id);assert.equal(exercise.prescription_snapshot.sets,3);
  await repository.update('exercise_catalog',exercise.exercise_catalog_id,{canonical_name:'Nombre cambiado'});
  assert.equal((await engine.snapshot()).exercises[0].exercise_name_snapshot,'Sentadilla o prensa');
  assert.equal((await repository.listOperations()).filter(op=>op.type==='insert').length,15);repository.close();
});

test('two sessions on the same day keep independent UUIDs and selection',async()=>{
  const {repository,engine}=await setup();const first=await engine.createSession({useRoutine:false}),second=await engine.createSession({useRoutine:false});
  assert.notEqual(first.session.id,second.session.id);assert.equal((await repository.listSessions({date:first.session.session_date})).length,2);
  await engine.selectSession(first.session.id);assert.equal(engine.getState().activeSessionId,first.session.id);repository.close();
});

test('free workout uses the V3 session graph without a routine and persists across reload',async()=>{
  const {repository,engine,indexedDB,setNow}=await setup();const created=await engine.createFreeWorkout({date:'2026-09-14'});
  assert.equal(created.session.session_type,'free_workout');assert.equal(created.session.routine_id,undefined);assert.equal(created.exercises.length,0);
  const operation=(await repository.listOperations()).find(item=>item.entity==='workout_sessions'&&item.record_id===created.session.id);assert.equal(remotePayloadForOperation(operation,userId).session_type,'free_workout');
  const legs=await engine.createCustomExercise({name:'Sentadilla libre'});
  const first=await engine.addExercise(legs.id,{sets:3,min:6,max:10,step:2.5}),repeat=await engine.repeatExercise(first.id);
  await engine.reorderExercises([repeat.id,first.id]);await engine.saveSet(repeat.id,setInput({load_kg:100,reps:8}));await engine.saveUIState({view:'summary',currentExerciseId:repeat.id});repository.close();
  const reopened=await setup(indexedDB);const restored=await reopened.engine.recover();assert.equal(restored.session.session_type,'free_workout');assert.deepEqual(restored.exercises.map(item=>item.id),[repeat.id,first.id]);
  setNow('2026-09-14T13:00:00Z');const completed=await reopened.engine.finishSession({rpe:8,notes:'Libre de piernas'});assert.equal(completed.session.status,'completed');assert.equal(completed.session.notes,'Libre de piernas');assert.equal((await reopened.engine.history()).filter(item=>item.session.session_type==='free_workout').length,1);reopened.repository.close();
});

test('free workout cannot finish empty',async()=>{
  const {repository,engine}=await setup();await engine.createFreeWorkout();await assert.rejects(()=>engine.finishSession({rpe:7}),/al menos una serie/);repository.close();
});

test('repeated exercises use occurrence IDs without sharing sets',async()=>{
  const {repository,engine}=await setup();await engine.createSession({useRoutine:false});const first=await custom(engine),second=await engine.repeatExercise(first.id);
  await engine.saveSet(first.id,setInput());const snapshot=await engine.snapshot();
  assert.notEqual(first.id,second.id);assert.equal(first.exercise_catalog_id,second.exercise_catalog_id);assert.equal(snapshot.exercises[1].sets.length,0);
  assert.deepEqual(first.prescription_snapshot,second.prescription_snapshot);repository.close();
});

test('reordering exercises commits final positions and preserves both remote transitions',async()=>{
  const {repository,engine}=await setup();await engine.createSession({useRoutine:false});const a=await custom(engine),b=await engine.repeatExercise(a.id),c=await engine.repeatExercise(a.id);
  await engine.reorderExercises([c.id,a.id,b.id]);const snapshot=await engine.snapshot();assert.deepEqual(snapshot.exercises.map(ex=>ex.id),[c.id,a.id,b.id]);assert.deepEqual(snapshot.exercises.map(ex=>ex.position),[0,1,2]);
  const transitions=(await repository.listOperations()).filter(op=>op.preserve_transition);assert.equal(transitions.length,6);
  await assert.rejects(()=>engine.reorderExercises([a.id,a.id,c.id]),/una vez/);assert.deepEqual((await engine.snapshot()).exercises.map(ex=>ex.id),[c.id,a.id,b.id]);repository.close();
});

test('sets support editing, completion timestamps and soft delete',async()=>{
  const {repository,engine,setNow}=await setup();await engine.createSession({useRoutine:false});const exercise=await custom(engine);
  const set=await engine.saveSet(exercise.id,setInput());setNow('2026-09-15T12:10:00Z');
  const edited=await engine.saveSet(exercise.id,{reps:12},{setId:set.id});assert.equal(edited.completed_at,set.completed_at);assert.equal(edited.id,set.id);
  const undone=await engine.saveSet(exercise.id,{is_completed:false},{setId:set.id});assert.equal(undone.completed_at,null);
  await engine.deleteSet(exercise.id,set.id);assert.ok((await repository.get('exercise_sets',set.id)).deleted_at);assert.equal((await engine.snapshot()).exercises[0].sets.length,0);repository.close();
});

test('deleting an exercise tombstones its sets atomically',async()=>{
  const {repository,engine}=await setup();await engine.createSession({useRoutine:false});const ex=await custom(engine),set=await engine.saveSet(ex.id,setInput());
  await engine.deleteExercise(ex.id);assert.ok((await repository.get('session_exercises',ex.id)).deleted_at);assert.ok((await repository.get('exercise_sets',set.id)).deleted_at);assert.equal((await engine.snapshot()).exercises.length,0);repository.close();
});

test('reps and seconds are distinct and invalid inputs never persist',async()=>{
  const {repository,engine}=await setup();await engine.createSession({useRoutine:false});const timed=await custom(engine,'seconds');
  await assert.rejects(()=>engine.saveSet(timed.id,setInput()),/segundos/);
  const set=await engine.saveSet(timed.id,setInput({reps:null,duration_seconds:45}));assert.equal(set.reps,null);assert.equal(set.duration_seconds,45);
  const mixed=await custom(engine,'mixed');
  for(const patch of [{duration_seconds:30},{reps:1.2},{load_kg:-1},{rir:6},{is_completed:'true'},{reps:0}])await assert.rejects(()=>engine.saveSet(mixed.id,setInput(patch)));
  assert.equal((await engine.snapshot()).exercises[1].sets.length,0);repository.close();
});

test('RIR unknown stays null while RIR zero and load zero remain zero',async()=>{
  const {repository,engine}=await setup();await engine.createSession({useRoutine:false});const ex=await custom(engine);
  const unknown=await engine.saveSet(ex.id,setInput({rir:''})),zero=await engine.saveSet(ex.id,setInput({rir:0,load_kg:0}));
  assert.equal(unknown.rir,null);assert.equal(zero.rir,0);assert.equal(zero.load_kg,0);repository.close();
});

test('reload restores current exercise, view, form drafts and summary inputs',async()=>{
  const {repository,engine,indexedDB}=await setup();await engine.createSession({useRoutine:false});const ex=await custom(engine);await engine.saveSet(ex.id,setInput());
  await engine.saveUIState({view:'summary',currentExerciseId:ex.id});await engine.saveDraft(`${ex.id}:new`,{reps:'8',rir:'0'});await engine.saveSummaryDraft({rpe:'7.5',notes:'Pendiente'});repository.close();
  const reopened=await setup(indexedDB);const restored=await reopened.engine.recover();assert.equal(restored.exercises[0].sets.length,1);
  assert.equal(reopened.engine.getState().view,'summary');assert.equal(reopened.engine.getState().drafts[`${ex.id}:new`].rir,'0');assert.equal(reopened.engine.getState().summaryDraft.notes,'Pendiente');reopened.repository.close();
});

test('finalization records RPE, notes and timestamp duration before clearing active state',async()=>{
  const {repository,engine,setNow}=await setup();await engine.createSession({useRoutine:false});const ex=await custom(engine);await engine.saveSet(ex.id,setInput());setNow('2026-09-15T13:00:30Z');
  await assert.rejects(()=>engine.finishSession({rpe:11}),/RPE/);assert.ok(engine.getState());
  const result=await engine.finishSession({rpe:7.5,notes:'Técnica sólida'});assert.equal(result.session.status,'completed');assert.equal(result.session.duration_seconds,3630);assert.equal(result.session.rpe,7.5);
  assert.equal(await repository.getTrainingState(),null);assert.equal(engine.getState(),null);assert.equal(result.session.sync_status,'pending');repository.close();
});

test('failed finalization preserves session and summary for retry',async()=>{
  const {repository,engine}=await setup();await engine.createSession({useRoutine:false});const ex=await custom(engine);await engine.saveSet(ex.id,setInput());await engine.saveSummaryDraft({rpe:7,notes:'No perder'});
  const original=repository.commitLocalChanges.bind(repository);repository.commitLocalChanges=async()=>{throw new Error('Disk failure');};
  await assert.rejects(()=>engine.finishSession({rpe:7}),/Disk failure/);assert.equal(engine.getState().summaryDraft.notes,'No perder');assert.equal((await engine.snapshot()).session.status,'draft');
  repository.commitLocalChanges=original;repository.close();
});

test('finalization cannot silently discard an unsaved set draft',async()=>{
  const {repository,engine}=await setup();await engine.createSession({useRoutine:false});const ex=await custom(engine);await engine.saveSet(ex.id,setInput());
  const key=`${ex.id}:new`;await engine.saveDraft(key,{reps:'8',rir:'0'});
  await assert.rejects(()=>engine.finishSession({rpe:7}),/borradores/);assert.equal(engine.getState().drafts[key].reps,'8');
  await engine.discardDraft(key);assert.equal((await engine.finishSession({rpe:7})).session.status,'completed');repository.close();
});

test('V3 metrics count only completed active sets and aggregate stable catalog identities',async()=>{
  const {repository,engine,setNow}=await setup();await engine.createSession({useRoutine:false});const ex=await custom(engine),repeat=await engine.repeatExercise(ex.id);
  await engine.saveSet(ex.id,setInput());await engine.saveSet(ex.id,setInput({load_kg:999,is_completed:false}));await engine.saveSet(repeat.id,setInput({load_kg:60,reps:5}));
  const timed=await custom(engine,'seconds');await engine.saveSet(timed.id,setInput({reps:null,duration_seconds:45,load_kg:null}));setNow('2026-09-15T12:01:30Z');
  const metrics=await engine.metrics();assert.equal(metrics.volume,800);assert.equal(metrics.recordedReps,15);assert.equal(metrics.completedSets,3);assert.equal(metrics.durationSeconds,90);assert.equal(metrics.exerciseDurationSeconds,45);assert.equal(metrics.perExercise[ex.exercise_catalog_id].maxLoad,60);
  await engine.finishSession({rpe:7});assert.ok((await engine.prs())[ex.exercise_catalog_id]>60);repository.close();
});

function progressionInput(day,{rir=2,done=3,occurrenceIndex=0}={}){
  const current={id:'current',session_date:day,started_at:`${day}T12:00:00Z`,status:'draft'};
  const exercise={exercise_catalog_id:'stable-id',prescription_snapshot:{measurement_kind:'reps',sets:3,min:6,max:10,step:2.5}};
  const previous={session:{id:'previous',session_date:'2026-09-08',started_at:'2026-09-08T12:00:00Z',status:'completed'},exercises:[{exercise_catalog_id:'stable-id',sets:Array.from({length:3},(_,i)=>({load_kg:50,reps:10,rir,is_completed:i<done}))}]};
  return {session:current,exercise,history:[previous],now:new Date(`${day}T12:00:00Z`),readinessScore:75,occurrenceIndex};
}

test('progression keeps Tuesday, Thursday and Friday priorities and excludes incomplete sets',()=>{
  assert.equal(v3Progression(progressionInput('2026-09-15')).kg,52.5);
  assert.equal(v3Progression(progressionInput('2026-09-17')).kg,50);
  assert.match(v3Progression(progressionInput('2026-09-18')).text,/Prepartido/);
  assert.equal(v3Progression(progressionInput('2026-09-15',{done:2})).kg,50);
  assert.equal(v3Progression(progressionInput('2026-09-15',{rir:null})).kg,50);
  assert.equal(v3Progression(progressionInput('2026-09-15',{occurrenceIndex:1})).kg,'');
});

test('a day change never rewrites an active session date or its start timestamp',async()=>{
  const {repository,engine,setNow}=await setup();const first=await engine.createSession({useRoutine:false});setNow('2026-09-16T15:00:00Z');const ex=await custom(engine);await engine.saveSet(ex.id,setInput());
  assert.equal((await engine.snapshot()).session.session_date,first.session.session_date);const second=await engine.createSession({useRoutine:false});assert.equal(second.session.session_date,'2026-09-16');repository.close();
});

test('conflicting entities remain usable locally without requeuing conflicted changes',async()=>{
  const {repository,engine}=await setup();await engine.createSession({useRoutine:false});const ex=await custom(engine),set=await engine.saveSet(ex.id,setInput());
  const ops=await repository.unresolvedOperations('exercise_sets',set.id);
  await repository.recordConflict({entity:'exercise_sets',recordId:set.id,operationIds:ops.map(op=>op.operation_id),reason:'two-devices',localPayload:set,remotePayload:{id:set.id,version:2,reps:8}});
  await engine.saveSet(ex.id,{reps:12},{setId:set.id});const snapshot=await engine.snapshot();assert.equal(snapshot.exercises[0].sets[0].reps,12);assert.equal(snapshot.exercises[0].sets[0].sync_status,'conflict');assert.equal(snapshot.conflicts[0].remote_payload.reps,8);
  assert.ok((await repository.unresolvedOperations('exercise_sets',set.id)).every(op=>op.status==='conflict'));repository.close();
});

test('local batch failure rolls back entity changes and the outbox',async()=>{
  const {repository,engine}=await setup();const snapshot=await engine.createSession({useRoutine:false}),before=(await repository.listOperations()).length;
  await assert.rejects(()=>repository.commitLocalChanges([{entity:'workout_sessions',id:snapshot.session.id,type:'update',payload:{label:'Should roll back'}},{entity:'exercise_sets',type:'insert',payload:{session_exercise_id:'missing'}}]));
  assert.equal((await repository.get('workout_sessions',snapshot.session.id)).label,snapshot.session.label);assert.equal((await repository.listOperations()).length,before);repository.close();
});

test('two local instances cannot append exercises at the same active position',async()=>{
  const {repository,engine,indexedDB}=await setup();const snapshot=await engine.createSession({useRoutine:false}),ex=await custom(engine);
  const second=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  const payload={session_id:snapshot.session.id,exercise_catalog_id:ex.exercise_catalog_id,position:1,exercise_name_snapshot:'Concurrent',prescription_snapshot:{measurement_kind:'reps',sets:1},notes:''};
  const results=await Promise.allSettled([repository.commitLocalChanges([{entity:'session_exercises',type:'insert',payload}]),second.commitLocalChanges([{entity:'session_exercises',type:'insert',payload}])]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);assert.equal((await engine.snapshot()).exercises.length,2);repository.close();second.close();
});

class LocalTestRemote{
  constructor(){this.tables=new Map();this.counter=0;}
  async authenticatedUserId(){return userId;}
  table(entity){if(!this.tables.has(entity))this.tables.set(entity,new Map());return this.tables.get(entity);}
  async fetchChanges(entity,{cursor,pageSize}){return [...this.table(entity).values()].filter(row=>!cursor||row.updated_at>cursor.updatedAt||(row.updated_at===cursor.updatedAt&&row.id>cursor.id)).sort((a,b)=>a.updated_at.localeCompare(b.updated_at)||a.id.localeCompare(b.id)).slice(0,pageSize).map(row=>structuredClone(row));}
  async fetchById(entity,id){return this.table(entity).get(id)||null;}
  async mutate(operation){
    const table=this.table(operation.entity),current=table.get(operation.record_id),payload=remotePayloadForOperation(operation,userId);
    if(operation.type!=='insert'&&(!current||current.version+1!==payload.version))throw Object.assign(new Error('stale'),{code:'PT409',status:409});
    if(['session_exercises','exercise_sets'].includes(operation.entity)&&!payload.deleted_at){
      const parent=operation.entity==='session_exercises'?'session_id':'session_exercise_id';
      if([...table.values()].some(row=>row.id!==payload.id&&!row.deleted_at&&row[parent]===payload[parent]&&row.position===payload.position))throw Object.assign(new Error('unique position'),{code:'23505',status:409});
    }
    const row={...current,...payload,created_at:current?.created_at||payload.created_at,updated_at:new Date(Date.UTC(2026,8,20,0,0,++this.counter)).toISOString()};table.set(row.id,row);return structuredClone(row);
  }
}

test('a fully offline training graph and reorder sync later without version or position collisions',async()=>{
  const {repository,engine}=await setup();await engine.createSession({useRoutine:false});const a=await custom(engine),b=await engine.repeatExercise(a.id);await engine.saveSet(a.id,setInput());await engine.saveSet(a.id,{reps:12},{setId:(await engine.snapshot()).exercises[0].sets[0].id});await engine.reorderExercises([b.id,a.id]);await engine.finishSession({rpe:7});
  const remote=new LocalTestRemote(),sync=new V3SyncEngine({repository,remote,featureEnabled:true,locks:null,batchSize:3});
  for(let attempt=0;attempt<20&&(await repository.listOperations({status:'pending'})).length;attempt++)await sync.syncOnce();
  assert.equal((await repository.listOperations()).filter(op=>op.status!=='synced').length,0);
  assert.equal((await remote.fetchById('session_exercises',b.id)).position,0);assert.equal((await remote.fetchById('session_exercises',a.id)).position,1);assert.equal([...remote.table('workout_sessions').values()][0].status,'completed');repository.close();
});

test('training UI uses safe DOM, gated entry and no IndexedDB or Supabase component writes',async()=>{
  const [ui,entry]=await Promise.all([readFile(new URL('../js/v3/training-ui.js',import.meta.url),'utf8'),readFile(new URL('../js/v3/training-entry.js',import.meta.url),'utf8')]);
  assert.doesNotMatch(ui,/innerHTML|indexedDB|\.database|\.schema\(|\.from\(/);assert.match(ui,/textContent/);assert.match(entry,/button.hidden=!isV3TrainingEnabled\(\)/);assert.match(entry,/await rolloutReady/);assert.doesNotMatch(entry,/setV3SyncEnabled|createClient/);
});
