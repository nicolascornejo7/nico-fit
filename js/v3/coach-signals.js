import {sessionMetrics} from './training-metrics.js';
import {exerciseFamily} from './exercise-family.js';

const DAY=86400000;
export const dateStamp=date=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return NaN;const stamp=Date.parse(`${date}T12:00:00Z`);return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===date?stamp:NaN;};
const valid=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const live=row=>!row.deleted_at&&!row.deletedAt;
const average=values=>values.reduce((a,b)=>a+b,0)/values.length;

function freeWorkoutLoads(history,date){
  const today=dateStamp(date),rows=[];
  for(const item of history){
    if(item?.session?.session_type!=='free_workout')continue;
    const age=(today-dateStamp(item.session.session_date))/DAY;
    if(!Number.isFinite(age)||age<0||age>7)continue;
    for(const exercise of item.exercises.filter(row=>!row.deleted_at)){
      const sets=exercise.sets.filter(set=>!set.deleted_at&&set.is_completed);if(!sets.length)continue;
      rows.push({date:item.session.session_date,daysAgo:age,family:exerciseFamily(exercise.catalog),completedSets:sets.length,volume:sets.reduce((sum,set)=>sum+(set.load_kg??0)*(set.reps??0),0),rpe:item.session.rpe??null});
    }
  }
  return rows;
}

export function loadTrend(rows,date){
  const today=dateStamp(date),windows=Array.from({length:5},()=>({load:0,count:0}));
  for(const row of rows){const age=(today-dateStamp(row.date))/DAY;if(age<0||age>=35||!Number.isFinite(age)||!valid(row.load,0,1000000))continue;const bucket=windows[Math.floor(age/7)];bucket.load+=row.load;bucket.count++;}
  const sufficient=windows.slice(1).every(window=>window.count>0),baseline=sufficient?average(windows.slice(1).map(window=>window.load)):null;
  return {recent:windows[0].load,baseline,changePercent:baseline>0?Math.round((windows[0].load/baseline-1)*100):null,sufficient,windows};
}

export function personalPatterns({gymRows,readiness, matches,date}){
  const today=dateStamp(date),pairs=[];
  const uniqueDays=new Map();
  for(const row of readiness.filter(row=>live(row)&&Number.isFinite(dateStamp(row.date))).sort((a,b)=>String(a.updatedAt??a.updated_at??'').localeCompare(String(b.updatedAt??b.updated_at??''))))uniqueDays.set(row.date,row);
  for(const row of [...uniqueDays.values()].sort((a,b)=>a.date.localeCompare(b.date))){
    const stamp=dateStamp(row.date),age=(today-stamp)/DAY,freshness=row.freshness??(valid(row.fatigue,1,5)?6-row.fatigue:null);
    if(!live(row)||!Number.isFinite(age)||age<=0||age>84||new Date(stamp).getUTCDay()!==6||!valid(freshness,1,5))continue;
    const relevant=gymRows.filter(gym=>{const days=(stamp-dateStamp(gym.date))/DAY;return days>=1&&days<=2;});
    if(!relevant.length)continue;
    const match=matches.find(item=>live(item)&&item.date===row.date&&valid(item.performance,1,5));
    pairs.push({load:relevant.reduce((sum,item)=>sum+item.load,0),freshness,performance:match?.performance??null});
  }
  if(pairs.length<6)return [];
  pairs.sort((a,b)=>a.load-b.load);const half=Math.floor(pairs.length/2),low=pairs.slice(0,half),high=pairs.slice(half);
  if(low.at(-1).load>=high[0].load)return [];
  const result=[`Patrón personal: asociación observada en ${pairs.length} sábados; frescura media ${average(low.map(row=>row.freshness)).toFixed(1)}/5 con menor carga gym jueves/viernes y ${average(high.map(row=>row.freshness)).toFixed(1)}/5 con mayor carga. No demuestra causalidad.`];
  const lowMatch=low.filter(row=>row.performance!=null),highMatch=high.filter(row=>row.performance!=null);
  if(lowMatch.length>=3&&highMatch.length>=3)result.push(`Patrón personal: rendimiento informado ${average(lowMatch.map(row=>row.performance)).toFixed(1)}/5 vs ${average(highMatch.map(row=>row.performance)).toFixed(1)}/5 en esos grupos; asociación observada.`);
  return result;
}

export function calculateCoachSignals({date,readiness=[],football=[],matches=[],history=[]}){
  const today=dateStamp(date);if(!Number.isFinite(today))throw new Error('Fecha de coach inválida.');
  const dayIndex=new Date(today).getUTCDay(),daysToMatch=(6-dayIndex+7)%7,warnings=[];
  const candidates=readiness.filter(row=>live(row)&&row.date===date).sort((a,b)=>String(b.updatedAt??b.updated_at??'').localeCompare(String(a.updatedAt??a.updated_at??'')));
  const source=candidates[0],freshness=source?.freshness??(valid(source?.fatigue,1,5)?6-source.fatigue:null);
  const complete=source&&valid(source.sleep,1,5)&&valid(source.energy,1,5)&&valid(freshness,1,5)&&valid(source.pain,0,10);
  const readinessScore=complete?Math.max(0,Math.min(100,Math.round((source.sleep+source.energy+freshness)/15*100-Math.max(0,source.pain-2)*3))):null;
  if(!complete)warnings.push('Falta readiness válido del día; no se habilita progresión automática.');
  const footballRows=football.filter(row=>live(row)&&valid(row.duration,1,600)&&valid(row.rpe,1,10)).map(row=>({date:row.date,load:row.duration*row.rpe,rpe:row.rpe}));
  if(footballRows.length!==football.filter(live).length)warnings.push('Se excluyeron registros de fútbol inválidos.');
  const completedHistory=history.filter(item=>item?.session.status==='completed'&&!item.session.deleted_at&&Number.isFinite(dateStamp(item.session.session_date))&&item.session.session_date<=date);
  const gymRows=completedHistory.flatMap(item=>{const metric=sessionMetrics(item);return metric.completedSets>0&&valid(metric.durationSeconds,1,86400)&&valid(metric.rpe,1,10)?[{date:item.session.session_date,load:metric.durationSeconds/60*metric.rpe}]:[];});
  const freeWorkoutLoadsRecent=freeWorkoutLoads(completedHistory,date),footballTrend=loadTrend(footballRows,date),gymTrend=loadTrend(gymRows,date);
  if(!footballTrend.sufficient||!gymTrend.sufficient)warnings.push('Historial de carga insuficiente: se usan reglas generales; ausencia de registros no equivale a descanso.');
  const intenseFootball=footballRows.some(row=>{const age=(today-dateStamp(row.date))/DAY;return age>=0&&age<=2&&row.rpe>=8&&row.load>=480;});
  return {date,dayIndex,daysToMatch,readinessScore,rawReadiness:source?structuredClone(source):null,sleep:complete?source.sleep:null,energy:complete?source.energy:null,freshness:complete?freshness:null,pain:valid(source?.pain,0,10)?source.pain:null,footballTrend,gymTrend,freeWorkoutLoads:freeWorkoutLoadsRecent,intenseFootball,history:completedHistory,patterns:personalPatterns({gymRows,readiness,matches,date}),warnings};
}
