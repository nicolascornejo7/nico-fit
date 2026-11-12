// Plyometric and sprint tracking built on the existing set model: a jump set
// logs reps, and each rep maps to ground contacts through a read-only client
// profile (like EXERCISE_PROFILES). Sprints log reps of a fixed distance.
// No schema change and no extra synced fields are required.

const DAY=86400000;
const plyo=(kind,direction,intensity,{contactsPerRep=1,distanceM=null}={})=>Object.freeze({kind,direction,intensity,contactsPerRep,distanceM});

export const PLYO_PROFILES=Object.freeze({
  'saltos-verticales':plyo('jump','vertical','moderate'),
  'salto-cajon':plyo('jump','vertical','low'),
  'pogo-saltos':plyo('jump','reactive','low'),
  'salto-longitud':plyo('jump','horizontal','moderate'),
  'saltos-laterales':plyo('jump','lateral','moderate'),
  'bounds':plyo('jump','horizontal','high'),
  'saltos-vallas':plyo('jump','reactive','high'),
  'drop-jump':plyo('jump','reactive','high'),
  'sprint-10m':plyo('sprint','linear','high',{contactsPerRep:0,distanceM:10}),
  'sprint-20m':plyo('sprint','linear','high',{contactsPerRep:0,distanceM:20}),
  'sprint-30m':plyo('sprint','linear','high',{contactsPerRep:0,distanceM:30}),
  'cambios-direccion':plyo('cod','lateral','moderate',{contactsPerRep:0,distanceM:20})
});

// New stable catalog keys (saltos-verticales already exists through routines).
export const PLYO_CATALOG=Object.freeze([
  ['salto-cajon','Salto al cajón','Pliometría'],
  ['pogo-saltos','Pogos (saltos de tobillo)','Pliometría'],
  ['salto-longitud','Salto horizontal','Pliometría'],
  ['saltos-laterales','Saltos laterales (skater)','Pliometría'],
  ['bounds','Bounds (zancadas de impulso)','Pliometría'],
  ['saltos-vallas','Saltos sobre vallas','Pliometría'],
  ['drop-jump','Drop jump','Pliometría'],
  ['sprint-10m','Sprint 10 m','Velocidad'],
  ['sprint-20m','Sprint 20 m','Velocidad'],
  ['sprint-30m','Sprint 30 m','Velocidad'],
  ['cambios-direccion','Cambios de dirección 5-10-5','Velocidad']
]);

// In-season guidance for an amateur footballer who also plays twice a week.
// Product heuristics, kept together for review.
export const PLYO_LIMITS=Object.freeze({weeklyContacts:200,weeklyHighContacts:60,highFreeDaysBeforeMatch:2,activationContactsDayBefore:12});

export const INTENSITY_LABEL=Object.freeze({low:'baja',moderate:'media',high:'alta'});
export const DIRECTION_LABEL=Object.freeze({vertical:'vertical',horizontal:'horizontal',lateral:'lateral',reactive:'reactiva',linear:'lineal'});

export function plyoProfile(catalogOrKey){
  const key=typeof catalogOrKey==='string'?catalogOrKey:catalogOrKey?.stable_key;
  return key?PLYO_PROFILES[key]??null:null;
}

export function plyoHint(catalogOrKey){
  const profile=plyoProfile(catalogOrKey);if(!profile)return null;
  if(profile.kind==='jump')return `Pliometría ${DIRECTION_LABEL[profile.direction]} · intensidad ${INTENSITY_LABEL[profile.intensity]} · cada rep = ${profile.contactsPerRep} contacto${profile.contactsPerRep===1?'':'s'}`;
  return `${profile.kind==='sprint'?'Sprint':'Cambio de dirección'} · cada rep = ${profile.distanceM} m · intensidad ${INTENSITY_LABEL[profile.intensity]}`;
}

const stamp=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')?Date.parse(`${date}T12:00:00Z`):NaN;

// Every completed plyometric/sprint set, with derived contacts and meters.
export function plyoEntries(history=[]){
  const rows=[],seen=new Set();
  for(const item of history){
    const session=item?.session;
    if(!session||session.deleted_at||session.status!=='completed')continue;
    for(const exercise of item.exercises||[]){
      if(exercise.deleted_at)continue;
      const profile=plyoProfile(exercise.catalog);if(!profile)continue;
      for(const set of exercise.sets||[]){
        if(!set||set.deleted_at||!set.is_completed||seen.has(set.id))continue;
        const reps=Number.isFinite(set.reps)&&set.reps>0?set.reps:0;if(!reps)continue;
        seen.add(set.id);
        rows.push({date:session.session_date,name:exercise.exercise_name_snapshot,kind:profile.kind,intensity:profile.intensity,direction:profile.direction,contacts:reps*profile.contactsPerRep,meters:profile.distanceM?reps*profile.distanceM:0});
      }
    }
  }
  return rows;
}

// Rolling 7-day plyometric summary ending on `date` (inclusive).
export function weeklyPlyoSummary(history,{date}){
  const today=stamp(date),entries=plyoEntries(history).filter(row=>{const age=(today-stamp(row.date))/DAY;return Number.isFinite(age)&&age>=0&&age<7;});
  const byIntensity={low:0,moderate:0,high:0};let contacts=0,sprintMeters=0,codMeters=0,highLast48h=0;
  for(const row of entries){
    contacts+=row.contacts;byIntensity[row.intensity]+=row.contacts;
    if(row.kind==='sprint')sprintMeters+=row.meters;if(row.kind==='cod')codMeters+=row.meters;
    if(row.intensity==='high'&&(today-stamp(row.date))/DAY<=1)highLast48h+=row.contacts||row.meters;
  }
  return {contacts,byIntensity,sprintMeters,codMeters,highLast48h,sets:entries.length,
    overWeekly:contacts>PLYO_LIMITS.weeklyContacts,overHigh:byIntensity.high>PLYO_LIMITS.weeklyHighContacts,limits:PLYO_LIMITS};
}
