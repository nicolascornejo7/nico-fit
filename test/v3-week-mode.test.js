import test from 'node:test';
import assert from 'node:assert/strict';
import {weekModeFor,setWeekMode,weekStartOf} from '../js/v3/week-mode.js';
import {calculateCoachSignals} from '../js/v3/coach-signals.js';
import {applyCoachRules} from '../js/v3/coach-rules.js';
import {progressionSuggestion} from '../js/progression.js';
import {weeklyMuscleVolume} from '../js/v3/hypertrophy.js';
import {weekRecommendations,cardioPlan,MATCH_LOAD_ESTIMATE} from '../js/v3/week-recommendations.js';
import {BASE_EXERCISES} from '../js/v3/base-exercise-catalog.js';

const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};};
const USER='u1';

test('week mode is per user and week; off-season persists until switched back',()=>{
  const storage=memory();
  assert.equal(weekStartOf('2026-11-13'),'2026-11-09');
  assert.equal(weekModeFor(USER,'2026-11-13',{storage}),'match');
  assert.equal(setWeekMode(USER,'2026-11-12','no_match',{storage}),'no_match');
  assert.equal(weekModeFor(USER,'2026-11-15',{storage}),'no_match');assert.equal(weekModeFor(USER,'2026-11-18',{storage}),'match');
  assert.equal(weekModeFor('other','2026-11-12',{storage}),'match');
  setWeekMode(USER,'2026-11-18','off_season',{storage});
  assert.equal(weekModeFor(USER,'2026-12-20',{storage}),'off_season');assert.equal(weekModeFor(USER,'2026-11-12',{storage}),'no_match');
  setWeekMode(USER,'2027-01-05','match',{storage});assert.equal(weekModeFor(USER,'2027-01-05',{storage}),'match');
  assert.throws(()=>setWeekMode(USER,'2026-11-12','holiday',{storage}),/inválido/);
  assert.equal(weekModeFor(USER,'2026-11-12',{storage:{getItem:()=>{throw new Error('blocked');}}}),'match');
});

const ready=date=>[{id:`r-${date}`,date,sleep:5,energy:5,freshness:5,pain:0}];
const fridaySession={session:{id:'s',started_at:'2026-11-13T17:00:00Z'},exercises:[{id:'e',exercise_catalog_id:'c',exercise_name_snapshot:'Sentadilla',prescription_snapshot:{sets:3},catalog:{stable_key:'sentadilla-prensa',metadata:{body_region:'legs'}},sets:[]}],conflicts:[]};

test('without a match the Friday activation and pre-match leg blocks are lifted',()=>{
  const match=applyCoachRules(calculateCoachSignals({date:'2026-11-13',readiness:ready('2026-11-13')}),fridaySession);
  assert.equal(match.recommendationLevel,'activation');
  const signals=calculateCoachSignals({date:'2026-11-13',readiness:ready('2026-11-13'),weekMode:'no_match'});
  assert.equal(signals.hasMatch,false);assert.equal(signals.daysToMatch,7);assert.match(signals.weekly.title,/Semana sin partido/);
  const free=applyCoachRules(signals,fridaySession);
  assert.notEqual(free.recommendationLevel,'activation');assert.notEqual(free.exerciseAdjustments[0].action,'avoid_leg_progression');
  assert.ok(free.reasons.some(reason=>reason.includes('semana sin partido')));
  assert.equal(calculateCoachSignals({date:'2026-11-15',readiness:ready('2026-11-15'),weekMode:'no_match'}).dayIndex,0);
});

test('progression is allowed on a Friday without a match',()=>{
  const previous={date:'2026-11-06',sets:[{kg:60,reps:10,rir:2,done:true},{kg:60,reps:10,rir:2,done:true},{kg:60,reps:10,rir:2,done:true}]};
  const exercise={sets:3,min:6,max:10,step:2.5},friday=new Date('2026-11-13T12:00:00');
  assert.equal(progressionSuggestion({exercise,previous,dayIndex:5,now:friday}).kg,60);
  assert.equal(progressionSuggestion({exercise,previous,dayIndex:5,now:friday,hasMatch:false}).kg,62.5);
});

test('off-season raises leg targets to normal hypertrophy ranges',()=>{
  const inSeason=weeklyMuscleVolume([],{date:'2026-11-12'}),off=weeklyMuscleVolume([],{date:'2026-11-12',mode:'off_season'});
  const range=(volume,muscle)=>{const row=volume.muscles.find(item=>item.muscle===muscle);return [row.min,row.max];};
  assert.deepEqual(range(inSeason,'quadriceps'),[6,12]);assert.deepEqual(range(off,'quadriceps'),[10,20]);assert.deepEqual(range(off,'chest'),range(inSeason,'chest'));
});

const catalog=BASE_EXERCISES.map((row,index)=>({...row,id:`c${index}`}));
const id=key=>catalog.find(row=>row.stable_key===key).id;
const benchWeek={session:{id:'w',session_date:'2026-11-10',status:'completed'},exercises:[{id:'x',exercise_catalog_id:id('press-banca'),catalog:catalog.find(row=>row.stable_key==='press-banca'),sets:Array.from({length:4},(_,position)=>({id:`s${position}`,position,reps:8,rir:2,is_completed:true}))}]};

test('recommendations target the biggest muscle gaps with exercises not done this week',()=>{
  const signals={weekly:{level:'green',sufficient:false},history:[benchWeek],daysToMatch:2,hasMatch:true};
  const thursday=weekRecommendations({mode:'match',date:'2026-11-12',signals,catalog});
  assert.equal(thursday.cardio,null);assert.ok(thursday.notes.some(note=>note.includes('Partido cerca')));
  assert.ok(thursday.strength.every(row=>!['quadriceps','hamstrings','glutes','calves','adductors'].includes(row.muscle)));
  const chest=thursday.strength.find(row=>row.muscle==='chest');
  if(chest)assert.ok(!chest.exercises.includes('Press banca'),'already trained this week goes last');
  const off=weekRecommendations({mode:'off_season',date:'2026-11-12',signals:{...signals,daysToMatch:7,hasMatch:false},catalog});
  assert.ok(off.strength.some(row=>['quadriceps','hamstrings','glutes'].includes(row.muscle)));
  assert.equal(off.strength.length,3);assert.ok(off.strength.every(row=>row.exercises.length>0&&row.exercises.length<=2));
  assert.equal(off.cardio.sessions,2);
  const red=weekRecommendations({mode:'no_match',date:'2026-11-14',signals:{...signals,weekly:{level:'red',sufficient:false}},catalog});
  assert.ok(red.notes[0].startsWith('Semáforo en rojo'));assert.ok(red.notes.some(note=>note.startsWith('Sábado sin partido')));
});

test('cardio turns the missing load into minutes at a target RPE',()=>{
  assert.equal(cardioPlan({mode:'match',weekly:{}}),null);
  const fallback=cardioPlan({mode:'no_match',weekly:{sufficient:false}});
  assert.equal(fallback.target,MATCH_LOAD_ESTIMATE);assert.match(fallback.options[0],/60 min a RPE 5/);assert.match(fallback.detail,/referencia/);
  const missing=cardioPlan({mode:'no_match',weekly:{sufficient:true,chronic:1800,acute:1600}});
  assert.equal(missing.missing,200);assert.match(missing.options[0],/40 min a RPE 5/);assert.match(missing.detail,/≈200 AU/);
  const covered=cardioPlan({mode:'off_season',weekly:{sufficient:true,chronic:1000,acute:1200}});
  assert.equal(covered.missing,0);assert.match(covered.detail,/mantener la base/);assert.match(covered.options[0],/20 min/);
});
