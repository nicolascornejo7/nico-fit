import test from 'node:test';
import assert from 'node:assert/strict';
import {progressionSuggestion} from '../js/progression.js';
import {completedGymSessionCount,sessionVolume,strengthPoints} from '../js/metrics.js';
import {sameExercise} from '../js/exercise-identity.js';
import {validateFootball,validateReadiness,validateSessionSummary,validateWorkout} from '../js/validation.js';
import {appendTextElement} from '../js/safe-dom.js';

const exercise={id:'press-banca',name:'Press banca',sets:3,max:10,step:2.5};
const previous=sets=>({date:'2026-09-08',sets});
const complete=()=>Array.from({length:3},()=>({kg:80,reps:10,rir:2,done:true}));

test('martes permite progresar solo al completar el objetivo con margen',()=>{
  const result=progressionSuggestion({exercise,previous:previous(complete()),readinessScore:80,dayIndex:2,now:new Date('2026-09-15T12:00:00')});
  assert.equal(result.kg,82.5);assert.match(result.text,/Martes de fuerza/);
});

test('jueves usa un umbral conservador y una recomendación diferenciada',()=>{
  const sets=complete().map(set=>({...set,rir:1.5}));
  const result=progressionSuggestion({exercise,previous:previous(sets),readinessScore:85,dayIndex:4,now:new Date('2026-09-17T12:00:00')});
  assert.equal(result.kg,80);assert.match(result.text,/Jueves: priorizá calidad y prevención/);
});

test('viernes prioriza el prepartido aunque los datos habiliten progresión',()=>{
  const result=progressionSuggestion({exercise,previous:previous(complete()),readinessScore:100,dayIndex:5,now:new Date('2026-09-18T12:00:00')});
  assert.equal(result.kg,80);assert.match(result.text,/Prepartido: no progreses/);
});

test('series objetivo incompletas nunca sugieren subir peso',()=>{
  const result=progressionSuggestion({exercise,previous:previous(complete().slice(0,2)),readinessScore:100,dayIndex:2,now:new Date('2026-09-15T12:00:00')});
  assert.equal(result.kg,80);assert.match(result.text,/Faltaron series objetivo/);
});

test('volumen y fuerza consideran únicamente series done',()=>{
  const sets=[{kg:100,reps:5,done:true},{kg:200,reps:5,done:false}];
  assert.equal(sessionVolume([{sets}]),500);
  assert.deepEqual(strengthPoints([{date:'2026-09-15',exercise:'Press banca',sets}],'press-banca'),[{label:'09-15',value:100}]);
});

test('sesiones gym cuenta únicamente sesiones finalizadas reales',()=>{
  assert.equal(completedGymSessionCount([{endedAt:'2026-09-15T11:00:00Z',duration:45},{endedAt:null,duration:20},{endedAt:'2026-09-16T11:00:00Z',duration:0}]),1);
});

test('no acepta ejercicios vacíos y valida rangos antes de persistir',()=>{
  assert.equal(validateWorkout(exercise,[{kg:'',reps:'',rir:'',done:false}]).valid,false);
  assert.equal(validateWorkout(exercise,[{kg:'80',reps:'10',rir:'6',done:true}]).valid,false);
  assert.equal(validateReadiness({sleep:6,energy:3,fatigue:3,pain:0}).valid,false);
  assert.equal(validateFootball({duration:90,rpe:11,minutes:70}).valid,false);
  assert.equal(validateSessionSummary({duration:45,rpe:0}).valid,false);
});

test('identidad estable agrupa variantes conocidas sin mezclar ejercicios distintos',()=>{
  assert.equal(sameExercise('Dominadas o jalón','Dominadas / jalón'),true);
  assert.equal(sameExercise('Press banca','Press banca ligero'),false);
});

test('contenido dinámico se inserta como texto y no como HTML',()=>{
  const created=[],document={createElement:tag=>{const element={tag,textContent:'',className:'',ownerDocument:document};created.push(element);return element;}};
  const parent={ownerDocument:document,children:[],appendChild(node){this.children.push(node);}};
  const payload='<img src=x onerror=alert(1)>';appendTextElement(parent,'strong',payload);
  assert.equal(parent.children[0].textContent,payload);assert.equal(parent.children[0].innerHTML,undefined);
});
