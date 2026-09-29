const node=(tag,text)=>{const element=document.createElement(tag);if(text!=null)element.textContent=String(text);return element;};
const ACTIONS={maintain_load:'Mantener carga',progress_load:'Progresar carga',reduce_load:'Reducir carga',reduce_sets:'Reducir series',avoid_leg_progression:'Evitar progresión de piernas',activation:'Activación',rest:'Descanso/recuperación'};
export function renderCoachCard({recommendation,signals},snapshot){
  const card=node('section');card.className='card v3-coach-card';card.setAttribute('aria-label','Coach de hoy');
  card.append(node('p','COACH DE HOY'),node('h3',recommendation.title),node('p',recommendation.summary));
  const why=node('details');why.append(node('summary','¿Por qué?'));
  const reasons=node('ul');for(const reason of recommendation.reasons)reasons.append(node('li',reason));why.append(reasons);
  why.append(node('p',`Datos originales del día: sueño ${signals.sleep??'—'}/5 · energía ${signals.energy??'—'}/5 · frescura ${signals.freshness??'—'}/5 · dolor ${signals.pain??'—'}/10 · fútbol 7d ${signals.footballTrend.recent} AU · gym 7d ${signals.gymTrend.recent.toFixed(0)} AU · partido en ${signals.daysToMatch} ${signals.daysToMatch===1?'día':'días'}.`));card.append(why);
  if(recommendation.exerciseAdjustments.length||recommendation.warnings.length){const adjustments=node('details');adjustments.append(node('summary','Ver ajustes sugeridos'));const list=node('ul');for(const item of recommendation.exerciseAdjustments){const exercise=snapshot?.exercises.find(ex=>ex.id===item.exerciseId);list.append(node('li',`${exercise?.exercise_name_snapshot??item.exerciseId}: ${ACTIONS[item.action]} · carga ${item.suggestedLoad??'sin referencia'} kg · ${item.suggestedSets} series · RIR objetivo ${item.targetRir}. ${item.explanation}`));}adjustments.append(list);for(const warning of recommendation.warnings)adjustments.append(node('p',warning));card.append(adjustments);}
  if(signals.rawReadiness)why.append(node('pre',JSON.stringify(signals.rawReadiness,null,2)));
  return card;
}
