import {localDateKey} from '../plan.js';
import {exerciseProfile} from './exercise-recommendations.js';
import {calculateCoachSignals} from './coach-signals.js';

// Product heuristics, deliberately expressed as set counts rather than a
// purported physiological score. Keep thresholds together for review.
export const TUESDAY_LOAD_THRESHOLDS=Object.freeze({moderate:3,high:6,easyRir:4,hardRir:1,hardSets:3,calfSets:5,jumpSets:4,lowReadiness:60,restReadiness:40});
const CLASSES=['none','low','moderate','high'];
const PRIMARY=new Set(['knee_dominant','hip_hinge','knee_extension','knee_flexion']);
const LEG_MUSCLES=new Set(['quadriceps','hamstrings','glutes']);
const PLAN=Object.freeze({
  normal:{'sentadilla-prensa':[3,3],'peso-muerto-rumano':[2,3],'press-banca':[3,2],'dominadas-jalon':[3,2],'zancada-bulgara':[2,3],'elevacion-gemelos':[3,3],'plancha-pallof':[3,null]},
  reduced:{'sentadilla-prensa':[2,4],'peso-muerto-rumano':[1,4],'press-banca':[3,3],'dominadas-jalon':[3,3],'zancada-bulgara':[0,null],'elevacion-gemelos':[1,4],'plancha-pallof':[2,null]},
  leg_recovery:{'sentadilla-prensa':[0,null],'peso-muerto-rumano':[0,null],'press-banca':[3,3],'dominadas-jalon':[3,3],'zancada-bulgara':[0,null],'elevacion-gemelos':[0,null],'plancha-pallof':[2,null]},
  general_short:{'sentadilla-prensa':[0,null],'peso-muerto-rumano':[0,null],'press-banca':[2,4],'dominadas-jalon':[2,4],'zancada-bulgara':[0,null],'elevacion-gemelos':[0,null],'plancha-pallof':[1,null]}
});
const dayBefore=date=>{const [year,month,day]=date.split('-').map(Number);return localDateKey(new Date(year,month-1,day-1,12));};
const classFor=count=>count>=TUESDAY_LOAD_THRESHOLDS.high?'high':count>=TUESDAY_LOAD_THRESHOLDS.moderate?'moderate':count?'low':'none';
const shift=(value,delta)=>CLASSES[Math.max(0,Math.min(CLASSES.length-1,CLASSES.indexOf(value)+delta))];

export function mondayLegLoad({history=[],now=new Date(),date=localDateKey(now)}={}){
  const monday=dayBefore(date),mondayStart=new Date(`${monday}T00:00:00`).getTime(),decisionAt=now.getTime(),seen=new Set(),primary=[],calves=[],jumps=[],unknown=[];
  const sessions=[];
  for(const item of history){
    const session=item?.session;
    if(!session||session.deleted_at||!['completed','draft'].includes(session.status))continue;
    const started=Date.parse(session.started_at),startedDate=Number.isFinite(started)?localDateKey(new Date(started)):null;
    if(session.session_date!==monday&&startedDate!==monday)continue;
    if(!Number.isFinite(started)||started>decisionAt)continue;
    let included=false;
    for(const exercise of item.exercises||[]){
      if(exercise.deleted_at)continue;
      const profile=exerciseProfile(exercise.catalog);
      for(const set of exercise.sets||[]){
        if(!set?.id||seen.has(set.id)||set.deleted_at||!set.is_completed)continue;
        const completed=Date.parse(set.completed_at);
        // Older completed sessions can lack per-set timestamps; a finished
        // session is still usable if its end precedes the decision.
        const effectiveAt=Number.isFinite(completed)?completed:session.status==='completed'?Date.parse(session.ended_at):NaN;
        if(!Number.isFinite(effectiveAt)||effectiveAt>decisionAt||effectiveAt<started||effectiveAt<mondayStart)continue;
        seen.add(set.id);included=true;
        const row={setId:set.id,sessionId:session.id,exerciseId:exercise.id,name:exercise.exercise_name_snapshot,pattern:profile?.movement_pattern??null,rir:set.rir??null,kg:set.load_kg??null};
        if(!profile){unknown.push(row);continue;}
        if(PRIMARY.has(profile.movement_pattern)&&profile.primary_muscles.some(muscle=>LEG_MUSCLES.has(muscle)))primary.push(row);
        else if(profile.movement_pattern==='calf_raise')calves.push(row);
        else if(profile.movement_pattern==='vertical_jump')jumps.push(row);
      }
    }
    if(included)sessions.push({id:session.id,status:session.status,date:session.session_date,rpe:session.rpe??null});
  }
  let load=classFor(primary.length);
  if(primary.length&&primary.every(row=>row.rir!=null&&row.rir>=TUESDAY_LOAD_THRESHOLDS.easyRir))load=shift(load,-1);
  if(primary.filter(row=>row.rir!=null&&row.rir<=TUESDAY_LOAD_THRESHOLDS.hardRir).length>=TUESDAY_LOAD_THRESHOLDS.hardSets)load=shift(load,1);
  if(calves.length>=TUESDAY_LOAD_THRESHOLDS.calfSets||jumps.length>=TUESDAY_LOAD_THRESHOLDS.jumpSets)load=CLASSES[Math.max(CLASSES.indexOf(load),CLASSES.indexOf('moderate'))];
  const byExercise=[...primary,...calves,...jumps].reduce((map,row)=>(map[row.name]=(map[row.name]||0)+1,map),{});
  return {class:load,monday,primarySets:primary.length,calfSets:calves.length,jumpSets:jumps.length,unknownSets:unknown.length,byExercise,sessions,sets:[...primary,...calves,...jumps],unknown};
}

export function tuesdayDecision({history=[],readiness=[],now=new Date(),override=false,signalsConflicted=false}={}){
  const date=localDateKey(now);
  if(now.getDay()!==2)throw new Error('La adaptación sólo corresponde al martes local.');
  const legLoad=mondayLegLoad({history,now,date});
  const signals=calculateCoachSignals({date,readiness,history});
  const score=signalsConflicted?null:signals.readinessScore;
  const severe=score!=null&&score<TUESDAY_LOAD_THRESHOLDS.restReadiness||signals.pain>=7||signals.sleep===1&&signals.energy===1;
  const low=score!=null&&score<TUESDAY_LOAD_THRESHOLDS.lowReadiness||signals.freshness!=null&&signals.freshness<=2||signals.pain>=4;
  const legVariant=legLoad.class==='high'?'leg_recovery':legLoad.class==='moderate'?'reduced':'normal';
  let recommendedVariant=legVariant;
  if(severe||legVariant==='leg_recovery'&&low)recommendedVariant='general_short';
  else if(low&&legVariant==='normal')recommendedVariant='reduced';
  const selectedVariant=override?'normal':recommendedVariant;
  const affected=Object.entries(PLAN[selectedVariant]).map(([stableKey,[sets,targetRir]])=>({stableKey,sets,targetRir}));
  const count=affected.reduce((total,row)=>total+row.sets,0);
  const evidence=Object.entries(legLoad.byExercise).map(([name,sets])=>`${sets} serie${sets===1?'':'s'} de ${name}`).join(' y ');
  const reasons=[];
  if(evidence)reasons.push(`Ayer completaste ${evidence}.`);
  else reasons.push('No hay series de piernas clasificables registradas para el lunes en este dispositivo.');
  if(low)reasons.push('El check-in de hoy indica disponibilidad general baja.');
  if(severe)reasons.push('El check-in aconseja descanso; si entrenás, la sesión será breve.');
  if(legLoad.unknownSets)reasons.push(`${legLoad.unknownSets} ${legLoad.unknownSets===1?'serie de ejercicio sin perfil no se clasificó':'series de ejercicios sin perfil no se clasificaron'}.`);
  if(score==null)reasons.push('Falta un check-in completo o hay un conflicto; no se infiere buena recuperación.');
  reasons.push('Mañana hay fútbol.');
  if(override)reasons.push('Elegiste usar la rutina completa.');
  // The preview and the actual session creation must use the same evidence.
  // Exclude the selected override and clock time so either button can verify it.
  const evidenceKey=JSON.stringify({date,sets:legLoad.sets.map(row=>[row.setId,row.exerciseId,row.name,row.pattern,row.rir,row.kg]).sort((a,b)=>a[0].localeCompare(b[0])),unknown:legLoad.unknown.map(row=>[row.setId,row.exerciseId,row.name]).sort((a,b)=>a[0].localeCompare(b[0])),readiness:[signals.rawReadiness?.id??null,signals.rawReadiness?.sleep??null,signals.rawReadiness?.energy??null,score,signals.pain,signals.freshness,signalsConflicted],recommendedVariant});
  return {schemaVersion:1,date,decidedAt:now.toISOString(),evidenceKey,legLoadVariant:legVariant,readinessAdjustment:severe?'rest_recommended':low?'low':'none',recommendedVariant,selectedVariant,override:!!override,restRecommended:severe,readiness:{id:signals.rawReadiness?.id??null,score,pain:signals.pain,freshness:signals.freshness},legLoad,reasons,affected,totalSets:count};
}

export function effectiveTuesdayExercises(base,decision,catalogRows){
  if(base?.routine_version!==2||base.day_index!==2)throw new Error('Se requiere la rutina publicada del martes v2.');
  const selection=new Map(decision.affected.map(row=>[row.stableKey,row]));
  if(selection.size!==base.exercises.length)throw new Error('Plan del martes incompleto.');
  const metadata={schema_version:1,leg_load_variant:decision.legLoadVariant,readiness_adjustment:decision.readinessAdjustment,recommended_variant:decision.recommendedVariant,selected_variant:decision.selectedVariant,override:decision.override,rest_recommended:decision.restRecommended,decided_at:decision.decidedAt,reasons:decision.reasons,evidence:decision.legLoad,base_routine_version_id:base.routine_version_id,omitted:decision.affected.filter(row=>row.sets===0).map(row=>row.stableKey)};
  const keys=new Map(catalogRows.map(row=>[row.id,row.stable_key]));
  return base.exercises.flatMap(ex=>{
    const choice=selection.get(keys.get(ex.exercise_catalog_id));
    if(!choice)throw new Error('Ejercicio del martes sin decisión.');
    if(!choice.sets)return [];
    return [{...ex,prescription_snapshot:{...structuredClone(ex.prescription_snapshot),sets:choice.sets,target_rir:choice.targetRir,coach_adaptation:structuredClone(metadata)}}];
  });
}
