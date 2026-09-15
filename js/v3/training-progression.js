import {progressionSuggestion} from '../progression.js';
import {daysUntilSaturday} from '../plan.js';

export function v3Progression({exercise,history=[],session,readinessScore=null,now=new Date(),occurrenceIndex=0}){
  const prescription=exercise.prescription_snapshot;
  const dayIndex=new Date(`${session.session_date}T12:00:00`).getDay(),preMatch=dayIndex===5||daysUntilSaturday(now)<=1;
  if(prescription.measurement_kind!=='reps')return {text:preMatch?'Prepartido: mantené el tiempo y priorizá activación liviana.':'Ejercicio por tiempo: mantené la prescripción; no se infiere progresión de carga.',kg:''};
  const previous=history.filter(item=>item.session.id!==session.id&&item.session.status==='completed'&&!item.session.deleted_at&&item.session.started_at<session.started_at)
    .sort((a,b)=>b.session.started_at.localeCompare(a.session.started_at))
    .map(item=>({date:item.session.session_date,sets:(item.exercises.filter(ex=>!ex.deleted_at&&ex.exercise_catalog_id===exercise.exercise_catalog_id)[occurrenceIndex]?.sets||[]).filter(set=>!set.deleted_at).map(set=>({
      kg:set.load_kg??'',reps:set.reps??0,rir:set.rir??0,done:set.is_completed
    }))})).find(item=>item.sets.length);
  if(preMatch&&!previous)return {text:'Prepartido: empezá liviano; no progreses carga.',kg:''};
  return progressionSuggestion({exercise:prescription,previous,readinessScore,dayIndex,now});
}
