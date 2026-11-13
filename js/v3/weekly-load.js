// Weekly load toward Saturday: football sRPE + gym (minutes × session RPE) in
// arbitrary units, an acute:chronic ratio and a simple traffic light. These are
// conservative product heuristics, not a medical or physiological diagnosis.

const DAY=86400000;
const stamp=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')?Date.parse(`${date}T12:00:00Z`):NaN;

export const WEEKLY_LOAD_ZONES=Object.freeze({low:0.8,high:1.3,danger:1.5,minChronicWeeks:3});
export const ACWR_ZONE_LABEL=Object.freeze({low:'carga baja vs tu base',optimal:'zona estable',high:'subida fuerte',danger:'pico de carga',unknown:'historial insuficiente'});

export function acuteChronic(rows,date){
  const today=stamp(date),weeks=[0,0,0,0],counts=[0,0,0,0];
  for(const row of rows){
    const age=Math.floor((today-stamp(row.date))/DAY);
    if(!Number.isFinite(age)||age<0||age>=28||!Number.isFinite(row.load)||row.load<0)continue;
    const week=Math.floor(age/7);weeks[week]+=row.load;counts[week]++;
  }
  const acute=Math.round(weeks[0]),chronic=Math.round(weeks.reduce((a,b)=>a+b,0)/4);
  const sufficient=counts.filter(Boolean).length>=WEEKLY_LOAD_ZONES.minChronicWeeks&&chronic>0;
  const acwr=sufficient?Math.round(acute/chronic*100)/100:null;
  const zone=acwr==null?'unknown':acwr>WEEKLY_LOAD_ZONES.danger?'danger':acwr>WEEKLY_LOAD_ZONES.high?'high':acwr<WEEKLY_LOAD_ZONES.low?'low':'optimal';
  return {acute,chronic,acwr,zone,sufficient,weeks:weeks.map(Math.round)};
}

const sumWeek=(rows,date)=>{const today=stamp(date);return Math.round(rows.reduce((sum,row)=>{const age=(today-stamp(row.date))/DAY;return age>=0&&age<7&&Number.isFinite(row.load)?sum+row.load:sum;},0));};

export function weeklyOutlook({date,weekMode='match',footballRows=[],gymRows=[],plyo=null,readinessScore=null,pain=null,daysToMatch}){
  const ratio=acuteChronic([...footballRows,...gymRows],date),reasons=[];
  let level='green';
  const raise=next=>{if(next==='red'||level==='green')level=next;};
  if(pain!=null&&pain>=7){raise('red');reasons.push(`Dolor ${pain}/10: prioridad recuperación.`);}
  else if(pain!=null&&pain>=4){raise('yellow');reasons.push(`Molestia ${pain}/10: evitar cargas máximas y pliometría intensa.`);}
  if(readinessScore==null)reasons.push('Sin check-in completo hoy: el semáforo usa sólo la carga registrada.');
  else if(readinessScore<40){raise('red');reasons.push(`Readiness ${readinessScore}/100: muy bajo.`);}
  else if(readinessScore<60){raise('yellow');reasons.push(`Readiness ${readinessScore}/100: bajo.`);}
  if(ratio.zone==='danger'){raise('red');reasons.push(`Carga de la semana ${ratio.acwr}× tu promedio de 4 semanas: pico de carga, bajar volumen.`);}
  else if(ratio.zone==='high'){raise('yellow');reasons.push(`Carga de la semana ${ratio.acwr}× tu promedio: subida fuerte.`);}
  else if(ratio.zone==='low')reasons.push(`Carga de la semana ${ratio.acwr}× tu promedio: semana liviana.`);
  else if(ratio.zone==='unknown')reasons.push('Menos de 3 semanas con registros: la relación de carga todavía no es confiable.');
  if(plyo){
    if(plyo.overWeekly){raise('yellow');reasons.push(`Pliometría: ${plyo.contacts} contactos en 7 días (tope orientativo ${plyo.limits.weeklyContacts}).`);}
    if(plyo.overHigh){raise('yellow');reasons.push(`Pliometría intensa: ${plyo.byIntensity.high} contactos de alta intensidad (tope ${plyo.limits.weeklyHighContacts}).`);}
    if(daysToMatch<=plyo.limits.highFreeDaysBeforeMatch&&daysToMatch>0&&plyo.highLast48h>0){raise('yellow');reasons.push('Pliometría o sprints intensos en las últimas 48 h antes del partido.');}
  }
  const titles={match:['Riesgo de llegar cargado','Llegás, pero cuidá la carga','En camino para el sábado'],no_match:['Semana sin partido: priorizá recuperar','Semana sin partido: cuidá la carga','Semana sin partido: buen momento para cargar'],off_season:['Fuera de temporada: priorizá recuperar','Fuera de temporada: cuidá la carga','Fuera de temporada: bloque de hipertrofia']}[weekMode]??[];
  const title=level==='red'?titles[0]:level==='yellow'?titles[1]:titles[2];
  if(level==='green'&&!reasons.length)reasons.push('Carga, readiness y pliometría dentro de lo esperado.');
  return {level,title,weekMode,daysToMatch,reasons,footballWeek:sumWeek(footballRows,date),gymWeek:sumWeek(gymRows,date),...ratio,plyo};
}
