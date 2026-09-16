import {routineForDay} from './routines.js';
import {routinePrescription,sameRoutineValue} from './routine-validation.js';
// Controlled trace only: never rewrite a historic session or infer routine identity by name/date.
export async function importV2RoutineTrace({service,sessions=[]}){
  const defaults=await service.seedDefaults(),results=[];
  for(const item of sessions){
    const session=item.session;if(!session?.id)throw new Error('La trazabilidad requiere ID de sesión.');
    const sourceKey=`v3:legacy-routine-session:${session.id}`,exercises=item.exercises??[];
    if(session.owner_id!==service.repository.userId)throw new Error('Sesión de otro usuario.');
    const tagged=exercises[0]?.prescription_snapshot,day=tagged?.day_index,source=routineForDay(day);
    let exact=[2,4,5].includes(day)&&exercises.length===source.exercises.length;
    if(exact)try{exact=exercises.every((ex,index)=>ex.prescription_snapshot?.source==='validated-v2-plan'&&ex.prescription_snapshot.routine_id===source.id&&sameRoutineValue(routinePrescription(ex.prescription_snapshot),routinePrescription(source.exercises[index].prescription))&&ex.exercise_name_snapshot===source.exercises[index].canonical_name);}catch{exact=false;}
    const known=exact?defaults.find(row=>row.version.day_index===day):null;
    results.push(await service.repository.recordMigrationDecision({sourceKey,entity:'routine_versions',targetId:known?.version.id??null,status:session.routine_id?'skipped':known?'migrated':'pending_review',note:session.routine_id?'Session already has explicit V3 routine identity.':known?'Exact validated plan snapshot; trace only, historic session unchanged.':'Ambiguous or modified historical prescription; no identity inferred.',sourcePayload:{session_id:session.id,existing_routine_id:session.routine_id??null,exercises:structuredClone(exercises.map(ex=>({id:ex.id,exercise_name_snapshot:ex.exercise_name_snapshot,prescription_snapshot:ex.prescription_snapshot})))}}));
  }
  return results;
}
