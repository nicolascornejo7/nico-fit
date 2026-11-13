// Week mode, stored on this device only (localStorage, per user):
//  - match: the default, a Saturday match drives the week.
//  - no_match: this week has no match; Saturday becomes a training day.
//  - off_season: from the chosen week on, until switched back to match.
// Reads never throw: without storage every week is a match week.
export const WEEK_MODES=Object.freeze({match:'Con partido',no_match:'Sin partido',off_season:'Fuera de temporada'});
const KEY=userId=>`nicoFit.weekMode.v1:${userId||'guest'}`;
const DAY=86400000;
const stamp=date=>Date.parse(`${date}T12:00:00Z`);
export const weekStartOf=date=>{const time=stamp(date),day=new Date(time).getUTCDay();return new Date(time-((day+6)%7)*DAY).toISOString().slice(0,10);};

function read(storage,userId){
  try{const value=JSON.parse(storage?.getItem(KEY(userId))||'null');return {offSeasonSince:typeof value?.offSeasonSince==='string'?value.offSeasonSince:null,noMatchWeeks:Array.isArray(value?.noMatchWeeks)?value.noMatchWeeks.filter(item=>typeof item==='string'):[]};}
  catch{return {offSeasonSince:null,noMatchWeeks:[]};}
}

export function weekModeFor(userId,date,{storage=globalThis.localStorage}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return 'match';
  const state=read(storage,userId),week=weekStartOf(date);
  if(state.offSeasonSince&&week>=state.offSeasonSince)return 'off_season';
  return state.noMatchWeeks.includes(week)?'no_match':'match';
}

export function setWeekMode(userId,date,mode,{storage=globalThis.localStorage}={}){
  if(!WEEK_MODES[mode])throw new Error('Modo de semana inválido.');
  const state=read(storage,userId),week=weekStartOf(date);
  state.noMatchWeeks=state.noMatchWeeks.filter(item=>item!==week&&item>=weekStartOf(new Date(stamp(date)-120*DAY).toISOString().slice(0,10)));
  if(mode==='off_season')state.offSeasonSince=state.offSeasonSince&&state.offSeasonSince<=week?state.offSeasonSince:week;
  else{if(state.offSeasonSince&&week>=state.offSeasonSince)state.offSeasonSince=null;if(mode==='no_match')state.noMatchWeeks.push(week);}
  try{storage?.setItem(KEY(userId),JSON.stringify(state));}catch{throw new Error('No se pudo guardar el modo en este dispositivo.');}
  return weekModeFor(userId,date,{storage});
}

export const hasMatchThisWeek=mode=>mode==='match';
