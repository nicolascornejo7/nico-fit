import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {extraDayPlan,daysToMatchFor} from '../js/v3/extra-day.js';
import {BASE_EXERCISES} from '../js/v3/base-exercise-catalog.js';
import {SOLO_MONDAY_PROGRAM} from '../js/v3/offseason-program.js';
import {WEEKLY_PROGRAM_V3} from '../js/v3/weekly-program-v64.js';
import {exerciseProfile} from '../js/v3/exercise-recommendations.js';
import {weeklyMuscleVolume,MUSCLE_TARGETS} from '../js/v3/hypertrophy.js';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEGS=['quadriceps','hamstrings','glutes','calves','adductors'];
const catalog=BASE_EXERCISES.map(row=>({...row,id:`cat-${row.stable_key}`}));
const byKey=key=>catalog.find(row=>row.stable_key===key)??{id:`cat-${key}`,stable_key:key,canonical_name:key,measurement_kind:'reps'};
// A completed session as the engine's history returns it, from a program day.
const done=(date,program)=>({session:{id:`s-${date}`,session_date:date,status:'completed'},exercises:program.exercises.map((item,index)=>{const row=byKey(item.stable_key);return {id:`e-${date}-${index}`,exercise_catalog_id:row.id,catalog:row,sets:Array.from({length:item.sets},(_,position)=>({id:`x-${date}-${index}-${position}`,position,is_completed:true,...(item.measurement_kind==='seconds'?{duration_seconds:item.min}:{reps:item.min}),rir:item.target_rir??2}))};})});
const week=[done('2026-11-16',SOLO_MONDAY_PROGRAM[1]),done('2026-11-17',WEEKLY_PROGRAM_V3[2])];
const muscles=plan=>new Set(plan.exercises.flatMap(item=>exerciseProfile(byKey(item.stable_key)).primary_muscles));
const fromPlan=(date,plan)=>({session:{id:`s-${date}`,session_date:date,status:'completed'},exercises:plan.exercises.map((item,index)=>({id:`e-${date}-${index}`,exercise_catalog_id:item.catalog_id,catalog:byKey(item.stable_key),sets:Array.from({length:item.prescription.sets},(_,position)=>({id:`x-${date}-${index}-${position}`,position,is_completed:true,...(item.prescription.measurement_kind==='seconds'?{duration_seconds:30}:{reps:item.prescription.min}),rir:item.prescription.target_rir??2}))}))});

test('Wednesday rests everything trained hard on Tuesday and fills the other gaps',()=>{
  assert.equal(daysToMatchFor('match','2026-11-18'),3);
  const plan=extraDayPlan({history:week,date:'2026-11-18',mode:'match',catalog});
  assert.equal(plan.available,true);
  const trained=muscles(plan);
  for(const muscle of ['rear_deltoids','triceps'])assert.ok(trained.has(muscle),`${muscle} is the gap`);
  for(const muscle of ['chest','lats','upper_back','quadriceps','hamstrings','glutes','calves'])assert.ok(!trained.has(muscle),`${muscle} trained yesterday`);
  assert.ok(plan.totalSets<=20&&plan.exercises.length<=7);
  assert.ok(plan.exercises.every(item=>item.prescription.target_rir==null||item.prescription.target_rir>=2),'match on Saturday: RIR 2 or more');
  assert.match(plan.label,/^Día extra · .*Deltoides posterior/);
  const perMuscle={};for(const item of plan.exercises)for(const muscle of exerciseProfile(byKey(item.stable_key)).primary_muscles)perMuscle[muscle]=(perMuscle[muscle]??0)+item.prescription.sets;
  assert.ok(Object.values(perMuscle).every(sets=>sets<=6),'at most 6 sets per muscle in one session');
  // Nothing goes over its weekly max, and the targeted muscles reach their minimum.
  const after=weeklyMuscleVolume([...week,fromPlan('2026-11-18',plan)],{date:'2026-11-18'});
  for(const row of after.muscles)assert.ok(row.sets<=row.max,`${row.muscle} ${row.sets}>${row.max}`);
  assert.ok(after.muscles.find(row=>row.muscle==='triceps').sets>=MUSCLE_TARGETS.triceps[0]);
  // Face pull also loads the rested upper back, so the rest of the rear-delt work waits for Saturday.
  assert.equal(after.muscles.find(row=>row.muscle==='rear_deltoids').sets,4);
  assert.ok(plan.notes.some(note=>/Pecho/.test(note)&&/Descansan/.test(note)));
});

test('a Saturday without match after the extra Wednesday completes the week',()=>{
  const wednesday=extraDayPlan({history:week,date:'2026-11-18',mode:'no_match',catalog});
  const history=[...week,fromPlan('2026-11-18',wednesday)];
  const saturday=extraDayPlan({history,date:'2026-11-21',mode:'no_match',catalog});
  const trained=muscles(saturday);
  for(const muscle of ['chest','lats','quadriceps','hamstrings'])assert.ok(trained.has(muscle),muscle);
  const after=weeklyMuscleVolume([...history,fromPlan('2026-11-21',saturday)],{date:'2026-11-21'});
  for(const row of after.muscles)assert.ok(row.sets<=row.max,`${row.muscle} ${row.sets}>${row.max}`);
  for(const row of after.muscles)assert.ok(row.sets>=row.min,`${row.muscle} ${row.sets}<${row.min}`);
});

test('no extra day on match day, no legs two days out, and nothing when the week is complete',()=>{
  const matchDay=extraDayPlan({history:week,date:'2026-11-21',mode:'match',catalog});
  assert.equal(matchDay.available,false);assert.match(matchDay.reason,/partido/i);
  const thursday=extraDayPlan({history:week,date:'2026-11-19',mode:'match',catalog});
  assert.ok(!LEGS.some(muscle=>muscles(thursday).has(muscle)));assert.ok(thursday.notes.some(note=>/sin piernas/.test(note)));
  const wednesday=extraDayPlan({history:week,date:'2026-11-18',mode:'no_match',catalog}),history=[...week,fromPlan('2026-11-18',wednesday)];
  const saturday=extraDayPlan({history,date:'2026-11-21',mode:'no_match',catalog});
  const full=extraDayPlan({history:[...history,fromPlan('2026-11-21',saturday)],date:'2026-11-22',mode:'no_match',catalog});
  assert.equal(full.exercises.length,0);assert.ok(full.message);
});

test('the engine starts the extra day as a free workout with the suggested prescriptions',async()=>{
  const reset=installRolloutControl({snapshot:()=>({updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_routines_enabled:true}}),refreshIfDue:async()=>{}});
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  try{
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now:()=>new Date(2026,10,18,18)});
    const rows=await engine.catalog(),plan=extraDayPlan({history:[],date:'2026-11-18',mode:'no_match',catalog:rows});
    assert.ok(plan.exercises.length>=4);
    const snapshot=await engine.createExtraDay({plan,date:'2026-11-18'});
    assert.equal(snapshot.session.session_type,'free_workout');assert.equal(snapshot.session.label,plan.label);
    assert.deepEqual(snapshot.exercises.map(ex=>ex.exercise_catalog_id),plan.exercises.map(ex=>ex.catalog_id));
    assert.equal(snapshot.exercises[0].prescription_snapshot.sets,plan.exercises[0].prescription.sets);
    assert.deepEqual(snapshot.exercises[0].prescription_snapshot.extra_day,{muscle:plan.exercises[0].muscle});
    await assert.rejects(engine.createExtraDay({plan:{exercises:[]}}),/No hay un día extra/);
    await assert.rejects(engine.createSession({useRoutine:true,plannedExercises:plan.exercises}),/sesión libre/);
  }finally{reset();repository.close();}
});

test('the training start screen offers the extra day on a day without routine and starts it',async()=>{
  const {V3TrainingUI}=await import('../js/v3/training-ui.js');
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.value='';this.hidden=false;this.listeners={};this.textContent='';this.className='';}
    append(...children){this.children.push(...children);}
    insertBefore(child,reference){const index=this.children.indexOf(reference);index<0?this.children.push(child):this.children.splice(index,0,child);}
    replaceChildren(...children){this.children=children;}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,listener){this.listeners[name]=listener;}
    get options(){return this.children.filter(child=>child.tag==='option');}
    click(){return this.listeners.click?.();}
  }
  const find=(root,predicate)=>predicate(root)?root:root.children.map(child=>find(child,predicate)).find(Boolean);
  const text=root=>[root.textContent,...root.children.map(text)].join(' ');
  const reset=installRolloutControl({snapshot:()=>({updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_routines_enabled:true}}),refreshIfDue:async()=>{}});
  const previous={document:globalThis.document,localStorage:globalThis.localStorage};
  const data=new Map();globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
  globalThis.document={createElement:tag=>new Element(tag)};
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  try{
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now:()=>new Date(2026,10,18,18)});
    const ui=new V3TrainingUI({root:new Element('section'),engine,onClose:()=>{}});ui.run=task=>task();ui.message=new Element('p');
    const shell=new Element('section');await ui.renderStart(shell);
    const card=find(shell,node=>node.className==='card v3-extra-day');
    assert.ok(card,'extra day card on a Wednesday');assert.match(text(card),/Día extra sugerido/);
    await find(card,node=>node.tag==='button'&&node.textContent==='Comenzar día extra').click();
    const snapshot=await engine.snapshot();
    assert.equal(snapshot.session.session_type,'free_workout');assert.match(snapshot.session.label,/^Día extra/);assert.ok(snapshot.exercises.length>=4);
  }finally{reset();repository.close();globalThis.document=previous.document;globalThis.localStorage=previous.localStorage;}
});
