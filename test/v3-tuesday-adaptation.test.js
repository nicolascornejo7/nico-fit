import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {tuesdayDecision,mondayLegLoad,effectiveTuesdayExercises,TUESDAY_LOAD_THRESHOLDS} from '../js/v3/tuesday-adaptation.js';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {V3RoutineService} from '../js/v3/routine-service.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';
import {remotePayloadForOperation,remoteConfirmsOperation} from '../js/v3/sync-protocol.js';
import {UnifiedProgress} from '../js/v3/unified-progress.js';
import {V3CoachService} from '../js/v3/coach-service.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now=()=>new Date(2026,9,6,10);
const iso=(day,hour)=>new Date(2026,9,day,hour).toISOString();
const ready=(patch={})=>({id:'ready-tue',date:'2026-10-06',sleep:5,energy:5,freshness:5,pain:0,...patch});
let number=0;
function workout(keys=['sentadilla-prensa'],counts=[3],{status='completed',rir=2,date='2026-10-05',deleted=false,started=iso(5,18),ended=iso(5,19),custom=false}={}){
  const sessionId=`session-${++number}`;
  return {session:{id:sessionId,session_date:date,session_type:'free_workout',status,started_at:started,ended_at:ended,deleted_at:deleted?iso(5,20):null,rpe:8},
    exercises:keys.map((key,index)=>({id:`ex-${sessionId}-${index}`,exercise_name_snapshot:key,catalog:custom?{stable_key:`custom:${key}`,metadata:{custom:true}}:{stable_key:key},sets:Array.from({length:counts[index]},(_,position)=>({id:`set-${sessionId}-${index}-${position}`,is_completed:true,reps:8,load_kg:80,rir,completed_at:ended,position}))}))};
}
const decision=(history,options={})=>tuesdayDecision({history,readiness:[ready()],now:now(),...options});

test('0, 1, 2, 3, 5 and 6+ completed primary sets select transparent classes',()=>{
  const expected=new Map([[0,'none'],[1,'low'],[2,'low'],[3,'moderate'],[5,'moderate'],[6,'high'],[7,'high']]);
  for(const [count,grade] of expected){const rows=count?[workout(['sentadilla-prensa'],[count])]:[];assert.equal(mondayLegLoad({history:rows,now:now()}).class,grade);}
  assert.equal(TUESDAY_LOAD_THRESHOLDS.high,6);
});
test('RIR adjusts one class only with actual recorded margin; kg and global RPE are context',()=>{
  assert.equal(decision([workout(['sentadilla-prensa'],[6],{rir:5})]).legLoad.class,'moderate');
  assert.equal(decision([workout(['sentadilla-prensa'],[3],{rir:0})]).legLoad.class,'high');
  const missing=workout(['sentadilla-prensa'],[3],{rir:null});missing.session.rpe=10;
  assert.equal(decision([missing]).legLoad.class,'moderate');
  missing.exercises[0].sets.forEach(set=>set.load_kg=0);assert.equal(decision([missing]).legLoad.class,'moderate');
});
test('squat and hinge aggregate, upper alone does not; calf and jumps use special limits',()=>{
  assert.equal(decision([workout(['sentadilla-prensa','peso-muerto-rumano'],[3,3])]).selectedVariant,'leg_recovery');
  assert.equal(decision([workout(['press-banca','curl-biceps-barra'],[5,3])]).selectedVariant,'normal');
  assert.equal(decision([workout(['elevacion-gemelos'],[4])]).legLoad.class,'none');
  assert.equal(decision([workout(['elevacion-gemelos'],[5])]).legLoad.class,'moderate');
  assert.equal(decision([workout(['saltos-verticales'],[4])]).legLoad.class,'moderate');
});
test('living draft sets count, empty and discarded sessions do not; two sessions and duplicate UUID count once',()=>{
  const draft=workout(['sentadilla-prensa'],[2],{status:'draft'}),second=workout(['peso-muerto-rumano'],[2]);
  assert.equal(decision([draft,second]).legLoad.primarySets,4);
  const empty=workout(['sentadilla-prensa'],[0],{status:'draft'}),discarded=workout(['sentadilla-prensa'],[6],{deleted:true});
  assert.equal(decision([empty,discarded]).legLoad.primarySets,0);
  second.exercises[0].sets[0].id=draft.exercises[0].sets[0].id;
  assert.equal(decision([draft,second]).legLoad.primarySets,3);
  draft.exercises[0].sets[1].is_completed=false;assert.equal(decision([draft,second]).legLoad.primarySets,2);
});
test('Monday session crossing midnight counts before Tuesday decision, not later sets',()=>{
  const start=iso(5,23),end=iso(6,0),row=workout(['sentadilla-prensa'],[3],{started:start,ended:end});
  row.exercises[0].sets[2].completed_at=iso(6,11);
  assert.equal(decision([row]).legLoad.primarySets,2);
  row.session.session_date='2026-10-06';assert.equal(decision([row]).legLoad.primarySets,2);
  const sunday=workout(['sentadilla-prensa'],[2],{date:'2026-10-05',started:iso(4,23),ended:iso(5,1)});
  sunday.exercises[0].sets[0].completed_at=iso(4,23);
  assert.equal(decision([sunday]).legLoad.primarySets,1);
});
test('actual replacement identity counts and custom without a profile stays uncertain',()=>{
  const performed=workout(['peso-muerto-rumano'],[3]);performed.exercises[0].prescription_snapshot={replaced_exercise_name:'Press banca'};
  const custom=workout(['Sentadilla casera'],[4],{custom:true});
  const result=decision([performed,custom]);assert.equal(result.legLoad.class,'moderate');assert.equal(result.legLoad.unknownSets,4);assert.match(result.reasons.join(' '),/sin perfil/);
});
test('six leg sets with good readiness preserve all upper work; low general readiness is separate',()=>{
  const history=[workout(['sentadilla-prensa','peso-muerto-rumano'],[3,3])],good=decision(history);
  assert.equal(good.legLoadVariant,'leg_recovery');assert.equal(good.selectedVariant,'leg_recovery');assert.equal(good.totalSets,8);
  assert.deepEqual(good.affected.filter(row=>['press-banca','dominadas-jalon'].includes(row.stableKey)).map(row=>row.sets),[3,3]);
  const bad=decision(history,{readiness:[ready({sleep:2,energy:2,freshness:2})]});assert.equal(bad.selectedVariant,'general_short');assert.equal(bad.totalSets,5);
  const noGym=decision([],{readiness:[ready({sleep:3,energy:3,freshness:2})]});assert.equal(noGym.selectedVariant,'reduced');assert.equal(noGym.totalSets,12);
  const severe=decision([],{readiness:[ready({sleep:1,energy:1,freshness:1})]});assert.equal(severe.restRecommended,true);assert.equal(severe.selectedVariant,'general_short');
  assert.equal(decision(history,{readiness:[]}).selectedVariant,'leg_recovery');
});
test('manual override records recommended and chosen variants separately',()=>{
  const history=[workout(['sentadilla-prensa'],[6])],result=decision(history,{override:true});
  assert.equal(result.recommendedVariant,'leg_recovery');assert.equal(result.selectedVariant,'normal');assert.equal(result.override,true);assert.equal(result.totalSets,19);
  assert.equal(result.evidenceKey,decision(history).evidenceKey);
  history[0].exercises[0].sets[0].rir=0;
  assert.notEqual(result.evidenceKey,decision(history).evidenceKey);
});

class Remote{
  constructor(){this.tables={};this.writes=0;}
  async authenticatedUserId(){return USER;}
  async fetchChanges(entity,{cursor,pageSize}){return Object.values(this.tables[entity]||{}).filter(row=>!cursor||row.updated_at>cursor.updatedAt||row.updated_at===cursor.updatedAt&&row.id>cursor.id).sort((a,b)=>a.updated_at.localeCompare(b.updated_at)||a.id.localeCompare(b.id)).slice(0,pageSize).map(row=>structuredClone(row));}
  async fetchById(entity,id){return structuredClone(this.tables[entity]?.[id]??null);}
  async mutate(operation,userId){this.writes++;const payload=remotePayloadForOperation(operation,userId),current=this.tables[operation.entity]?.[operation.record_id];if(operation.type!=='insert'&&!current)throw Object.assign(new Error('missing'),{code:'REMOTE_ROW_MISSING',status:404});const row={...current,...payload,updated_at:new Date().toISOString()};(this.tables[operation.entity]??={})[row.id]=row;return structuredClone(row);}
}
const open=db=>V3LocalRepository.open({indexedDB:db,userId:USER,featureEnabled:true});
const sync=(repository,remote)=>new V3SyncEngine({repository,remote,featureEnabled:true,routinesSyncEnabled:true,signalsSyncEnabled:true,locks:null});

test('read-only Coach preview, v2 immutable session snapshots, offline execution, progress and push/pull',async()=>{
  const reset=installRolloutControl({snapshot:()=>({updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_routines_enabled:true,v3_signals_enabled:true}}),refreshIfDue:async()=>{}});
  const repository=await open(new IDBFactory()),remote=new Remote();
  try{
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now});
    const routines=new V3RoutineService({repository,featureEnabled:true});await routines.seedDefaults();
    const beforeOperations=(await repository.listOperations()).length;
    const preview=await new V3CoachService({engine,featureEnabled:true,now}).tuesdayPlan();
    assert.equal(preview.totalSets,19);assert.equal((await repository.listOperations()).length,beforeOperations);
    const published=(await routines.list()).find(row=>row.versions.some(version=>version.day_index===2));
    const v2=published.versions.find(row=>row.version_number===2),base=structuredClone(v2.prescription_snapshot);
    const lower=workout(['sentadilla-prensa','peso-muerto-rumano'],[3,3]);
    // Insert actual local records without touching the remote, including completed sets.
    const parent=await repository.create('workout_sessions',{id:crypto.randomUUID(),session_date:'2026-10-05',label:'Musculación libre',session_type:'free_workout',status:'completed',started_at:iso(5,18),ended_at:iso(5,19),duration_seconds:3600,rpe:8,notes:''});
    for(const [index,key] of ['sentadilla-prensa','peso-muerto-rumano'].entries()){
      const catalog=(await repository.listRecords('exercise_catalog')).find(row=>row.stable_key===key);
      const ex=await repository.create('session_exercises',{session_id:parent.id,exercise_catalog_id:catalog.id,position:index,exercise_name_snapshot:key,prescription_snapshot:{sets:3,measurement_kind:'reps'},notes:''});
      for(let i=0;i<3;i++)await repository.create('exercise_sets',{session_exercise_id:ex.id,position:i,load_kg:80,reps:8,rir:2,is_completed:true,completed_at:iso(5,19)});
    }
    const currentPlan=await new V3CoachService({engine,featureEnabled:true,now}).tuesdayPlan();
    assert.equal(currentPlan.totalSets,8);
    await assert.rejects(engine.createSession({dayIndex:2,useRoutine:true,adaptTuesday:true,expectedCoachEvidenceKey:preview.evidenceKey}),error=>error.code==='COACH_PLAN_CHANGED');
    assert.equal((await repository.listSessions()).filter(row=>row.session_date==='2026-10-06').length,0);
    const session=await engine.createSession({dayIndex:2,useRoutine:true,adaptTuesday:true,expectedCoachEvidenceKey:currentPlan.evidenceKey});
    assert.equal(session.session.routine_version,2);assert.deepEqual(session.session.routine_snapshot,base);
    assert.equal(session.exercises.reduce((sum,ex)=>sum+ex.prescription_snapshot.sets,0),8);
    assert.equal(session.exercises.find(ex=>ex.catalog.stable_key==='press-banca').prescription_snapshot.sets,3);
    const saved=session.exercises[0].prescription_snapshot.coach_adaptation;
    assert.equal(saved.selected_variant,'leg_recovery');assert.equal(saved.base_routine_version_id,v2.id);
    assert.equal((await routines.version(v2.id)).snapshot.exercises.length,7);
    const routineOps=(await repository.listOperations()).filter(op=>op.entity==='routine_versions'&&op.record_id===v2.id);
    assert.equal(remoteConfirmsOperation(routineOps[0],{...remotePayloadForOperation(routineOps[0],USER),version:1},USER),true);
    const exerciseOperation=(await repository.listOperations()).find(op=>op.entity==='session_exercises'&&op.record_id===session.exercises[0].id);
    const equivalent={...remotePayloadForOperation(exerciseOperation,USER),id:session.exercises[0].id};
    assert.equal(remoteConfirmsOperation(exerciseOperation,equivalent,USER),true);
    const changed=structuredClone(equivalent);changed.prescription_snapshot.coach_adaptation.selected_variant='normal';
    assert.equal(remoteConfirmsOperation(exerciseOperation,changed,USER),false);
    assert.deepEqual(effectiveTuesdayExercises(base,decision([lower]),await repository.listRecords('exercise_catalog')).map(ex=>ex.prescription_snapshot.sets),[3,3,2]);
    await engine.saveSet(session.exercises[0].id,{load_kg:50,reps:8,rir:3,is_completed:true},{position:0});
    await engine.finishSession({rpe:6});
    const mondayExercise=(await repository.listChildren('session_exercises',parent.id))[0];
    await repository.create('exercise_sets',{session_exercise_id:mondayExercise.id,position:3,load_kg:85,reps:6,rir:1,is_completed:true,completed_at:iso(5,20)});
    assert.notEqual((await new V3CoachService({engine,featureEnabled:true,now}).tuesdayPlan()).evidenceKey,currentPlan.evidenceKey);
    assert.deepEqual((await engine.snapshot(session.session.id)).exercises[0].prescription_snapshot.coach_adaptation,saved);
    const coachAfter=await new V3CoachService({engine,featureEnabled:true,now}).today((await engine.history()).find(row=>row.session.id===session.session.id));
    assert.ok(coachAfter.recommendation);
    const progress=await new UnifiedProgress({repository,v2Reader:{read:async()=>({workouts:[],sessions:[],readiness:[],football:[],matches:[]})}}).load();
    assert.ok(progress.exercises.some(row=>row.identity===`v3:exercise:${session.exercises[0].exercise_catalog_id}`));
    for(let i=0;i<8&&(await repository.listOperations({status:'pending'})).length;i++)await sync(repository,remote).syncOnce();
    assert.equal((await repository.listOperations({status:'pending'})).length,0);
    assert.equal((await repository.listConflicts()).length,0);
    const remoteExercise=await remote.fetchById('session_exercises',session.exercises[0].id);assert.deepEqual(remoteExercise.prescription_snapshot.coach_adaptation,saved);
    const second=await open(new IDBFactory());try{const pull=await sync(second,remote).pullOnly();assert.equal(pull.pushed,0);const read=await second.get('session_exercises',session.exercises[0].id);assert.deepEqual(read.prescription_snapshot.coach_adaptation,saved);}finally{second.close();}
    assert.deepEqual((await routines.version(v2.id)).snapshot.prescription_snapshot,undefined);
    assert.deepEqual((await routines.version(v2.id)).snapshot,base);
    const updatedPlan=await new V3CoachService({engine,featureEnabled:true,now}).tuesdayPlan();
    const override=await engine.createSession({dayIndex:2,useRoutine:true,adaptTuesday:true,overrideCoach:true,expectedCoachEvidenceKey:updatedPlan.evidenceKey});
    assert.equal(override.exercises.reduce((sum,ex)=>sum+ex.prescription_snapshot.sets,0),19);
    assert.equal(override.exercises[0].prescription_snapshot.coach_adaptation.recommended_variant,'leg_recovery');
    assert.equal(override.exercises[0].prescription_snapshot.coach_adaptation.override,true);
    assert.deepEqual(override.session.routine_snapshot,base);
  }finally{repository.close();reset();}
});
