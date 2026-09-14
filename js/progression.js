import {daysUntilSaturday} from './plan.js';
import {completedSets} from './metrics.js';

export function progressionSuggestion({exercise,previous,readinessScore=null,dayIndex,now=new Date()}){
  if(!previous)return {text:'Primera referencia: empezá conservador y dejá 2–3 RIR.',kg:''};
  const done=completedSets(previous.sets).filter(set=>Number(set.reps)>0&&(set.kg===''||Number(set.kg)>=0));
  if(!done.length)return {text:`Última vez: ${previous.date}. No hay series completadas para calcular progresión.`,kg:''};
  const kg=Math.max(...done.map(set=>Number(set.kg)||0));
  const detail=done.map(set=>`${set.kg||0}×${set.reps}`).join(' · ');
  if(dayIndex===5||daysUntilSaturday(now)<=1)return {text:`Última vez ${previous.date}: ${detail}. Prepartido: no progreses carga. Usá ${kg} kg o menos y buscá velocidad.`,kg};
  if(done.length<exercise.sets)return {text:`Última vez ${previous.date}: ${detail}. Faltaron series objetivo: mantené la carga hasta completarlas.`,kg};
  const minReps=Math.min(...done.map(set=>Number(set.reps))),avgRir=done.reduce((sum,set)=>sum+Number(set.rir),0)/done.length;
  if(readinessScore!=null&&readinessScore<60)return {text:`Última vez ${previous.date}: ${detail}. Readiness bajo: mantené ${kg} kg o bajá 5–10% y reducí una serie.`,kg};
  const threshold=dayIndex===4?78:70,requiredRir=dayIndex===4?2:1.5;
  if(exercise.step&&minReps>=exercise.max&&avgRir>=requiredRir&&(readinessScore==null||readinessScore>=threshold)){
    const next=kg+exercise.step,dayText=dayIndex===4?'Jueves controlado':'Martes de fuerza';
    return {text:`Última vez ${previous.date}: ${detail}. ${dayText}: progresión sugerida a ${next} kg porque completaste todas las series con margen.`,kg:next};
  }
  const dayText=dayIndex===4?'Jueves: priorizá calidad y prevención.':'Martes: consolidá fuerza y técnica.';
  return {text:`Última vez ${previous.date}: ${detail}. ${dayText} Repetí ${kg} kg y buscá completar el rango.`,kg};
}
