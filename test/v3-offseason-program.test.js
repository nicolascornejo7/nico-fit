import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {OFF_SEASON_PROGRAM,OFF_SEASON_WEEK,gymDaysFor} from '../js/v3/offseason-program.js';
import {BASE_EXERCISES} from '../js/v3/base-exercise-catalog.js';
import {exerciseProfile} from '../js/v3/exercise-recommendations.js';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3RoutineService,offSeasonRoutineId,defaultRoutineId} from '../js/v3/routine-service.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {stableClientUuid} from '../js/v3/import-v2.js';
import {setWeekMode} from '../js/v3/week-mode.js';
import {completedRoutineSessions} from '../js/v3/completed-today.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};};

test('the off-season program uses base catalog exercises with matching units and covers the body twice a week',()=>{
  assert.deepEqual(gymDaysFor('off_season'),[1,2,4,5]);assert.deepEqual(gymDaysFor('match'),[2,4,5]);assert.deepEqual(gymDaysFor('no_match'),[2,4,5]);
  const muscles=new Map();
  for(const [day,source] of Object.entries(OFF_SEASON_PROGRAM)){
    assert.equal(OFF_SEASON_WEEK[day].type,'Gimnasio');
    for(const item of source.exercises){
      const base=BASE_EXERCISES.find(row=>row.stable_key===item.stable_key);assert.ok(base,`${item.stable_key} is not a base exercise`);
      assert.equal(base.measurement_kind,item.measurement_kind,item.stable_key);
      for(const muscle of exerciseProfile(base).primary_muscles)muscles.set(muscle,(muscles.get(muscle)??0)+1);
    }
  }
  for(const muscle of ['chest','lats','upper_back','deltoids','quadriceps','hamstrings','glutes','calves'])assert.ok((muscles.get(muscle)??0)>=2,`${muscle} trained at least twice`);
  assert.equal(OFF_SEASON_WEEK[3].type,'Cardio');assert.equal(OFF_SEASON_WEEK[6].type,'Cardio');assert.equal(OFF_SEASON_WEEK[0].type,'Descanso');
});

test('off-season routines are seeded once with deterministic ids and leave in-season routines untouched',async()=>{
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  try{
    const service=new V3RoutineService({repository,featureEnabled:true}),season=await service.seedDefaults(),before=structuredClone(season.map(graph=>graph.snapshot));
    const off=await service.seedOffSeason(),count=(await repository.listOperations()).length;
    assert.deepEqual(off.map(graph=>graph.version.day_index),[1,2,4,5]);
    for(const graph of off){
      assert.equal(graph.template.id,await offSeasonRoutineId(USER,graph.version.day_index));
      assert.equal(graph.version.id,await stableClientUuid(`v3:routine-version:${graph.template.id}:1`));
      assert.equal(graph.exercises.length,OFF_SEASON_PROGRAM[graph.version.day_index].exercises.length);
      assert.equal(await service.isCustomized(graph.template.id),false);
    }
    await service.seedOffSeason();assert.equal((await repository.listOperations()).length,count);
    assert.deepEqual((await service.seedDefaults()).map(graph=>graph.snapshot),before);
    const catalog=await repository.listRecords('exercise_catalog'),keys=catalog.map(row=>row.stable_key);
    assert.equal(new Set(keys).size,keys.length,'no duplicate catalog identities');
  }finally{repository.close();}
});

test('an off-season week trains the off-season program; a match week keeps the adapted Tuesday',async()=>{
  const previous=globalThis.localStorage;globalThis.localStorage=memory();
  const reset=installRolloutControl({snapshot:()=>({updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_routines_enabled:true,v3_signals_enabled:true,v3_coach_enabled:false}}),refreshIfDue:async()=>{}});
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  try{
    let today=new Date(2026,11,7,10);
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now:()=>today});
    setWeekMode(USER,'2026-12-07','off_season');
    const monday=await engine.createSession({dayIndex:1,useRoutine:true});
    assert.equal(monday.session.routine_id,await offSeasonRoutineId(USER,1));assert.equal(monday.exercises[0].catalog.stable_key,'press-banca');
    await engine.saveSet(monday.exercises[0].id,{load_kg:'60',reps:'8',duration_seconds:null,rir:'2',is_completed:true},{position:0});
    await engine.finishSession({rpe:7});
    assert.equal((await completedRoutineSessions(repository,{date:'2026-12-07',dayIndex:1,mode:'off_season'})).length,1);
    assert.equal((await completedRoutineSessions(repository,{date:'2026-12-07',dayIndex:1,mode:'match'})).length,0);
    today=new Date(2026,11,8,10);
    const tuesday=await engine.createSession({dayIndex:2,useRoutine:true,adaptTuesday:true});
    assert.equal(tuesday.session.routine_id,await offSeasonRoutineId(USER,2));
    assert.equal(tuesday.exercises.some(ex=>ex.prescription_snapshot.coach_adaptation),false);
    await engine.saveSet(tuesday.exercises[0].id,{load_kg:'',reps:'4',duration_seconds:null,rir:'',is_completed:true},{position:0});
    await engine.finishSession({rpe:7});
    setWeekMode(USER,'2026-12-15','match');today=new Date(2026,11,15,10);
    const season=await engine.createSession({dayIndex:2,useRoutine:true});
    assert.equal(season.session.routine_id,await defaultRoutineId(USER,2));assert.equal(season.session.routine_version,3);
  }finally{reset();repository.close();globalThis.localStorage=previous;}
});
