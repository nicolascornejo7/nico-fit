// Extra gym day (a day with no programmed routine): rules over the athlete's own
// week, no AI. Muscles below their weekly hard-set range get exercises until
// they reach the range, without training a muscle that took 3+ hard sets yesterday or
// today, without legs close to a match, and without passing any muscle's max.
import {exerciseProfile} from './exercise-recommendations.js';
import {plyoProfile} from './plyometrics.js';
import {MUSCLE_LABELS,hardSetsByMuscle,muscleTargets,weeklyMuscleVolume} from './hypertrophy.js';

const DAY=86400000;
const LEGS=new Set(['quadriceps','hamstrings','glutes','calves','adductors']);
const SKIP_ROLES=new Set(['activation','power','speed']);
const ROLE_ORDER={main_strength:0,accessory:1,prevention:2};
const ALIAS={front_deltoids:'deltoids',brachialis:'biceps',obliques:'core'};
export const EXTRA_DAY_LIMITS=Object.freeze({maxSets:20,maxExercises:7,minSets:2,maxSetsPerExercise:4,maxSetsPerMuscle:6,margin:2,recentBlock:3});
// Familiar first choices per muscle; anything else in the catalog is a fallback.
export const EXTRA_DAY_PREFERRED=Object.freeze({
  chest:['press-banca','press-inclinado-mancuernas','cruce-poleas','aperturas-mancuernas'],
  upper_back:['remo-polea','remo-barra','remo-mancuerna'],
  lats:['jalon-al-pecho','dominadas','remo-polea'],
  deltoids:['elevacion-lateral','press-militar','press-arnold'],
  rear_deltoids:['pajaros-mancuernas','face-pull'],
  biceps:['curl-biceps-barra','curl-martillo'],
  triceps:['press-frances','extension-triceps-polea'],
  quadriceps:['sentadilla-prensa','extension-cuadriceps','zancada-bulgara'],
  hamstrings:['peso-muerto-rumano','curl-femoral'],
  glutes:['hip-thrust','sentadilla-prensa'],
  calves:['elevacion-gemelos','gemelos-sentado'],
  adductors:['aductor-maquina'],
  core:['plancha-pallof','dead-bug','plancha-lateral']
});

const shift=(date,days)=>new Date(Date.parse(`${date}T12:00:00Z`)+days*DAY).toISOString().slice(0,10);
const tracked=(muscle,targets)=>{const name=ALIAS[muscle]??muscle;return targets[name]?name:null;};
const round=value=>Math.round(value*10)/10;

export function daysToMatchFor(mode,date){return mode==='match'?(6-new Date(`${date}T12:00:00Z`).getUTCDay()+7)%7:7;}

function prescriptionFor(row,profile,{nearMatch}){
  const legs=profile.primary_muscles.some(muscle=>LEGS.has(muscle));
  if(row.measurement_kind==='seconds')return {measurement_kind:'seconds',min:30,max:45,target_rir:null,rest:60,step:0};
  const [min,max,rir,rest]=profile.role==='main_strength'?[6,10,2,legs?150:120]:profile.role==='accessory'?[10,15,1,legs?75:60]:[12,15,2,60];
  return {measurement_kind:'reps',min,max,target_rir:nearMatch?Math.max(rir,2):rir,rest,step:profile.role==='main_strength'||legs?2.5:1};
}

export function extraDayPlan({history=[],date,mode='match',daysToMatch=daysToMatchFor(mode,date),catalog=[]}){
  if(mode==='match'&&daysToMatch===0)return {available:false,reason:'Día de partido: hoy no sumes gimnasio.',exercises:[]};
  const targets=muscleTargets(mode),volume=weeklyMuscleVolume(history,{date,mode});
  const totals=Object.fromEntries(volume.muscles.map(row=>[row.muscle,row.sets])),before={...totals};
  const recent=hardSetsByMuscle(history,{from:shift(date,-1),to:date}).totals;
  const blocked=new Map();
  for(const [muscle,sets] of Object.entries(recent))if(sets>=EXTRA_DAY_LIMITS.recentBlock)blocked.set(muscle,'trained');
  const nearMatch=mode==='match'&&daysToMatch<=3,legsLocked=mode==='match'&&daysToMatch<=2;
  if(legsLocked)for(const muscle of LEGS)blocked.set(muscle,'match');
  const rows=catalog.filter(row=>!row.deleted_at&&row.measurement_kind!=='mixed').map(row=>({row,profile:exerciseProfile(row)}))
    .filter(({row,profile})=>profile&&!SKIP_ROLES.has(profile.role)&&!plyoProfile(row));
  const goal=muscle=>Math.min(targets[muscle][1],targets[muscle][0]+EXTRA_DAY_LIMITS.margin);
  const chosen=[],used=new Set(),session={};let totalSets=0;
  const candidatesFor=muscle=>{
    const preferred=EXTRA_DAY_PREFERRED[muscle]??[];
    return rows.filter(({row,profile})=>!used.has(row.id)&&profile.primary_muscles.includes(muscle))
      .sort((a,b)=>{const ia=preferred.indexOf(a.row.stable_key),ib=preferred.indexOf(b.row.stable_key);return (ia<0?99:ia)-(ib<0?99:ib)||(ROLE_ORDER[a.profile.role]??3)-(ROLE_ORDER[b.profile.role]??3)||a.row.canonical_name.localeCompare(b.row.canonical_name,'es');});
  };
  const fits=(profile,sets)=>profile.primary_muscles.every(muscle=>{const name=tracked(muscle,targets);return !name||!blocked.has(name)&&totals[name]+sets<=targets[name][1];});
  const skipped=new Set();
  while(totalSets<EXTRA_DAY_LIMITS.maxSets&&chosen.length<EXTRA_DAY_LIMITS.maxExercises){
    const open=Object.keys(targets).filter(muscle=>!blocked.has(muscle)&&!skipped.has(muscle)&&totals[muscle]<targets[muscle][0])
      .sort((a,b)=>(targets[b][0]-totals[b])/targets[b][0]-(targets[a][0]-totals[a])/targets[a][0]||a.localeCompare(b));
    const muscle=open[0];if(!muscle)break;
    const sets=Math.min(EXTRA_DAY_LIMITS.maxSetsPerExercise,Math.max(EXTRA_DAY_LIMITS.minSets,Math.ceil(goal(muscle)-totals[muscle])),EXTRA_DAY_LIMITS.maxSets-totalSets,EXTRA_DAY_LIMITS.maxSetsPerMuscle-(session[muscle]??0));
    const pick=sets>=EXTRA_DAY_LIMITS.minSets?candidatesFor(muscle).find(({profile})=>fits(profile,sets)):null;
    if(!pick){skipped.add(muscle);continue;}
    used.add(pick.row.id);totalSets+=sets;
    const primary=new Set(pick.profile.primary_muscles.map(value=>tracked(value,targets)).filter(Boolean));
    for(const name of primary){totals[name]+=sets;session[name]=(session[name]??0)+sets;}
    for(const name of new Set(pick.profile.secondary_muscles.map(value=>tracked(value,targets)).filter(Boolean)))if(!primary.has(name))totals[name]+=sets/2;
    chosen.push({row:pick.row,profile:pick.profile,muscle,sets});
  }
  chosen.sort((a,b)=>(ROLE_ORDER[a.profile.role]??3)-(ROLE_ORDER[b.profile.role]??3));
  const exercises=chosen.map(({row,profile,muscle,sets})=>({
    catalog_id:row.id,stable_key:row.stable_key,canonical_name:row.canonical_name,muscle,muscleLabel:MUSCLE_LABELS[muscle],
    prescription:{...prescriptionFor(row,profile,{nearMatch}),sets,notes:`Día extra · ${MUSCLE_LABELS[muscle]}`,extra_day:{muscle}}
  }));
  const focus=[...new Set(chosen.map(item=>item.muscle))];
  const changes=Object.keys(targets).filter(muscle=>round(totals[muscle])!==round(before[muscle])).map(muscle=>({muscle,label:MUSCLE_LABELS[muscle],before:round(before[muscle]),after:round(totals[muscle]),min:targets[muscle][0],max:targets[muscle][1]}));
  const notes=[];
  const restedToday=[...blocked].filter(([,why])=>why==='trained').map(([muscle])=>MUSCLE_LABELS[muscle]);
  if(restedToday.length)notes.push(`Descansan (entrenados ayer u hoy): ${restedToday.join(', ')}.`);
  if(legsLocked)notes.push('Partido en 2 días o menos: sin piernas.');
  else if(nearMatch)notes.push('Partido cerca: todo con RIR 2 como mínimo.');
  const pending=volume.muscles.filter(row=>totals[row.muscle]<row.min&&!focus.includes(row.muscle)).map(row=>row.label);
  if(exercises.length&&pending.length)notes.push(`Quedan para otro día: ${pending.join(', ')}.`);
  return {
    available:true,date,mode,exercises,totalSets,changes,notes,
    label:exercises.length?`Día extra · ${focus.slice(0,3).map(muscle=>MUSCLE_LABELS[muscle]).join(', ')}`:null,
    message:exercises.length?null:pending.length?'Lo que falta esta semana necesita descansar hoy; elegí cardio suave o descanso.':'Tu semana ya está dentro del rango de hipertrofia: hoy alcanza con cardio suave o descanso.'
  };
}
