const numeric=value=>Number.isFinite(Number(value))?Number(value):null;
const newest=(rows=[])=>[...rows].filter(row=>row?.date).sort((a,b)=>a.date.localeCompare(b.date));

export const PROGRESS_AREAS=[['strength','Fuerza'],['readiness','Readiness'],['football','Fútbol']];
export const READINESS_METRICS={score:{label:'Score global',min:0,max:100},sleep:{label:'Sueño',min:1,max:5},energy:{label:'Energía',min:1,max:5},freshness:{label:'Frescura',min:1,max:5},pain:{label:'Dolor',min:0,max:10}};

export function trend(values=[]){
  const rows=values.map(numeric).filter(value=>value!=null);
  if(rows.length<2)return {key:'insufficient',label:'Todavía sin tendencia'};
  const change=rows.at(-1)-rows[0],threshold=Math.max(0.5,Math.abs(rows[0])*.03);
  return change>threshold?{key:'up',label:'Subiendo'}:change<-threshold?{key:'down',label:'Bajando'}:{key:'steady',label:'Estable'};
}

export function strengthSummary(exercises=[],identity=null){
  const rows=newest(exercises.filter(row=>row.identity===identity&&numeric(row.maxLoad)!=null));
  const best=Math.max(0,...rows.map(row=>numeric(row.maxLoad)||0)),volume=rows.reduce((sum,row)=>sum+(numeric(row.volume)||0),0);
  return {rows,best,volume,trend:trend(rows.map(row=>row.maxLoad))};
}

export function readinessSummary(readiness=[],metric='score'){
  const definition=READINESS_METRICS[metric]||READINESS_METRICS.score,rows=newest(readiness).map(row=>({...row,value:numeric(metric==='score'?row.value:row[metric])})).filter(row=>row.value!=null);
  return {metric,definition,rows,latest:rows.at(-1)?.value??null,trend:trend(rows.map(row=>row.value))};
}

export function footballSummary(football=[],matches=[]){
  const sessions=newest(football),reviews=newest(matches),load=sessions.reduce((sum,row)=>sum+(numeric(row.load)||0),0),latestReview=reviews.at(-1)??null;
  return {sessions,reviews,load,latestReview,trend:trend(sessions.map(row=>row.load))};
}

export function recentTimeline({sessions=[],football=[],matches=[]}={},limit=5){
  const all=[
    ...sessions.map(row=>({...row,kind:'session'})),
    ...football.map(row=>({...row,kind:'football'})),
    ...matches.map(row=>({...row,kind:'match'}))
  ].sort((a,b)=>b.date.localeCompare(a.date));
  return {recent:all.slice(0,limit),older:all.slice(limit)};
}
