// Automatic weekly recommendations (rules over the athlete's own data; no AI):
//  - strength: muscles below their weekly hard-set range get catalog exercises
//    that train them, preferring ones not done yet this week;
//  - cardio: when there is no match, the load missing vs the 4-week average is
//    turned into concrete minutes at a target RPE (sRPE = minutes × RPE).
import {exerciseProfile} from './exercise-recommendations.js';
import {plyoProfile} from './plyometrics.js';
import {weeklyMuscleVolume,weekStart} from './hypertrophy.js';

const LEGS=new Set(['quadriceps','hamstrings','glutes','calves','adductors']);
const SKIP_ROLES=new Set(['activation','power','speed']);
const ROLE_ORDER={main_strength:0,accessory:1,prevention:2};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
// A match week already carries ~90 min of football at RPE 7 on Saturday.
export const MATCH_LOAD_ESTIMATE=630;

function exercisesFor(muscle,catalog,doneThisWeek){
  return catalog.filter(row=>!row.deleted_at).map(row=>({row,profile:exerciseProfile(row)}))
    .filter(({row,profile})=>profile&&profile.primary_muscles.includes(muscle)&&!SKIP_ROLES.has(profile.role)&&!plyoProfile(row))
    .sort((a,b)=>Number(doneThisWeek.has(a.row.id))-Number(doneThisWeek.has(b.row.id))||(ROLE_ORDER[a.profile.role]??3)-(ROLE_ORDER[b.profile.role]??3)||a.row.canonical_name.localeCompare(b.row.canonical_name))
    .slice(0,2).map(({row})=>row.canonical_name);
}

export function cardioPlan({mode,weekly}){
  if(mode==='match')return null;
  const missing=weekly?.sufficient?Math.max(0,Math.round(weekly.chronic-weekly.acute)):null;
  const target=missing??(mode==='no_match'?MATCH_LOAD_ESTIMATE:400);
  const easyMinutes=clamp(Math.round(target/5/5)*5,20,60);
  const options=[`Cardio suave: ${easyMinutes} min a RPE 5 (podés hablar cortado)`,'Intervalos: 4×4 min a RPE 8 con 3 min suaves entre medio (≈35 min)'];
  if(mode==='no_match')options.push('Fútbol recreativo o pasadas: 6×30 m al 90% con vuelta caminando');
  const detail=missing==null?'Todavía no hay 3 semanas de registros: uso una carga de referencia.':missing===0?'Tu carga ya está en tu promedio: el cardio es para mantener la base, no para sumar.':`Te faltan ≈${missing} AU para igualar tu promedio de 4 semanas.`;
  return {target,missing,sessions:mode==='off_season'?2:1,detail,options};
}

export function weekRecommendations({mode='match',date,signals,catalog=[]}){
  const weekly=signals?.weekly??null,history=signals?.history??[],dayIndex=new Date(`${date}T12:00:00Z`).getUTCDay();
  const from=weekStart(date),doneThisWeek=new Set(history.filter(item=>item.session.session_date>=from&&item.session.session_date<=date).flatMap(item=>item.exercises.map(ex=>ex.exercise_catalog_id)));
  const volume=weeklyMuscleVolume(history,{date,mode});
  const legsLocked=mode==='match'&&(signals?.daysToMatch??7)<=2;
  const strength=volume.muscles.filter(row=>row.status==='low'&&!(legsLocked&&LEGS.has(row.muscle)))
    .sort((a,b)=>(b.min-b.sets)-(a.min-a.sets)).slice(0,3)
    .map(row=>({muscle:row.muscle,label:row.label,sets:row.sets,min:row.min,deficit:Math.ceil(row.min-row.sets),exercises:exercisesFor(row.muscle,catalog,doneThisWeek)}))
    .filter(row=>row.exercises.length);
  const notes=[];
  if(weekly?.level==='red')notes.push('Semáforo en rojo: hoy priorizá recuperar (movilidad o cardio muy suave 20–30 min) antes de sumar series.');
  if(mode==='no_match'&&dayIndex===6)notes.push('Sábado sin partido: es buen día para la sesión de piernas o el cardio pendiente.');
  if(legsLocked)notes.push('Partido cerca: las piernas quedan para la semana que viene.');
  if(mode==='off_season')notes.push('Fuera de temporada: piernas con rango normal (10–20 series) y pliometría en mantenimiento, sin intensidad alta todas las semanas.');
  return {mode,strength,cardio:cardioPlan({mode,weekly}),notes,volume};
}
