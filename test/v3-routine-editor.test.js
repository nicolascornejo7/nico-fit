import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {draftFromVersion,draftRowFor,draftToExercises,moveRow} from '../js/v3/routine-editor.js';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3RoutineService} from '../js/v3/routine-service.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {V3CoachService} from '../js/v3/coach-service.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';
import {genericTuesdayPlan,effectiveTuesdayExercises} from '../js/v3/tuesday-adaptation.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const flags={updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_routines_enabled:true,v3_signals_enabled:true,v3_coach_enabled:false}};

test('draft helpers validate, reorder and add rows with sensible defaults',()=>{
  const draft=[{exercise_catalog_id:'a',exercise_name_snapshot:'A',measurement_kind:'reps',sets:'3',min:'8',max:'10',target_rir:'2',rest:'90',step:2.5,notes:''},{exercise_catalog_id:'b',exercise_name_snapshot:'B',measurement_kind:'seconds',sets:2,min:30,max:45,target_rir:'',rest:'',step:0,notes:''}];
  const exercises=draftToExercises(draft);
  assert.deepEqual(exercises[0].prescription_snapshot,{sets:3,min:8,max:10,target_rir:2,rest:90,step:2.5,measurement_kind:'reps',notes:''});
  assert.equal(exercises[1].prescription_snapshot.target_rir,null);assert.equal(exercises[1].prescription_snapshot.rest,null);
  assert.deepEqual(moveRow(draft,1,-1).map(row=>row.exercise_catalog_id),['b','a']);assert.equal(moveRow(draft,0,-1),draft);
  assert.throws(()=>draftToExercises([{...draft[0],min:'12',max:'8'}]),/mínimo/);
  assert.throws(()=>draftToExercises([{...draft[0],sets:'0'}]),/series/);
  assert.throws(()=>draftToExercises([{...draft[0],target_rir:'7'}]),/RIR/);
  assert.throws(()=>draftToExercises([]),/al menos un ejercicio/);
  assert.equal(draftRowFor({id:'p',canonical_name:'Plancha',measurement_kind:'seconds'}).min,30);
});

test('an edited Tuesday becomes the trained version, stops program seeding and still adapts',async()=>{
  const reset=installRolloutControl({snapshot:()=>flags,refreshIfDue:async()=>{}});
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  try{
    const service=new V3RoutineService({repository,featureEnabled:true}),defaults=await service.seedDefaults(),tuesday=defaults[0];
    assert.equal(tuesday.version.version_number,3);assert.equal(await service.isCustomized(tuesday.template.id),false);
    const catalog=await repository.listRecords('exercise_catalog'),byKey=key=>catalog.find(row=>row.stable_key===key);
    let draft=draftFromVersion(tuesday).filter(row=>row.exercise_catalog_id!==byKey('salto-longitud').id);
    draft.find(row=>row.exercise_catalog_id===byKey('press-banca').id).sets=4;
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now:()=>new Date(2026,10,10,10)});
    const facePull=(await engine.catalog()).find(row=>row.stable_key==='face-pull');draft=[...draft,draftRowFor(facePull)];
    const saved=await service.createVersion(tuesday.template.id,{exercises:draftToExercises(draft)});
    assert.equal(saved.version.version_number,4);assert.equal(await service.isCustomized(tuesday.template.id),true);
    const before=(await repository.listOperations()).length,again=await service.seedDefaults();
    assert.equal((await repository.listOperations()).length,before);assert.equal(again[0].version.id,saved.version.id);
    assert.deepEqual([again[1].version.version_number,again[2].version.version_number],[3,2]);
    // Generic adaptation derived from profiles for the edited version.
    const preview=await new V3CoachService({engine,featureEnabled:true,now:()=>new Date(2026,10,10,10)}).tuesdayPlan({base:saved.snapshot});
    assert.equal(preview.generic,true);assert.equal(preview.routineVersion,4);
    const session=await engine.createSession({dayIndex:2,useRoutine:true,adaptTuesday:true,expectedCoachEvidenceKey:preview.evidenceKey});
    assert.equal(session.session.routine_version,4);assert.equal(session.exercises.length,saved.exercises.length);
    assert.equal(session.exercises.find(ex=>ex.catalog.stable_key==='press-banca').prescription_snapshot.sets,4);
    assert.ok(session.exercises.some(ex=>ex.catalog.stable_key==='face-pull'));
  }finally{reset();repository.close();}
});

test('generic Tuesday plan scales plyometrics and legs first and keeps upper work',()=>{
  const plan=genericTuesdayPlan([{stableKey:'salto-cajon',sets:3},{stableKey:'salto-longitud',sets:3},{stableKey:'sentadilla-prensa',sets:3,catalog:{stable_key:'sentadilla-prensa',metadata:{body_region:'legs'}}},{stableKey:'elevacion-gemelos',sets:3,catalog:{stable_key:'elevacion-gemelos',metadata:{body_region:'legs'}}},{stableKey:'press-banca',sets:4,catalog:{stable_key:'press-banca',metadata:{body_region:'upper'}}},{stableKey:'plancha-pallof',sets:3,catalog:{stable_key:'plancha-pallof',metadata:{body_region:'core'}}}]);
  assert.deepEqual(plan.reduced['salto-cajon'],[2,null]);assert.deepEqual(plan.reduced['salto-longitud'],[0,null]);
  assert.deepEqual(plan.reduced['sentadilla-prensa'],[2,4]);assert.deepEqual(plan.reduced['elevacion-gemelos'],[1,4]);
  assert.deepEqual(plan.leg_recovery['sentadilla-prensa'],[0,null]);assert.deepEqual(plan.leg_recovery['press-banca'],[4,3]);
  assert.deepEqual(plan.general_short['press-banca'],[2,4]);assert.deepEqual(plan.general_short['plancha-pallof'],[1,null]);
  const base={routine_version:4,day_index:2,routine_version_id:'v4',exercises:[{exercise_catalog_id:'x',prescription_snapshot:{sets:3}}]};
  assert.throws(()=>effectiveTuesdayExercises(base,{generic:false,routineVersion:4,affected:[]},[{id:'x',stable_key:'press-banca'}]),/rutina del martes/);
});
