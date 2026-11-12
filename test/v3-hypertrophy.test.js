import test from 'node:test';
import assert from 'node:assert/strict';
import {weekStart,isHardSet,weeklyMuscleVolume,personalRecords,liveSetRecord,mesocycleStatus,MESOCYCLE} from '../js/v3/hypertrophy.js';
import {calculateCoachSignals} from '../js/v3/coach-signals.js';
import {applyCoachRules} from '../js/v3/coach-rules.js';

let number=0;
// items: [stableKey, [[kg,reps,rir], ...]]
function session(date,items,{status='completed',deleted=false}={}){
  const id=`s-${++number}`;
  return {session:{id,session_date:date,status,deleted_at:deleted?'2026-11-01T00:00:00Z':null,rpe:7,started_at:`${date}T17:00:00.000Z`,ended_at:`${date}T18:00:00.000Z`},
    exercises:items.map(([key,sets],index)=>({id:`${id}-e${index}`,session_id:id,exercise_catalog_id:`cat-${key}`,exercise_name_snapshot:key,prescription_snapshot:{sets:sets.length,min:6,max:10},catalog:{stable_key:key},
      sets:sets.map(([load_kg,reps,rir],position)=>({id:`${id}-e${index}-s${position}`,position,load_kg,reps,rir,is_completed:true}))}))};
}
const hard=(count,kg=60,reps=8,rir=2)=>Array.from({length:count},()=>[kg,reps,rir]);

test('weeks start on Monday so each week ends with the Saturday match',()=>{
  assert.equal(weekStart('2026-11-12'),'2026-11-09');
  assert.equal(weekStart('2026-11-09'),'2026-11-09');
  assert.equal(weekStart('2026-11-15'),'2026-11-09');
});

test('hard sets need effort and RIR ≤ 3 (unknown RIR counts)',()=>{
  assert.equal(isHardSet({reps:8,rir:2}),true);
  assert.equal(isHardSet({reps:8,rir:null}),true);
  assert.equal(isHardSet({reps:8,rir:4}),false);
  assert.equal(isHardSet({reps:0,rir:1}),false);
});

test('weekly muscle volume counts primary as 1 and secondary as ½, skipping activation and power work',()=>{
  const history=[
    session('2026-11-10',[['press-banca',hard(3)],['sentadilla-ligera',hard(3)],['saltos-verticales',hard(3)],['remo-barra',[[60,8,2],[60,8,5]]]]),
    session('2026-11-02',[['press-banca',hard(10)]]),
    session('2026-11-11',[['press-banca',hard(4)]],{status:'draft'})
  ];
  const week=weeklyMuscleVolume(history,{date:'2026-11-12'});
  const by=Object.fromEntries(week.muscles.map(row=>[row.muscle,row]));
  assert.equal(by.chest.sets,3);assert.equal(by.triceps.sets,1.5);assert.equal(by.deltoids.sets,1.5);
  assert.equal(by.quadriceps.sets,0);
  assert.equal(by.upper_back.sets,1);assert.equal(by.biceps.sets,0.5);
  assert.equal(by.chest.status,'low');assert.ok(week.untrained.includes('Cuádriceps'));
  assert.equal(week.hardSets,4);
});

test('records: first session is a baseline; later load, e1RM and rep PRs are detected',()=>{
  const history=[
    session('2026-10-01',[['press-banca',[[60,8,2],[60,8,2]]]]),
    session('2026-10-08',[['press-banca',[[60,10,1]]]]),
    session('2026-10-15',[['press-banca',[[65,6,1]]]])
  ];
  const {records,best}=personalRecords(history);
  assert.deepEqual(records.map(row=>[row.date,row.type]),[['2026-10-08','e1rm'],['2026-10-08','reps'],['2026-10-15','load']]);
  const bench=best.get('cat-press-banca');
  assert.equal(bench.maxLoad,65);assert.equal(bench.repsAt.get(60),10);
  assert.equal(liveSetRecord({load_kg:70,reps:3},bench).type,'load');
  assert.equal(liveSetRecord({load_kg:60,reps:11},bench).type,'e1rm');
  assert.equal(liveSetRecord({load_kg:60,reps:9},bench),null);
  assert.equal(liveSetRecord({load_kg:60,reps:9},undefined),null);
});

const weeks=(count,{from='2026-11-09',sets=12}={})=>Array.from({length:count},(_,index)=>{const day=new Date(Date.parse(`${from}T12:00:00Z`)-(index+1)*7*86400000).toISOString().slice(0,10);return session(day,[['press-banca',hard(sets)]]);});

test('mesocycle counts loading weeks and asks for a deload after five',()=>{
  const date='2026-11-12';
  assert.equal(mesocycleStatus(weeks(2),{date}).enoughData,false);
  const four=mesocycleStatus(weeks(4),{date});assert.equal(four.loadingWeeks,4);assert.equal(four.deloadDue,false);assert.equal(four.week,5);
  const five=mesocycleStatus(weeks(5),{date});assert.equal(five.deloadDue,true);
  // A light week (≤60% of recent average) resets the count.
  const withDeload=[...weeks(2),session('2026-10-20',[['press-banca',hard(4)]]),...weeks(6).slice(3)];
  const reset=mesocycleStatus(withDeload,{date});assert.equal(reset.loadingWeeks,2);assert.equal(reset.deloadDue,false);
});

test('coach turns a normal day into a deload week, but match-week rules keep priority',()=>{
  const ready=date=>[{id:`r-${date}`,date,sleep:5,energy:5,freshness:5,pain:0}];
  const today=(date)=>({...session(date,[['press-banca',[[null,null,null],[null,null,null],[null,null,null],[null,null,null]]]],{status:'draft'}),conflicts:[]});
  const history=weeks(MESOCYCLE.loadingWeeks);
  const tuesday=applyCoachRules(calculateCoachSignals({date:'2026-11-10',readiness:ready('2026-11-10'),history}),today('2026-11-10'));
  assert.equal(tuesday.recommendationLevel,'deload');assert.equal(tuesday.title,'Semana de descarga');
  assert.equal(tuesday.exerciseAdjustments[0].action,'deload');assert.equal(tuesday.exerciseAdjustments[0].suggestedSets,2);assert.equal(tuesday.exerciseAdjustments[0].targetRir,4);
  const friday=applyCoachRules(calculateCoachSignals({date:'2026-11-13',readiness:ready('2026-11-13'),history}),today('2026-11-13'));
  assert.equal(friday.recommendationLevel,'activation');
  const early=applyCoachRules(calculateCoachSignals({date:'2026-11-10',readiness:ready('2026-11-10'),history:weeks(3)}),today('2026-11-10'));
  assert.notEqual(early.recommendationLevel,'deload');
});
