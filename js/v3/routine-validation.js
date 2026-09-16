import {requiredText,optionalNumber,validatePrescription} from './training-validation.js';
export const isUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const sameRoutineValue=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export function routinePrescription(input={}){
  const rx=validatePrescription(input);
  if(input.sets==null)throw new Error('Series objetivo requeridas.');
  rx.step=optionalNumber(input.step,'Incremento sugerido',{max:100,decimals:3});
  rx.target_rir=optionalNumber(input.target_rir,'RIR objetivo',{max:5});
  rx.rest=optionalNumber(input.rest,'Descanso',{max:3600,integer:true});
  rx.notes=input.notes??'';
  if(typeof rx.notes!=='string'||rx.notes.length>10000)throw new Error('Notas de prescripción inválidas.');
  if(rx.measurement_kind==='mixed'||rx.min==null||rx.max==null)throw new Error('La rutina requiere rango explícito de reps o segundos.');
  if(rx.measurement_kind==='reps'&&rx.max>500)throw new Error('Rango de reps inválido.');
  return rx;
}
export function validateRoutineRecord(entity,row){
  if(entity==='routine_templates'){
    requiredText(row.name,'Rutina');requiredText(row.stable_key,'Identidad de rutina');
    if(typeof row.is_active!=='boolean')throw new Error('Estado de rutina inválido.');
    if(row.derived_from_routine_id!=null&&!isUuid(row.derived_from_routine_id))throw new Error('Origen de variante inválido.');
  }
  if(entity==='routine_versions'){
    if(!isUuid(row.routine_id)||!Number.isInteger(row.version_number)||row.version_number<1||row.version_number>2147483647)throw new Error('Versión de rutina inválida.');
    requiredText(row.name_snapshot,'Nombre histórico');
    if(row.day_index!=null&&(!Number.isInteger(row.day_index)||row.day_index<0||row.day_index>6))throw new Error('Día de rutina inválido.');
    const snapshot=row.prescription_snapshot;
    if(!snapshot||snapshot.routine_id!==row.routine_id||snapshot.routine_version!==row.version_number||snapshot.routine_version_id!==row.id||snapshot.name!==row.name_snapshot||snapshot.day_index!==row.day_index||!Array.isArray(snapshot.exercises)||!snapshot.exercises.length)throw new Error('Snapshot de rutina incompleto.');
    const ids=new Set();for(const [position,ex] of snapshot.exercises.entries()){
      if(!isUuid(ex.id)||ids.has(ex.id)||!isUuid(ex.exercise_catalog_id)||ex.position!==position)throw new Error('Orden o identidad de ejercicio inválidos.');ids.add(ex.id);
      requiredText(ex.exercise_name_snapshot,'Nombre de ejercicio');routinePrescription(ex.prescription_snapshot);
    }
  }
  if(entity==='routine_exercises'){
    if(!isUuid(row.routine_version_id)||!isUuid(row.exercise_catalog_id)||!Number.isInteger(row.position)||row.position<0)throw new Error('Ejercicio de rutina inválido.');
    requiredText(row.exercise_name_snapshot,'Nombre histórico de ejercicio');routinePrescription(row.prescription_snapshot);
  }
}
export function assertRoutineImmutable(entity,current,next){
  const fields=entity==='routine_versions'?['routine_id','version_number','name_snapshot','day_index','prescription_snapshot']:entity==='routine_exercises'?['routine_version_id','exercise_catalog_id','position','exercise_name_snapshot','prescription_snapshot']:entity==='routine_templates'?['stable_key','derived_from_routine_id']:entity==='workout_sessions'&&current?.routine_id?['routine_id','routine_version','routine_version_id','routine_snapshot']:[];
  for(const field of fields)if(!sameRoutineValue(current[field],next[field]))throw new Error('La prescripción publicada o identidad histórica es inmutable; creá una nueva versión.');
}
