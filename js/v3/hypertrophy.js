// Hypertrophy tracking on top of the logged sets: weekly hard sets per muscle,
// personal records and a simple mesocycle with planned deloads. Conservative
// product heuristics for an in-season footballer, not a prescription.
import {exerciseProfile} from './exercise-recommendations.js';

const DAY=86400000;
const stamp=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')?Date.parse(`${date}T12:00:00Z`):NaN;
const iso=time=>new Date(time).toISOString().slice(0,10);
// Weeks run Monday → Sunday, so each one ends with the Saturday match.
export const weekStart=date=>{const time=stamp(date),day=new Date(time).getUTCDay();return iso(time-((day+6)%7)*DAY);};

export const MUSCLE_LABELS=Object.freeze({chest:'Pecho',upper_back:'Espalda alta',lats:'Dorsales',deltoids:'Hombros',front_deltoids:'Deltoides anterior',rear_deltoids:'Deltoides posterior',biceps:'Bíceps',triceps:'Tríceps',quadriceps:'Cuádriceps',hamstrings:'Isquios',glutes:'Glúteos',calves:'Gemelos',adductors:'Aductores',core:'Core'});

// Weekly hard-set ranges. Legs sit lower because football already loads them.
export const MUSCLE_TARGETS=Object.freeze({
  chest:[10,20],upper_back:[10,20],lats:[10,20],deltoids:[8,16],rear_deltoids:[6,14],biceps:[6,14],triceps:[6,14],
  quadriceps:[6,12],hamstrings:[6,12],glutes:[6,12],calves:[4,10],adductors:[2,6],core:[4,10]
});
// Off-season: football no longer loads the legs, so they get normal ranges.
export const OFF_SEASON_TARGETS=Object.freeze({...MUSCLE_TARGETS,quadriceps:[10,20],hamstrings:[10,20],glutes:[10,20],calves:[6,14],adductors:[4,10]});
export const muscleTargets=mode=>mode==='off_season'?OFF_SEASON_TARGETS:MUSCLE_TARGETS;
// Only these muscles are tracked; aliases fold into a tracked one.
const ALIAS=Object.freeze({front_deltoids:'deltoids',brachialis:'biceps',obliques:'core',erectors:null,forearms:null,hips:null,ankles:null});
const SKIP_ROLES=new Set(['activation','power','speed']);
export const HARD_SET_MAX_RIR=3;
export const MESOCYCLE=Object.freeze({loadingWeeks:5,deloadRatio:0.6,deloadSetsFactor:0.6,minWeeks:4});

const tracked=muscle=>{const name=Object.hasOwn(ALIAS,muscle)?ALIAS[muscle]:muscle;return name&&MUSCLE_TARGETS[name]?name:null;};
const completedHistory=history=>history.filter(item=>item?.session?.status==='completed'&&!item.session.deleted_at&&Number.isFinite(stamp(item.session.session_date)));
const liveSets=exercise=>(exercise.sets||[]).filter(set=>set&&!set.deleted_at&&set.is_completed);

export function isHardSet(set){
  const effort=(set.reps>0)||(set.duration_seconds>0);
  return effort&&(set.rir==null||set.rir<=HARD_SET_MAX_RIR);
}

// Hard sets per muscle: primary muscles count 1, secondary 0.5.
export function hardSetsByMuscle(history,{from,to}){
  const totals=Object.fromEntries(Object.keys(MUSCLE_TARGETS).map(key=>[key,0]));let sets=0;
  for(const item of completedHistory(history)){
    const date=item.session.session_date;if(date<from||date>to)continue;
    for(const exercise of item.exercises||[]){
      if(exercise.deleted_at)continue;
      const profile=exerciseProfile(exercise.catalog);if(!profile||SKIP_ROLES.has(profile.role))continue;
      const hard=liveSets(exercise).filter(isHardSet).length;if(!hard)continue;sets+=hard;
      const primary=new Set(profile.primary_muscles.map(tracked).filter(Boolean));
      for(const muscle of primary)totals[muscle]+=hard;
      for(const muscle of new Set(profile.secondary_muscles.map(tracked).filter(Boolean)))if(!primary.has(muscle))totals[muscle]+=hard*0.5;
    }
  }
  return {totals,sets};
}

export function weeklyMuscleVolume(history,{date,mode='match'}){
  const from=weekStart(date),to=iso(stamp(from)+6*DAY),{totals,sets}=hardSetsByMuscle(history,{from,to});
  const muscles=Object.entries(muscleTargets(mode)).map(([muscle,[min,max]])=>{const value=Math.round(totals[muscle]*10)/10;return {muscle,label:MUSCLE_LABELS[muscle],sets:value,min,max,status:value<min?'low':value>max?'high':'ok'};});
  return {from,to,hardSets:sets,muscles,untrained:muscles.filter(row=>row.sets===0).map(row=>row.label)};
}

const e1rm=set=>set.load_kg>0&&set.reps>0&&set.reps<=12?Math.round(set.load_kg*(1+set.reps/30)*10)/10:null;
const identity=exercise=>exercise.exercise_catalog_id??exercise.catalog?.id??exercise.exercise_name_snapshot;

// Chronological PR detection. The first session of an exercise is its
// baseline, never a record.
export function personalRecords(history){
  const best=new Map(),records=[];
  const ordered=completedHistory(history).sort((a,b)=>a.session.session_date.localeCompare(b.session.session_date)||String(a.session.started_at).localeCompare(String(b.session.started_at)));
  for(const item of ordered){
    for(const exercise of item.exercises||[]){
      if(exercise.deleted_at)continue;
      const key=identity(exercise),sets=liveSets(exercise).filter(set=>set.load_kg>0&&set.reps>0);if(!sets.length)continue;
      const previous=best.get(key),current={maxLoad:Math.max(...sets.map(set=>set.load_kg)),e1rm:Math.max(0,...sets.map(e1rm).filter(Boolean))||null,repsAt:new Map()};
      for(const set of sets)current.repsAt.set(set.load_kg,Math.max(current.repsAt.get(set.load_kg)??0,set.reps));
      if(previous){
        const base={date:item.session.session_date,name:exercise.exercise_name_snapshot,exerciseId:key};
        if(current.maxLoad>previous.maxLoad)records.push({...base,type:'load',value:current.maxLoad,previous:previous.maxLoad});
        if(current.e1rm&&previous.e1rm&&current.e1rm>previous.e1rm)records.push({...base,type:'e1rm',value:current.e1rm,previous:previous.e1rm});
        for(const [load,reps] of current.repsAt){const before=previous.repsAt.get(load);if(before!=null&&reps>before){records.push({...base,type:'reps',value:reps,load,previous:before});break;}}
      }
      const merged=previous??{maxLoad:0,e1rm:null,repsAt:new Map()};
      merged.maxLoad=Math.max(merged.maxLoad,current.maxLoad);merged.e1rm=Math.max(merged.e1rm??0,current.e1rm??0)||null;
      for(const [load,reps] of current.repsAt)merged.repsAt.set(load,Math.max(merged.repsAt.get(load)??0,reps));
      best.set(key,merged);
    }
  }
  return {best,records};
}

// Does this just-completed set beat everything before the active session?
export function liveSetRecord(set,bestForExercise){
  if(!bestForExercise||!(set?.load_kg>0)||!(set?.reps>0))return null;
  if(set.load_kg>bestForExercise.maxLoad)return {type:'load',label:`Récord de peso: ${set.load_kg} kg`};
  const estimate=e1rm(set);if(estimate&&bestForExercise.e1rm&&estimate>bestForExercise.e1rm)return {type:'e1rm',label:`Récord de 1RM estimado: ${estimate} kg`};
  const reps=bestForExercise.repsAt.get(set.load_kg);if(reps!=null&&set.reps>reps)return {type:'reps',label:`Récord de reps con ${set.load_kg} kg: ${set.reps}`};
  return null;
}

// Mesocycle: count consecutive loading weeks since the last light week. A week
// is light when its hard sets fall below 60% of the recent loading average.
export function mesocycleStatus(history,{date}){
  const current=weekStart(date),weeks=[];
  for(let index=1;index<=12;index++){const from=iso(stamp(current)-index*7*DAY),to=iso(stamp(from)+6*DAY);weeks.push({from,sets:hardSetsByMuscle(history,{from,to}).sets});}
  const firstActive=weeks.findLastIndex(week=>week.sets>0);
  const observed=firstActive<0?[]:weeks.slice(0,firstActive+1);
  let loadingWeeks=0;
  for(let index=0;index<observed.length;index++){
    const reference=observed.slice(index+1,index+4).filter(week=>week.sets>0),average=reference.length?reference.reduce((sum,week)=>sum+week.sets,0)/reference.length:null;
    const light=observed[index].sets===0||average!=null&&observed[index].sets<average*MESOCYCLE.deloadRatio;
    if(light)break;loadingWeeks++;
  }
  const enoughData=observed.length>=MESOCYCLE.minWeeks;
  const deloadDue=enoughData&&loadingWeeks>=MESOCYCLE.loadingWeeks;
  return {weekStart:current,loadingWeeks,deloadDue,enoughData,week:Math.min(loadingWeeks+1,MESOCYCLE.loadingWeeks+1),weeks:observed.map(week=>week.sets)};
}
