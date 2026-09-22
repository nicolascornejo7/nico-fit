import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateCoachSignals,dateStamp,loadTrend} from '../js/v3/coach-signals.js';
import {applyCoachRules} from '../js/v3/coach-rules.js';
import {V3CoachService} from '../js/v3/coach-service.js';
import {isV3CoachEnabled,setV3CoachEnabled} from '../js/v3/feature-flags.js';

const date='2026-09-15'; // Tuesday
const ready=(values={})=>({date,sleep:5,energy:5,fatigue:1,pain:0,...values});
function snapshot(day=date,id='active'){
  return {session:{id,session_date:day,started_at:`${day}T10:00:00Z`,ended_at:null,status:'draft'},conflicts:[],exercises:[{id:'occurrence',exercise_catalog_id:'catalog',exercise_name_snapshot:'Press',catalog:{stable_key:'press-banca'},prescription_snapshot:{sets:3,min:6,max:10,step:2.5,measurement_kind:'reps'},sets:[]}]};
}
function previous(day='2026-09-08'){
  const item=snapshot(day,'previous');Object.assign(item.session,{status:'completed',ended_at:`${day}T11:00:00Z`,rpe:7});
  item.exercises[0].sets=Array.from({length:3},(_,i)=>({id:`set${i}`,is_completed:true,load_kg:50,reps:10,rir:2}));return item;
}
function freeWorkout(day='2026-09-14',stableKey='sentadilla-prensa'){
  const item={session:{id:`free-${stableKey}`,session_date:day,started_at:`${day}T10:00:00Z`,ended_at:`${day}T11:00:00Z`,status:'completed',session_type:'free_workout',rpe:8},exercises:[{id:`free-ex-${stableKey}`,exercise_catalog_id:`free-catalog-${stableKey}`,exercise_name_snapshot:stableKey,catalog:{stable_key:stableKey},prescription_snapshot:{sets:3,measurement_kind:'reps'},sets:[]}],conflicts:[]};
  item.exercises[0].sets=Array.from({length:3},(_,i)=>({id:`free-set-${i}`,is_completed:true,load_kg:100,reps:8,rir:2}));return item;
}
const coach=(options={},active=snapshot())=>applyCoachRules(calculateCoachSignals({date,readiness:[ready()],history:[previous()],...options}),active);

test('Tuesday high readiness progresses only with completed targets and margin',()=>{
  const result=coach();assert.equal(result.readinessScore,100);assert.equal(result.recommendationLevel,'progress');assert.equal(result.exerciseAdjustments[0].suggestedLoad,52.5);assert.ok(result.reasons.length);
});
test('Tuesday low readiness reduces volume before pursuing load',()=>{
  const result=coach({readiness:[ready({sleep:2,energy:2,fatigue:4})]});assert.equal(result.recommendationLevel,'reduce');assert.equal(result.exerciseAdjustments[0].suggestedSets,1);assert.equal(result.exerciseAdjustments[0].suggestedLoad,50);
});
test('Thursday after intense football blocks progression and reduces series',()=>{
  const day='2026-09-17',result=coach({date:day,readiness:[ready({date:day})],history:[previous('2026-09-10')],football:[{date:'2026-09-16',duration:90,rpe:9}]},snapshot(day));assert.equal(result.recommendationLevel,'reduce');assert.match(result.reasons.join(' '),/fútbol intenso/);assert.equal(result.exerciseAdjustments[0].action,'reduce_sets');
});
test('Friday pre-match takes precedence over valid progression',()=>{
  const day='2026-09-18',result=coach({date:day,readiness:[ready({date:day})],history:[previous('2026-09-11')]},snapshot(day));assert.equal(result.recommendationLevel,'activation');assert.equal(result.exerciseAdjustments[0].suggestedLoad,40);assert.equal(result.exerciseAdjustments[0].targetRir,4);
});
test('high pain recommends recovery and relevant pain blocks increases',()=>{
  assert.equal(coach({readiness:[ready({pain:8})]}).recommendationLevel,'recovery');const result=coach({readiness:[ready({pain:4})]});assert.equal(result.exerciseAdjustments[0].action,'reduce_load');assert.equal(result.exerciseAdjustments[0].suggestedLoad,45);
});
test('incomplete sets and unknown RIR cannot justify progression',()=>{
  const history=[previous()];history[0].exercises[0].sets[2].is_completed=false;assert.equal(coach({history}).exerciseAdjustments[0].action,'maintain_load');
  history[0].exercises[0].sets[2].is_completed=true;history[0].exercises[0].sets[0].rir=null;assert.equal(coach({history}).exerciseAdjustments[0].action,'maintain_load');
});
test('high prior RPE and synchronization conflict block valid load progression',()=>{
  const history=[previous()];history[0].session.rpe=9;assert.equal(coach({history}).exerciseAdjustments[0].action,'maintain_load');
  const active=snapshot();active.exercises[0].sync_status='conflict';assert.equal(coach({},active).exerciseAdjustments[0].action,'maintain_load');
  history[0].session.rpe=7;history[0].exercises[0].sets[0].sync_status='conflict';assert.equal(coach({history}).exerciseAdjustments[0].action,'maintain_load');
});
test('little history and missing readiness use conservative general rules',()=>{
  const result=coach({history:[],readiness:[]});assert.equal(result.readinessScore,null);assert.equal(result.recommendationLevel,'maintain');assert.ok(result.warnings.length>=2);assert.ok(result.reasons.every(reason=>reason.startsWith('Regla general:')));
});
test('growing weekly load uses four prior observed windows',()=>{
  const football=[0,7,14,21,28].map((days,i)=>({date:new Date(dateStamp(date)-days*86400000).toISOString().slice(0,10),duration:i===0?118:100,rpe:5}));
  const result=coach({football});assert.equal(result.recommendationLevel,'reduce');assert.match(result.reasons.join(' '),/\+18%/);
  assert.equal(loadTrend([{date,load:10}],date).changePercent,null);
});
test('sufficient personal history explains associations without claiming causality',()=>{
  const history=[],readiness=[ready()],matches=[];
  for(let i=1;i<=6;i++){const sat=new Date(dateStamp('2026-09-12')-(i-1)*7*86400000).toISOString().slice(0,10),thu=new Date(dateStamp(sat)-2*86400000).toISOString().slice(0,10);const item=previous(thu);item.session.rpe=i<=3?4:8;history.push(item);readiness.push(ready({date:sat,fatigue:i<=3?1:4}));matches.push({date:sat,performance:i<=3?5:2});}
  const signals=calculateCoachSignals({date,history,readiness,matches});assert.equal(signals.patterns.length,2);assert.match(signals.patterns[0],/asociación observada/);assert.match(signals.patterns[0],/No demuestra causalidad/);
});
test('same inputs produce stable explanatory output without mutating source data',()=>{
  const input={date,readiness:[ready()],history:[previous()]},active=snapshot(),before=structuredClone(input);const a=applyCoachRules(calculateCoachSignals(input),active),b=applyCoachRules(calculateCoachSignals(input),active);assert.deepEqual(a,b);assert.deepEqual(input,before);assert.ok(a.exerciseAdjustments.every(item=>item.explanation.length));
});
test('only previous same-day routine type is eligible and legs stay conservative near match',()=>{
  assert.equal(coach({history:[previous('2026-09-10')]}).exerciseAdjustments[0].action,'maintain_load');
  const day='2026-09-17',active=snapshot(day);active.exercises[0].catalog.stable_key='curl-femoral';const result=coach({date:day,readiness:[ready({date:day})],history:[previous('2026-09-10')]},active);assert.equal(result.exerciseAdjustments[0].action,'avoid_leg_progression');
});
test('recent heavy free leg work restricts later leg progression from recorded load only',()=>{
  const active=snapshot();active.exercises[0].catalog.stable_key='sentadilla-prensa';const result=coach({history:[previous(),freeWorkout()]},active);
  assert.equal(result.exerciseAdjustments[0].action,'avoid_leg_progression');assert.match(result.reasons.join(' '),/sesión libre de piernas/);
  const signals=calculateCoachSignals({date,readiness:[ready()],history:[freeWorkout()]});assert.equal(signals.freeWorkoutLoads[0].family,'legs');assert.equal(signals.freeWorkoutLoads[0].completedSets,3);
});
test('recent free torso work does not automatically restrict leg progression',()=>{
  const active=snapshot();active.exercises[0].catalog.stable_key='sentadilla-prensa';const result=coach({history:[previous(),freeWorkout('2026-09-14','press-banca')]},active);
  assert.notEqual(result.exerciseAdjustments[0].action,'avoid_leg_progression');
});
test('invalid dates and deleted/future data do not contribute to signals',()=>{
  assert.ok(Number.isNaN(dateStamp('2026-99-99')));assert.throws(()=>calculateCoachSignals({date:'bad'}));const history=[previous()];history[0].session.deleted_at='x';const signals=calculateCoachSignals({date,history,readiness:[ready({deletedAt:'x'})],football:[{date:'2026-09-20',duration:90,rpe:10}]});assert.equal(signals.readinessScore,null);assert.equal(signals.gymTrend.recent,0);assert.equal(signals.intenseFootball,false);
});
test('coach feature flag is independent and disabled by default',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};assert.equal(isV3CoachEnabled(storage),false);setV3CoachEnabled(true,storage);assert.equal(isV3CoachEnabled(storage),true);assert.deepEqual([...values.keys()],['v3.coach.enabled']);
});
test('offline service reads only the repository owner and never writes',async()=>{
  let owner;const engine={repository:{userId:'user-a'},history:async()=>[previous()]};const service=new V3CoachService({engine,featureEnabled:true,now:()=>new Date(`${date}T12:00:00`),readContext:id=>{owner=id;return {readiness:[ready()],football:[],matches:[]};}});assert.equal((await service.today(snapshot())).recommendation.recommendationLevel,'progress');assert.equal(owner,'user-a');assert.throws(()=>new V3CoachService({engine,featureEnabled:false}));
});
test('presentation safely preserves original signals and has no storage or network access',async()=>{
  const source=await readFile(new URL('../js/v3/coach-presentation.js',import.meta.url),'utf8');assert.ok(source.includes('textContent'));assert.ok(source.includes('¿Por qué?'));assert.ok(source.includes('Datos originales'));assert.doesNotMatch(source,/innerHTML|indexedDB|supabase|fetch\(/);
});
