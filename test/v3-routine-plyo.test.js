import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {WEEKLY_PROGRAM_V64,WEEKLY_PROGRAM_V3,latestRoutineVersion} from '../js/v3/weekly-program-v64.js';
import {plyoProfile,PLYO_LIMITS} from '../js/v3/plyometrics.js';
import {tuesdayDecision,effectiveTuesdayExercises} from '../js/v3/tuesday-adaptation.js';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3RoutineService} from '../js/v3/routine-service.js';
import {stableClientUuid} from '../js/v3/import-v2.js';
import {calculateCoachSignals} from '../js/v3/coach-signals.js';
import {applyCoachRules} from '../js/v3/coach-rules.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const contacts=day=>WEEKLY_PROGRAM_V3[day].exercises.filter(row=>plyoProfile(row.stable_key)).reduce((sum,row)=>sum+row.sets*row.max*plyoProfile(row.stable_key).contactsPerRep,0);

test('version 3 opens Tuesday and Thursday with plyometrics, keeps every v2 exercise and leaves Friday on v2',()=>{
  for(const day of [2,4]){
    const v3=WEEKLY_PROGRAM_V3[day].exercises.map(row=>row.stable_key),v2=WEEKLY_PROGRAM_V64[day].exercises.map(row=>row.stable_key);
    assert.deepEqual(v3.slice(2),v2);assert.ok(v3.slice(0,2).every(key=>plyoProfile(key)?.kind==='jump'));
  }
  assert.equal(WEEKLY_PROGRAM_V3[5],undefined);
  assert.deepEqual([2,4,5].map(latestRoutineVersion),[3,3,2]);
  // Thursday is two days before the match: nothing high intensity.
  assert.ok(WEEKLY_PROGRAM_V3[4].exercises.filter(row=>plyoProfile(row.stable_key)).every(row=>plyoProfile(row.stable_key).intensity!=='high'));
  assert.equal(contacts(2),21);assert.equal(contacts(4),26);
  assert.ok(contacts(2)+contacts(4)+6<PLYO_LIMITS.weeklyContacts/3);
});

test('seeding publishes deterministic v3 graphs on top of v2 and is idempotent',async()=>{
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  try{
    const service=new V3RoutineService({repository,featureEnabled:true}),latest=await service.seedDefaults(),count=(await repository.listOperations()).length;
    assert.deepEqual(latest.map(row=>[row.version.day_index,row.version.version_number]),[[2,3],[4,3],[5,2]]);
    for(const graph of latest.slice(0,2)){
      assert.equal(graph.version.id,await stableClientUuid(`v3:routine-version:${graph.template.id}:3`));
      assert.deepEqual(graph.exercises.map(row=>row.id),await Promise.all(graph.exercises.map((_,position)=>stableClientUuid(`v3:routine-version:${graph.template.id}:3:exercise:${position}`))));
      const v2=await service.version(await stableClientUuid(`v3:routine-version:${graph.template.id}:2`));
      assert.equal(v2.version.version_number,2);assert.equal(graph.exercises.length,v2.exercises.length+2);
    }
    await service.seedDefaults();assert.equal((await repository.listOperations()).length,count);
  }finally{repository.close();}
});

test('Tuesday adaptation scales v3 plyometrics and still adapts a v2 base',()=>{
  const now=new Date(2026,10,10,10),readiness=[{id:'r',date:'2026-11-10',sleep:5,energy:5,freshness:5,pain:0}];
  const intense=[{id:'f',date:'2026-11-09',duration:90,rpe:8}];
  const normal=tuesdayDecision({history:[],readiness,now}),reduced=tuesdayDecision({history:[],readiness,football:intense,now});
  const sets=(decision,key)=>decision.affected.find(row=>row.stableKey===key)?.sets;
  assert.equal(normal.routineVersion,3);assert.equal(sets(normal,'salto-cajon'),3);assert.equal(sets(normal,'salto-longitud'),3);
  assert.equal(reduced.selectedVariant,'reduced');assert.equal(sets(reduced,'salto-cajon'),2);assert.equal(sets(reduced,'salto-longitud'),0);
  const v2Decision=tuesdayDecision({history:[],readiness,now,routineVersion:2});
  assert.equal(v2Decision.affected.some(row=>row.stableKey==='salto-cajon'),false);assert.equal(v2Decision.totalSets,19);
  const ids=new Map(WEEKLY_PROGRAM_V64[2].exercises.map((row,index)=>[row.stable_key,`c${index}`]));
  const base={routine_version:2,day_index:2,routine_version_id:'v2',exercises:WEEKLY_PROGRAM_V64[2].exercises.map(row=>({exercise_catalog_id:ids.get(row.stable_key),prescription_snapshot:{sets:row.sets}}))};
  const catalog=[...ids].map(([stable_key,id])=>({id,stable_key}));
  assert.equal(effectiveTuesdayExercises(base,v2Decision,catalog).length,7);
  assert.throws(()=>effectiveTuesdayExercises(base,normal,catalog),error=>error.code==='COACH_PLAN_CHANGED');
});

test('Thursday v3 plyometrics stay in the plan two days before the match while high-intensity jumps would not',()=>{
  const signals=calculateCoachSignals({date:'2026-11-12',readiness:[{id:'r',date:'2026-11-12',sleep:5,energy:5,freshness:5,pain:0}]});
  const exercises=[...WEEKLY_PROGRAM_V3[4].exercises.slice(0,2),{stable_key:'drop-jump',sets:3}].map((row,index)=>({id:`e${index}`,exercise_catalog_id:`c${index}`,exercise_name_snapshot:row.stable_key,prescription_snapshot:{sets:row.sets},catalog:{stable_key:row.stable_key},sets:[]}));
  const result=applyCoachRules(signals,{session:{id:'s',started_at:'2026-11-12T17:00:00Z'},exercises,conflicts:[]});
  assert.notEqual(result.exerciseAdjustments[0].action,'avoid_high_plyo');assert.notEqual(result.exerciseAdjustments[1].action,'avoid_high_plyo');
  assert.equal(result.exerciseAdjustments[2].action,'avoid_high_plyo');
});
