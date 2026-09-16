import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reviewProductionMappings,sessionFingerprint,sourceFingerprint} from '../scripts/lib/v3-production-mapping-review.mjs';

const readJson=async path=>JSON.parse(await readFile(new URL(`../${path}`,import.meta.url),'utf8'));
const sourceRows=()=>[
  {id:60,user_id:'owner',date:'2026-09-15',day:'Martes',exercise:'Sentadilla o prensa',updated_at:'2026-09-16T00:17:37.045+00:00',sets:[{kg:10,reps:5,rir:2,done:true},{kg:11,reps:6,rir:2,done:true},{kg:12,reps:7,rir:2,done:true}]},
  {id:10,user_id:'owner',date:'2026-09-15',day:'Martes',exercise:'Press banca',updated_at:'2026-09-16T00:17:37.045+00:00',sets:[{kg:20,reps:8,rir:2,done:true},{kg:21,reps:9,rir:2,done:true},{kg:22,reps:10,rir:2,done:true}]},
  {id:1,user_id:'owner',date:'2026-09-15',day:'Martes',exercise:'Elevación de gemelos',updated_at:'2026-09-16T00:17:37.045+00:00',sets:[{kg:30,reps:10,rir:2,done:true},{kg:31,reps:11,rir:2,done:true},{kg:32,reps:12,rir:2,done:true}]},
  {id:35,user_id:'owner',date:'2026-09-15',day:'Martes',exercise:'Plancha / Pallof press',updated_at:'2026-09-16T00:17:37.045+00:00',sets:[{kg:0,reps:30,rir:0,done:true},{kg:0,reps:31,rir:0,done:true},{kg:0,reps:32,rir:0,done:true}]}
];

async function fixture(){
  const mapping=structuredClone(await readJson('config/v3-production-workout-mappings.v1.json')),workouts=sourceRows();
  for(const item of mapping.mappings)item.source_fingerprint_sha256=sourceFingerprint(workouts.find(row=>row.id===item.v2_workout_id));
  const backup={source_project_ref:mapping.source_project_ref,captured_at:mapping.source_export_captured_at,data:{workouts,workout_sessions:[{id:1,user_id:'owner',date:'2026-09-15',day:'Martes',label:'Fuerza principal',started_at:'2026-09-15T23:12:10.223+00:00',ended_at:'2026-09-16T00:17:21.136+00:00',duration_minutes:65,rpe:6,notes:'',updated_at:'2026-09-16T00:17:37.045+00:00'}]}};
  mapping.source_session.source_fingerprint_sha256=sessionFingerprint(backup.data.workout_sessions[0]);
  return {backup,mapping};
}

test('approved concrete mappings project four exercises and twelve verbatim sets',async()=>{
  const {backup,mapping}=await fixture(),report=reviewProductionMappings(backup,mapping);
  assert.deepEqual(report.projected,{session_exercises:{migrated:4,pending_review:0,skipped:0},exercise_sets:{migrated:12,pending_review:0,skipped:0}});
  for(const decision of report.decisions)assert.deepEqual(decision.series,backup.data.workouts.find(row=>row.id===decision.v2_workout_id).sets);
  assert.equal(report.semantics,'historical_prescribed_order_not_observed_execution');
});

test('missing mapping remains pending review with all of its sets',async()=>{
  const {backup,mapping}=await fixture();mapping.mappings=mapping.mappings.filter(row=>row.v2_workout_id!==35);
  assert.deepEqual(reviewProductionMappings(backup,mapping).projected,{session_exercises:{migrated:3,pending_review:1,skipped:0},exercise_sets:{migrated:9,pending_review:3,skipped:0}});
});

test('incorrect identity or prescribed position is rejected',async()=>{
  const {backup,mapping}=await fixture();mapping.mappings.find(row=>row.v2_workout_id===10).canonical_exercise_key='press-militar';
  const report=reviewProductionMappings(backup,mapping);
  assert.equal(report.projected.session_exercises.pending_review,1);assert.match(report.decisions.find(row=>row.v2_workout_id===10).reason,/identidad canónica/);
  const second=await fixture();second.mapping.mappings.find(row=>row.v2_workout_id===10).prescribed_position=3;
  assert.equal(reviewProductionMappings(second.backup,second.mapping).projected.session_exercises.pending_review,1);
});

test('review is pure and idempotent',async()=>{
  const {backup,mapping}=await fixture(),before=structuredClone(backup),first=reviewProductionMappings(backup,mapping),second=reviewProductionMappings(backup,mapping);
  assert.deepEqual(second,first);assert.deepEqual(backup,before);
});

test('any later source change invalidates the approval without normalizing data',async()=>{
  const {backup,mapping}=await fixture();backup.data.workouts.find(row=>row.id===60).sets[0].kg=121;
  const report=reviewProductionMappings(backup,mapping),decision=report.decisions.find(row=>row.v2_workout_id===60);
  assert.equal(decision.status,'pending_review');assert.match(decision.reason,/cambió después/);assert.equal(report.projected.exercise_sets.pending_review,3);
});

test('a later change to the approved parent session invalidates all four decisions',async()=>{
  const {backup,mapping}=await fixture();backup.data.workout_sessions[0].label='Sesión modificada';
  const report=reviewProductionMappings(backup,mapping);
  assert.equal(report.projected.session_exercises.pending_review,4);assert.equal(report.projected.exercise_sets.pending_review,12);
  assert.ok(report.decisions.every(row=>/sesión V2 aprobada cambió/.test(row.reason)));
});

test('stable identities, combined identities and final prescribed order are explicit',async()=>{
  const mapping=await readJson('config/v3-production-workout-mappings.v1.json');
  assert.deepEqual(mapping.mappings.map(row=>[row.v2_workout_id,row.canonical_exercise_key,row.prescribed_position]),[[60,'sentadilla-prensa',0],[10,'press-banca',2],[1,'elevacion-gemelos',5],[35,'plancha-pallof',6]]);
  assert.equal(mapping.mappings.find(row=>row.v2_workout_id===60).combined_identity_preserved,true);
  assert.equal(mapping.mappings.find(row=>row.v2_workout_id===35).combined_identity_preserved,true);
  assert.equal(mapping.preserve_source_sets_verbatim,true);assert.equal(mapping.status,'human_approved');
});

test('read-only SQL preflight embeds the same approved records, identities and positions',async()=>{
  const mapping=await readJson('config/v3-production-workout-mappings.v1.json'),sql=await readFile(new URL('../supabase/preflight-v3-production-readonly.sql',import.meta.url),'utf8');
  assert.match(sql,/begin transaction read only/i);
  for(const item of mapping.mappings){
    assert.match(sql,new RegExp(`\\(${item.v2_workout_id},${item.v2_session_id},`));
    assert.match(sql,new RegExp(`'${item.canonical_exercise_key}','${item.measurement_kind}',${item.prescribed_position},${mapping.mapping_version}\\)`));
  }
});
