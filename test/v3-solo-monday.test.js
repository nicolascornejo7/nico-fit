import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {SOLO_MONDAY_PROGRAM,gymDaysFor} from '../js/v3/offseason-program.js';
import {BASE_EXERCISES} from '../js/v3/base-exercise-catalog.js';
import {exerciseProfile} from '../js/v3/exercise-recommendations.js';
import {mondayWithTeam,setMondayWithTeam,setWeekMode,weekModeFor} from '../js/v3/week-mode.js';
import {V3LocalRepository} from '../js/v3/repository.js';
import {soloMondayRoutineId} from '../js/v3/routine-service.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {V3CoachService} from '../js/v3/coach-service.js';
import {completedRoutineSessions} from '../js/v3/completed-today.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';
import {weeklyMuscleVolume} from '../js/v3/hypertrophy.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};};

test('Monday with or without the team is stored per week and keeps the week mode',()=>{
  const storage=memory();
  assert.equal(mondayWithTeam(USER,'2026-11-16',{storage}),true);
  setWeekMode(USER,'2026-11-16','no_match',{storage});
  assert.equal(setMondayWithTeam(USER,'2026-11-18',false,{storage}),false);
  assert.equal(mondayWithTeam(USER,'2026-11-16',{storage}),false);assert.equal(weekModeFor(USER,'2026-11-16',{storage}),'no_match');
  assert.equal(mondayWithTeam(USER,'2026-11-23',{storage}),true);
  setMondayWithTeam(USER,'2026-11-16',true,{storage});assert.equal(mondayWithTeam(USER,'2026-11-16',{storage}),true);
  assert.deepEqual(gymDaysFor('match',{mondaySolo:true}),[1,2,4,5]);assert.deepEqual(gymDaysFor('off_season',{mondaySolo:true}),[1,2,4,5]);
});

test('the solo Monday program replaces conditioning without leg strength work',()=>{
  const items=SOLO_MONDAY_PROGRAM[1].exercises;
  assert.equal(items[0].stable_key,'intervalos-cardio');assert.equal(items[0].sets*items[0].max,960);
  for(const item of items){
    const base=BASE_EXERCISES.find(row=>row.stable_key===item.stable_key);assert.ok(base,item.stable_key);assert.equal(base.measurement_kind,item.measurement_kind,item.stable_key);
    const profile=exerciseProfile(base);
    if(item.stable_key!=='intervalos-cardio')assert.ok(!profile.primary_muscles.some(muscle=>['quadriceps','hamstrings','glutes','calves'].includes(muscle)),`${item.stable_key} loads the legs`);
  }
  // Intervals never count as hypertrophy sets.
  const history=[{session:{id:'s',session_date:'2026-11-16',status:'completed'},exercises:[{id:'e',exercise_catalog_id:'c',catalog:{stable_key:'intervalos-cardio'},sets:[{id:'x',position:0,duration_seconds:240,rir:null,is_completed:true}]}]}];
  assert.equal(weeklyMuscleVolume(history,{date:'2026-11-16'}).hardSets,0);
});

test('a solo Monday trains its routine and Tuesday still gets the complete leg session',async()=>{
  const previous=globalThis.localStorage;globalThis.localStorage=memory();
  const reset=installRolloutControl({snapshot:()=>({updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_routines_enabled:true,v3_signals_enabled:true,v3_coach_enabled:false}}),refreshIfDue:async()=>{}});
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  try{
    let today=new Date(2026,10,16,18);
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now:()=>today});
    setMondayWithTeam(USER,'2026-11-16',false);
    const monday=await engine.createSession({dayIndex:1,useRoutine:true});
    assert.equal(monday.session.routine_id,await soloMondayRoutineId(USER));assert.equal(monday.exercises[0].catalog.stable_key,'intervalos-cardio');
    for(const [index,exercise] of monday.exercises.slice(0,3).entries())await engine.saveSet(exercise.id,index===0?{load_kg:'',reps:null,duration_seconds:'240',rir:'',is_completed:true}:{load_kg:'50',reps:'10',duration_seconds:null,rir:'2',is_completed:true},{position:0});
    await engine.finishSession({rpe:7});
    assert.equal((await completedRoutineSessions(repository,{date:'2026-11-16',dayIndex:1,mondaySolo:true})).length,1);
    today=new Date(2026,10,17,10);
    const readiness=[{id:'r',date:'2026-11-17',sleep:5,energy:5,freshness:5,pain:0}];
    const plan=await new V3CoachService({engine,featureEnabled:true,now:()=>today,readContext:async()=>({readiness,football:[],matches:[],warnings:[],hasConflicts:false})}).tuesdayPlan({base:(await engine.routines.seedDefaults())[0].snapshot});
    assert.equal(plan.legLoad.primarySets,0);assert.equal(plan.recommendedVariant,'normal');
    setMondayWithTeam(USER,'2026-11-23',true);today=new Date(2026,10,23,18);
    const withTeam=await engine.createSession({dayIndex:1,useRoutine:true});
    assert.equal(withTeam.session.routine_id??null,null,'with the team, Monday has no gym routine');
  }finally{reset();repository.close();globalThis.localStorage=previous;}
});
