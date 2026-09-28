import test from 'node:test';
import assert from 'node:assert/strict';
import {V2HistoryReader} from '../js/v2-history-reader.js';
import {UnifiedProgress} from '../js/v3/unified-progress.js';

const emptyV2=()=>({workouts:[],sessions:[],readiness:[],football:[],matches:[]});
const v2Reader=data=>new V2HistoryReader({getData:async()=>data});
const session=(id='same-id')=>({id,session_date:'2026-09-20',label:'Entrenamiento actual',status:'completed',started_at:'2026-09-20T10:00:00Z',ended_at:'2026-09-20T11:00:00Z',rpe:7});
function repository({sessions=[],exercises={},sets={},readiness=[],football=[],matches=[],mappings=[],fail=false}={}){
  return {userId:'user-a',listSessions:async()=>{if(fail)throw new Error('v3 failed');return sessions;},listRecords:async entity=>({daily_readiness:readiness,football_sessions:football,match_reviews:matches}[entity]??[]),listMigrationMappings:async()=>mappings,listChildren:async(entity,parent)=>entity==='session_exercises'?(exercises[parent]??[]):(sets[parent]??[])};
}

test('only V2 keeps historical semantics and performs zero writes',async()=>{
  let reads=0;const source={...emptyV2(),sessions:[{id:'same-id',date:'2026-09-10',label:'Histórica',endedAt:'x',duration:60,rpe:6}],workouts:[{date:'2026-09-10',exercise:'Press banca',sets:[{kg:80,reps:5,done:true},{kg:100,reps:1,done:false}]}],readiness:[{date:'2026-09-10',sleep:4,energy:4,fatigue:2,pain:1}]};
  const reader=new V2HistoryReader({getData:async()=>{reads++;return source;}}),model=await new UnifiedProgress({v2Reader:reader,userId:'user-a'}).load();
  assert.equal(reads,1);assert.equal(model.status.v2,'ok');assert.equal(model.status.v3,'error');assert.equal(model.sessions[0].source,'v2');assert.equal(model.metrics.volume,400);assert.equal(model.exercises[0].maxLoad,80);assert.deepEqual(source.workouts[0].sets[0],{kg:80,reps:5,done:true});
  assert.deepEqual(Object.getOwnPropertyNames(V2HistoryReader.prototype).sort(),['constructor','read']);
});

test('only V3 uses completed sets for volume and maximum load',async()=>{
  const current=session(),exercise={id:'exercise-a',session_id:current.id,exercise_catalog_id:'catalog-a',exercise_name_snapshot:'Sentadilla'},repo=repository({sessions:[current],exercises:{[current.id]:[exercise]},sets:{[exercise.id]:[{id:'set-a',is_completed:true,load_kg:100,reps:5},{id:'set-b',is_completed:false,load_kg:200,reps:5}]}}),model=await new UnifiedProgress({v2Reader:{read:async()=>{throw new Error('v2 failed');}},repository:repo}).load();
  assert.equal(model.status.v2,'error');assert.equal(model.status.v3,'ok');assert.equal(model.metrics.volume,500);assert.equal(model.exercises[0].maxLoad,100);assert.equal(model.sessions.length,1);
});

test('V2 and V3 sessions on the same day and equal raw IDs remain separate namespaces',async()=>{
  const historical={...emptyV2(),sessions:[{id:'same-id',date:'2026-09-20',label:'Histórica',endedAt:'x',duration:50}]},current=session('same-id'),model=await new UnifiedProgress({v2Reader:v2Reader(historical),repository:repository({sessions:[current]})}).load();
  assert.equal(model.sessions.length,2);assert.deepEqual(new Set(model.sessions.map(row=>row.source)),new Set(['v2','v3']));assert.notEqual(model.sessions[0].id,model.sessions[1].id);
});

test('an explicit migrated relation is the only condition that removes a duplicate V2 session',async()=>{
  const historical={...emptyV2(),sessions:[{date:'2026-09-20',label:'Entrenamiento actual',endedAt:'x',duration:60}]},current=session('target-session'),sourceKey='v2:user-a:session:2026-09-20:Entrenamiento actual',model=await new UnifiedProgress({v2Reader:v2Reader(historical),repository:repository({sessions:[current],mappings:[{source_key:sourceKey,target_id:current.id,migration_status:'migrated'}]})}).load();
  assert.equal(model.sessions.length,1);assert.equal(model.sessions[0].source,'v3');
});

test('V2 failure still exposes V3 and V3 failure still exposes V2',async()=>{
  const current=session('current'),v3Only=await new UnifiedProgress({v2Reader:{read:async()=>{throw new Error('offline');}},repository:repository({sessions:[current]})}).load();assert.equal(v3Only.sessions.length,1);assert.match(v3Only.warnings[0],/histórico/);
  const historical={...emptyV2(),sessions:[{date:'2026-09-01',label:'Pasada',endedAt:'x',duration:30}]},v2Only=await new UnifiedProgress({v2Reader:v2Reader(historical),repository:repository({fail:true})}).load();assert.equal(v2Only.sessions.length,1);assert.match(v2Only.warnings[0],/datos actuales/);
});

test('exercise identities never merge by similar names across V2 and V3',async()=>{
  const historical={...emptyV2(),workouts:[{date:'2026-09-01',exercise:'Press banca',sets:[{kg:60,reps:8,done:true}]}]},current=session(),exercise={id:'ex',session_id:current.id,exercise_catalog_id:'catalog-press',exercise_name_snapshot:'Press Banca'},model=await new UnifiedProgress({v2Reader:v2Reader(historical),repository:repository({sessions:[current],exercises:{[current.id]:[exercise]},sets:{ex:[{id:'s',is_completed:true,load_kg:65,reps:8}]}})}).load();
  assert.equal(new Set(model.exercises.map(row=>row.identity)).size,2);assert.deepEqual(new Set(model.exercises.map(row=>row.source)),new Set(['v2','v3']));
});
