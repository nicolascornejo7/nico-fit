import test from 'node:test';
import assert from 'node:assert/strict';
import {PLYO_CATALOG,PLYO_LIMITS,PLYO_PROFILES,plyoEntries,plyoHint,weeklyPlyoSummary} from '../js/v3/plyometrics.js';
import {acuteChronic,weeklyOutlook} from '../js/v3/weekly-load.js';
import {BASE_EXERCISES} from '../js/v3/base-exercise-catalog.js';
import {exerciseProfile} from '../js/v3/exercise-recommendations.js';
import {exerciseFamily} from '../js/v3/exercise-family.js';
import {calculateCoachSignals} from '../js/v3/coach-signals.js';
import {applyCoachRules} from '../js/v3/coach-rules.js';
import {tuesdayDecision,mondayFootballLoad} from '../js/v3/tuesday-adaptation.js';

let number=0;
function session(date,items,{status='completed',deleted=false,rpe=7,minutes=60}={}){
  const id=`s-${++number}`;
  return {session:{id,session_date:date,session_type:'free_workout',status,deleted_at:deleted?'2026-11-01T00:00:00Z':null,rpe,started_at:`${date}T17:00:00.000Z`,ended_at:`${date}T18:00:00.000Z`,duration_seconds:minutes*60},
    exercises:items.map(([key,sets,reps,completed=true],index)=>({id:`${id}-e${index}`,exercise_catalog_id:`cat-${key}`,exercise_name_snapshot:key,prescription_snapshot:{sets,min:reps,max:reps},catalog:{stable_key:key,metadata:{body_region:'legs'}},
      sets:Array.from({length:sets},(_,position)=>({id:`${id}-e${index}-s${position}`,position,reps,load_kg:null,rir:3,is_completed:completed,completed_at:`${date}T17:30:00.000Z`}))}))};
}

test('plyometric catalog entries are unique, profiled, legs and every profile has a hint',()=>{
  const keys=BASE_EXERCISES.map(row=>row.stable_key);
  assert.equal(new Set(keys).size,keys.length);
  for(const [key] of PLYO_CATALOG){
    const row=BASE_EXERCISES.find(item=>item.stable_key===key);
    assert.ok(row,`missing catalog row ${key}`);assert.equal(row.measurement_kind,'reps');assert.equal(exerciseFamily(row),'legs');
    assert.ok(PLYO_PROFILES[key],`missing plyo profile ${key}`);assert.ok(exerciseProfile(row),`missing exercise profile ${key}`);
  }
  assert.ok(!PLYO_CATALOG.some(([key])=>key==='saltos-verticales'),'routine-owned key must not be duplicated in the base catalog');
  for(const key of Object.keys(PLYO_PROFILES))assert.ok(plyoHint(key));
  assert.equal(plyoHint('press-banca'),null);
});

test('contacts and sprint meters derive from completed reps only',()=>{
  const history=[
    session('2026-11-10',[['salto-cajon',3,5],['sprint-20m',4,1],['press-banca',3,8]]),
    session('2026-11-10',[['drop-jump',3,6]],{status:'draft'}),
    session('2026-11-10',[['drop-jump',3,6]],{deleted:true}),
    session('2026-11-10',[['bounds',2,6,false]])
  ];
  const rows=plyoEntries(history);
  assert.equal(rows.filter(row=>row.kind==='jump').reduce((sum,row)=>sum+row.contacts,0),15);
  assert.equal(rows.filter(row=>row.kind==='sprint').reduce((sum,row)=>sum+row.meters,0),80);
  assert.equal(rows.length,7);
});

test('weekly plyo summary uses a rolling 7-day window, caps and 48h high-intensity flag',()=>{
  const history=[
    session('2026-11-03',[['salto-cajon',10,10]]),
    session('2026-11-06',[['pogo-saltos',4,20]]),
    session('2026-11-11',[['drop-jump',4,8],['saltos-vallas',4,10]])
  ];
  const summary=weeklyPlyoSummary(history,{date:'2026-11-12'});
  assert.equal(summary.contacts,80+32+40);
  assert.deepEqual(summary.byIntensity,{low:80,moderate:0,high:72});
  assert.equal(summary.overWeekly,false);assert.equal(summary.overHigh,true);
  assert.equal(summary.highLast48h,72);
  assert.equal(weeklyPlyoSummary(history,{date:'2026-11-14'}).highLast48h,0);
});

test('acute:chronic ratio needs three weeks of records and classifies zones',()=>{
  const rows=week=>[{date:week,load:1000}];
  assert.equal(acuteChronic(rows('2026-11-12'),'2026-11-12').zone,'unknown');
  const steady=[...rows('2026-11-12'),...rows('2026-11-05'),...rows('2026-10-29'),...rows('2026-10-22')];
  const result=acuteChronic(steady,'2026-11-12');
  assert.equal(result.acwr,1);assert.equal(result.zone,'optimal');
  const spike=acuteChronic([{date:'2026-11-12',load:3000},...steady.slice(1)],'2026-11-12');
  assert.equal(spike.acwr,2);assert.equal(spike.zone,'danger');
  assert.equal(acuteChronic([{date:'2026-11-12',load:300},...steady.slice(1)],'2026-11-12').zone,'low');
});

test('traffic light escalates with readiness, pain, load spikes and intense plyo near the match',()=>{
  const steady=['2026-11-12','2026-11-05','2026-10-29','2026-10-22'].map(date=>({date,load:1000}));
  const base={date:'2026-11-12',footballRows:steady,gymRows:[],daysToMatch:2};
  assert.equal(weeklyOutlook({...base,readinessScore:85,pain:0}).level,'green');
  assert.equal(weeklyOutlook({...base,readinessScore:55,pain:0}).level,'yellow');
  assert.equal(weeklyOutlook({...base,readinessScore:85,pain:7}).level,'red');
  assert.equal(weeklyOutlook({...base,footballRows:[{date:'2026-11-12',load:3000},...steady.slice(1)],readinessScore:85,pain:0}).level,'red');
  const plyo={contacts:40,byIntensity:{low:0,moderate:0,high:40},sprintMeters:0,highLast48h:40,overWeekly:false,overHigh:false,limits:PLYO_LIMITS};
  const near=weeklyOutlook({...base,readinessScore:85,pain:0,plyo});
  assert.equal(near.level,'yellow');assert.ok(near.reasons.some(reason=>reason.includes('48 h')));
  const missing=weeklyOutlook({...base,readinessScore:null,pain:null});
  assert.ok(missing.reasons.some(reason=>reason.includes('Sin check-in')));
  // Red is never downgraded by a later yellow signal.
  assert.equal(weeklyOutlook({...base,readinessScore:30,pain:5}).level,'red');
});

test('coach removes high-intensity plyometrics two days before Saturday and keeps activation the day before',()=>{
  const readiness=date=>[{id:`r-${date}`,date,sleep:5,energy:5,freshness:5,pain:0}];
  const snapshot=date=>{const item=session(date,[['drop-jump',3,6,false],['salto-cajon',3,5,false]],{status:'draft'});return {...item,conflicts:[]};};
  const thursday=calculateCoachSignals({date:'2026-11-12',readiness:readiness('2026-11-12')});
  const thu=applyCoachRules(thursday,snapshot('2026-11-12'));
  const [drop,box]=thu.exerciseAdjustments;
  assert.equal(drop.action,'avoid_high_plyo');assert.equal(drop.suggestedSets,0);
  assert.notEqual(box.action,'avoid_high_plyo');
  assert.ok(thursday.weekly&&thursday.plyo);
  const friday=applyCoachRules(calculateCoachSignals({date:'2026-11-13',readiness:readiness('2026-11-13')}),snapshot('2026-11-13'));
  assert.equal(friday.exerciseAdjustments[0].action,'avoid_high_plyo');
  assert.equal(friday.exerciseAdjustments[1].action,'activation');assert.ok(friday.exerciseAdjustments[1].suggestedSets<=2);
});

test('Monday football shifts Tuesday only when intense, and is part of the evidence',()=>{
  const now=new Date(2026,10,10,10),readiness=[{id:'r',date:'2026-11-10',sleep:5,energy:5,freshness:5,pain:0}];
  const regular=[{id:'f1',date:'2026-11-09',duration:75,rpe:6}],intense=[{id:'f2',date:'2026-11-09',duration:90,rpe:8}];
  assert.equal(mondayFootballLoad({football:regular,monday:'2026-11-09'}).intense,false);
  assert.equal(mondayFootballLoad({football:intense,monday:'2026-11-09'}).intense,true);
  const none=tuesdayDecision({history:[],readiness,now}),calm=tuesdayDecision({history:[],readiness,football:regular,now}),hard=tuesdayDecision({history:[],readiness,football:intense,now});
  assert.equal(none.recommendedVariant,'normal');assert.equal(calm.recommendedVariant,'normal');
  assert.equal(hard.legLoad.class,'moderate');assert.equal(hard.legLoad.gymClass,'none');assert.equal(hard.recommendedVariant,'reduced');
  assert.ok(hard.reasons.some(reason=>reason.includes('fútbol')));
  assert.notEqual(hard.evidenceKey,none.evidenceKey);
  const gymModerate=session('2026-11-09',[['sentadilla-prensa',3,8]]);gymModerate.session.started_at=new Date(2026,10,9,18).toISOString();gymModerate.session.ended_at=new Date(2026,10,9,19).toISOString();
  for(const exercise of gymModerate.exercises)for(const set of exercise.sets)set.completed_at=new Date(2026,10,9,18,30).toISOString();
  assert.equal(tuesdayDecision({history:[gymModerate],readiness,football:intense,now}).recommendedVariant,'leg_recovery');
});
