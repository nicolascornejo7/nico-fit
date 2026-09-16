import {createHash} from 'node:crypto';
import {routineForDay} from '../../js/v3/routines.js';

function canonical(value){
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const sha256=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export const sourceFingerprint=row=>sha256({
  id:row.id,user_id:row.user_id,date:row.date,day:row.day,exercise:row.exercise,
  sets:row.sets,updated_at:row.updated_at
});
export const sessionFingerprint=row=>sha256({
  id:row.id,user_id:row.user_id,date:row.date,day:row.day,label:row.label,
  started_at:row.started_at,ended_at:row.ended_at,duration_minutes:row.duration_minutes,
  rpe:row.rpe,notes:row.notes,updated_at:row.updated_at
});

function mappingError(mapping,row,session,planExercise,mappingSet){
  if(!row)return 'El registro V2 aprobado ya no existe.';
  if(sourceFingerprint(row)!==mapping.source_fingerprint_sha256)return 'El registro V2 cambió después de la aprobación humana.';
  if(!session||session.user_id!==row.user_id||session.date!==row.date||sessionFingerprint(session)!==mappingSet.source_session.source_fingerprint_sha256)return 'La sesión V2 aprobada cambió o no coincide con el registro.';
  if(mapping.source.date!==row.date||mapping.source.day!==row.day||mapping.source.exercise!==row.exercise||mapping.source.updated_at!==row.updated_at)return 'La identidad fuente declarada no coincide.';
  if(!planExercise||planExercise.stable_key!==mapping.canonical_exercise_key||planExercise.canonical_name!==row.exercise)return 'La identidad canónica no coincide exactamente con la rutina histórica.';
  if(planExercise.measurement_kind!==mapping.measurement_kind)return 'El tipo reps/segundos no coincide con la rutina histórica.';
  if(!Array.isArray(row.sets)||row.sets.length!==mapping.series_count)return 'La cantidad de series cambió.';
  if(row.sets.some(set=>set?.done!==true||!Number.isFinite(Number(set.kg))||!Number.isFinite(Number(set.reps))||Number(set.reps)<=0||!Number.isFinite(Number(set.rir))))return 'Una serie ya no es migrable sin inferencias.';
  return null;
}

export function reviewProductionMappings(backup,mappingSet){
  if(backup?.source_project_ref!==mappingSet.source_project_ref)throw new Error('El proyecto fuente no coincide con el mapping aprobado.');
  if(mappingSet.schema_version!==1||mappingSet.status!=='human_approved')throw new Error('Versión o estado de aprobación inválido.');
  const mappings=mappingSet.mappings||[],ids=new Set(mappings.map(item=>item.v2_workout_id)),positions=new Set(mappings.map(item=>item.prescribed_position));
  if(ids.size!==mappings.length||positions.size!==mappings.length)throw new Error('Los IDs fuente y posiciones aprobadas deben ser únicos.');
  const routine=routineForDay(2);
  if(mappingSet.routine.stable_key!==routine.id||mappingSet.routine.version!==1)throw new Error('La rutina histórica aprobada no coincide.');
  const workouts=new Map((backup.data?.workouts||[]).map(row=>[Number(row.id),row]));
  const sessions=new Map((backup.data?.workout_sessions||[]).map(row=>[Number(row.id),row]));
  const mappingById=new Map(mappings.map(item=>[item.v2_workout_id,item]));
  const decisions=[];let migrated=0,pending=0,skipped=0,migratedSets=0,pendingSets=0,skippedSets=0;
  for(const row of workouts.values()){
    const mapping=mappingById.get(Number(row.id));
    if(!mapping){pending++;pendingSets+=Array.isArray(row.sets)?row.sets.length:0;decisions.push({v2_workout_id:Number(row.id),status:'pending_review',reason:'No existe una decisión humana vinculada a este registro V2.'});continue;}
    const session=sessions.get(mapping.v2_session_id),planExercise=routine.exercises[mapping.prescribed_position];
    const error=mappingError(mapping,row,session,planExercise,mappingSet);
    if(error){pending++;pendingSets+=Array.isArray(row?.sets)?row.sets.length:mapping.series_count;decisions.push({v2_workout_id:mapping.v2_workout_id,status:'pending_review',reason:error});continue;}
    migrated++;migratedSets+=row.sets.length;
    decisions.push({v2_workout_id:mapping.v2_workout_id,status:'migrated',canonical_exercise_key:mapping.canonical_exercise_key,prescribed_position:mapping.prescribed_position,measurement_kind:mapping.measurement_kind,series:structuredClone(row.sets)});
  }
  for(const mapping of mappings)if(!workouts.has(mapping.v2_workout_id)){pending++;pendingSets+=mapping.series_count;decisions.push({v2_workout_id:mapping.v2_workout_id,status:'pending_review',reason:'El registro V2 aprobado ya no existe.'});}
  return {
    mapping_set_id:mappingSet.mapping_set_id,mapping_version:mappingSet.mapping_version,source_capture:backup.captured_at,
    semantics:mappingSet.position_semantics,
    projected:{session_exercises:{migrated,pending_review:pending,skipped},exercise_sets:{migrated:migratedSets,pending_review:pendingSets,skipped:skippedSets}},
    decisions
  };
}

export function decodeLogicalBackupCsv(raw){
  const lines=String(raw).trim().split(/\r?\n/).filter(Boolean);
  const encoded=(lines[0]?.toLowerCase().includes('payload_base64')?lines.slice(1):lines).join('').replace(/^"|"$/g,'').replace(/""/g,'"');
  return JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
}
