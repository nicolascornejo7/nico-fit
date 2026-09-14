import {exerciseId} from './exercise-identity.js';

export const completedSets=sets=>(sets||[]).filter(set=>set.done);
export function volumeOfSets(sets=[]){return completedSets(sets).reduce((sum,set)=>sum+(Number(set.kg)||0)*(Number(set.reps)||0),0);}
export function sessionVolume(exercises=[]){return exercises.reduce((sum,exercise)=>sum+volumeOfSets(exercise.sets),0);}
export function strengthPoints(workouts=[],identity){
  const id=exerciseId(identity);
  return workouts.filter(workout=>exerciseId(workout.exerciseId||workout.exercise)===id).sort((a,b)=>a.date.localeCompare(b.date)).map(workout=>({
    label:workout.date.slice(5),value:Math.max(0,...completedSets(workout.sets).map(set=>Number(set.kg)||0))
  })).filter(point=>point.value>0);
}
export function completedGymSessionCount(sessions=[]){return sessions.filter(session=>session.endedAt&&Number(session.duration)>0).length;}
