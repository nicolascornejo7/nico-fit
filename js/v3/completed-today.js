import {defaultRoutineId,offSeasonRoutineId} from './routine-service.js';
import {gymDaysFor} from './offseason-program.js';

const time=value=>{const parsed=Date.parse(value??'');return Number.isFinite(parsed)?parsed:0;};

export async function completedRoutineSessions(repository,{date,dayIndex,mode='match'}){
  if(!repository?.userId||!gymDaysFor(mode).includes(dayIndex))return [];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(`${date}T12:00:00`).getDay()!==dayIndex)return [];
  const routineId=mode==='off_season'?await offSeasonRoutineId(repository.userId,dayIndex):await defaultRoutineId(repository.userId,dayIndex);
  const sessions=await repository.listSessions({date,status:'completed'});
  return sessions.filter(session=>
    session.session_type==='routine'&&session.status==='completed'&&!session.deleted_at&&
    session.routine_id===routineId&&!!session.routine_version_id&&
    session.routine_snapshot?.routine_id===routineId&&
    session.routine_snapshot?.routine_version_id===session.routine_version_id&&
    session.routine_snapshot?.routine_version===session.routine_version
  ).sort((a,b)=>time(b.ended_at)-time(a.ended_at)||time(b.started_at)-time(a.started_at)||a.id.localeCompare(b.id));
}

export function completedExerciseHint(exercise,snapshot){
  const expected=snapshot.session.routine_snapshot?.exercises?.find(item=>item.position===exercise.position);
  if(!expected?.exercise_catalog_id||!exercise.exercise_catalog_id||expected.exercise_catalog_id===exercise.exercise_catalog_id)return null;
  const actualIds=new Set(snapshot.exercises.filter(item=>!item.deleted_at).map(item=>item.exercise_catalog_id));
  if(!actualIds.has(expected.exercise_catalog_id))return `Sustituyó a ${expected.exercise_name_snapshot}`;
  const prescribedIds=new Set(snapshot.session.routine_snapshot.exercises.map(item=>item.exercise_catalog_id));
  return prescribedIds.has(exercise.exercise_catalog_id)?null:'Ejercicio incorporado en esta sesión';
}
