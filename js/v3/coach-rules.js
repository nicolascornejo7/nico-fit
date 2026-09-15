import {v3Progression} from './training-progression.js';

const LEGS=new Set(['sentadilla-prensa','peso-muerto-rumano','zancada-bulgara','elevacion-gemelos','curl-femoral','copenhagen-plank','nordic-curl','sentadilla-ligera','peso-muerto-rumano-ligero','saltos-verticales','movilidad-prepartido']);
const TITLES={normal:'Entrenar normal',maintain:'Mantener carga',progress:'Progresar carga de forma controlada',reduce:'Reducir volumen y mantener margen',activation:'Convertir la sesión en activación',recovery:'Priorizar descanso y recuperación'};

export function applyCoachRules(signals,snapshot){
  const reasons=[],warnings=[...signals.warnings],add=text=>reasons.push(`Regla general: ${text}`);
  const {readinessScore:score,pain,freshness,sleep,energy,daysToMatch,dayIndex}=signals;
  const low=score!=null&&score<60,highLoad=(signals.footballTrend.changePercent??0)>=15||(signals.gymTrend.changePercent??0)>=20;
  const preMatch=dayIndex===5||daysToMatch<=1,legsBlocked=daysToMatch<=2||signals.intenseFootball||highLoad;
  let level=score==null?'maintain':'normal';
  if(score!=null)add(`readiness ${score}/100 (sueño ${sleep}/5, energía ${energy}/5, frescura ${freshness}/5, dolor ${pain}/10).`);
  else add('datos incompletos: mantener carga y evitar buscar PRs.');
  if(highLoad){level='reduce';if(signals.footballTrend.changePercent>=15)add(`carga de fútbol +${signals.footballTrend.changePercent}% vs promedio registrado de las 4 semanas previas.`);if(signals.gymTrend.changePercent>=20)add(`carga gym +${signals.gymTrend.changePercent}% vs promedio registrado de las 4 semanas previas.`);}
  if(signals.intenseFootball){level='reduce';add('fútbol intenso registrado en los últimos 2 días (RPE ≥8 y carga ≥480 AU).');}
  if(low||freshness<=2&&freshness!=null){level='reduce';add('readiness bajo o frescura ≤2/5: reducir series antes de aumentar carga.');}
  if(daysToMatch<=2)add(`partido en ${daysToMatch} ${daysToMatch===1?'día':'días'}: evitar progresión de piernas.`);
  if(preMatch){level='activation';add('viernes/prepartido tiene prioridad: activación liviana, sin progresión.');}
  if(pain>=4){level='reduce';add(`dolor/molestia ${pain}/10: bloquear progresión y reducir carga/volumen.`);}
  if(preMatch&&pain>=4)level='recovery';
  if(pain>=7||score!=null&&score<40||sleep===1&&energy===1){level='recovery';add('dolor alto o disponibilidad muy baja: preferir descanso/recuperación.');}
  if(dayIndex===0){level='recovery';add('domingo: preservar el día de recuperación.');}
  if(pain>=4)warnings.push('Si la molestia persiste o aumenta, buscá orientación profesional. No es un diagnóstico.');
  const exercises=(snapshot?.exercises??[]).filter(ex=>!ex.deleted_at),adjustments=[];
  const sameType=signals.history.filter(item=>new Date(`${item.session.session_date}T12:00:00Z`).getUTCDay()===dayIndex&&!item.session.reconstructed&&item.session.id!==snapshot?.session.id&&(!snapshot||item.session.started_at<snapshot.session.started_at))
    .sort((a,b)=>String(b.session.started_at).localeCompare(String(a.session.started_at)));
  const previous=sameType[0];
  if(previous)add(`sesión anterior del mismo tipo: ${previous.session.session_date}, RPE ${previous.session.rpe??'desconocido'}.`);
  if(!previous)warnings.push('Sin sesión anterior del mismo tipo: no se sugiere progresión de carga.');
  for(const exercise of exercises){
    const rx=exercise.prescription_snapshot,stable=exercise.catalog?.stable_key,region=exercise.catalog?.metadata?.body_region;
    const legs=LEGS.has(stable)||region==='legs',unknown=!legs&&!['upper','core'].includes(region)&&(!stable||stable.startsWith('custom:'));
    if(unknown)warnings.push(`Sin región corporal declarada: ${exercise.exercise_name_snapshot}; ajuste conservador cuando se bloquean piernas.`);
    const ordinal=exercises.filter(ex=>ex.exercise_catalog_id===exercise.exercise_catalog_id).findIndex(ex=>ex.id===exercise.id);
    const prior=previous?.exercises.filter(ex=>!ex.deleted_at&&ex.exercise_catalog_id===exercise.exercise_catalog_id)[ordinal];
    const done=(prior?.sets??[]).filter(set=>!set.deleted_at&&set.is_completed),loads=done.map(set=>set.load_kg).filter(value=>value!=null),base=loads.length?Math.max(...loads):null;
    let action='maintain_load',suggestedLoad=base,suggestedSets=rx.sets,targetRir=2;
    const explanations=[];
    const conflict=snapshot?.conflicts?.length||previous?.conflicts?.length||[snapshot?.session,exercise,exercise.catalog,...(exercise.sets??[]),previous?.session,prior,prior?.catalog,...(prior?.sets??[])].some(row=>row?.sync_status==='conflict');
    if(level==='recovery'){action='rest';suggestedLoad=null;suggestedSets=0;targetRir=4;explanations.push('La recomendación principal prioriza recuperación.');}
    else if(level==='activation'){action='activation';suggestedLoad=base==null?null:Math.round(base*.8*100)/100;suggestedSets=Math.min(rx.sets,2);targetRir=4;explanations.push('Prepartido: sin aumentos, reducir intensidad y series.');}
    else if(level==='reduce'){action=pain>=4?'reduce_load':'reduce_sets';suggestedLoad=pain>=4&&base!=null?Math.round(base*.9*100)/100:base;suggestedSets=Math.max(1,rx.sets-(low&&rx.sets>=3?2:1));targetRir=3;explanations.push('Reducir volumen antes de buscar nuevos máximos.');}
    else if(legsBlocked&&(legs||unknown)){action='avoid_leg_progression';targetRir=3;explanations.push('Cercanía al partido o carga reciente: evitar progresión de piernas.');}
    else if(score!=null&&prior&&previous.session.rpe!=null&&previous.session.rpe<=8&&done.length>=rx.sets&&done.every(set=>set.rir!=null)&&!conflict){
      const result=v3Progression({exercise,history:[previous],session:snapshot.session,readinessScore:score,now:new Date(`${signals.date}T12:00:00`),occurrenceIndex:ordinal});
      if(base!=null&&Number(result.kg)>base){action='progress_load';suggestedLoad=Number(result.kg);}explanations.push(result.text);
    }else explanations.push(conflict?'Conflicto de sincronización pendiente: no se habilita progresión hasta revisar los datos.':'Sin objetivos completos, RIR/RPE conocidos y readiness suficiente no se habilita progresión.');
    if(conflict){action=level==='normal'?'maintain_load':action;if(action==='progress_load'){action='maintain_load';suggestedLoad=base;}warnings.push('Conflicto local: revisión pendiente; no se habilitan aumentos con esos datos.');}
    adjustments.push({exerciseId:exercise.id,action,suggestedLoad,suggestedSets,targetRir,explanation:explanations.join(' ')});
  }
  if(level==='normal')level=adjustments.some(item=>item.action==='progress_load')?'progress':previous?'maintain':'normal';
  reasons.push(...signals.patterns);
  return {readinessScore:score,recommendationLevel:level,title:TITLES[level],summary:level==='recovery'?'Priorizá recuperación; los ajustes son sugerencias y no modifican tus registros.':'Usá estos ajustes como guía conservadora; los datos originales permanecen disponibles.',reasons,exerciseAdjustments:adjustments,warnings:[...new Set(warnings)]};
}
