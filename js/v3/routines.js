import {plan} from '../plan.js';
import {stableClientUuid} from './import-v2.js';

const SECONDS_IDS=new Set(['plancha-pallof','copenhagen-plank','movilidad-prepartido']);

export function routineForDay(dayIndex){
  if(![2,4,5].includes(dayIndex))return {id:'custom',label:'Sesión personalizada',dayIndex,exercises:[]};
  const day=plan[dayIndex];
  return {id:`v2-validated-day-${dayIndex}`,label:day.label,dayIndex,exercises:day.exercises.map(exercise=>({
    stable_key:exercise.id,canonical_name:exercise.name,measurement_kind:SECONDS_IDS.has(exercise.id)?'seconds':'reps',
    prescription:{...structuredClone(exercise),measurement_kind:SECONDS_IDS.has(exercise.id)?'seconds':'reps',
      min:exercise.id==='movilidad-prepartido'?300:exercise.min,max:exercise.id==='movilidad-prepartido'?480:exercise.max,
      routine_id:`v2-validated-day-${dayIndex}`,day_index:dayIndex,source:'validated-v2-plan'}
  }))};
}

export const routineCatalogId=(userId,stableKey)=>stableClientUuid(`v3:routine-catalog:${userId}:${stableKey}`);
