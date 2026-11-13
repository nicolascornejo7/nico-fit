// Which load the first set of today should suggest.
// Priority: a Coach reduction (pain, pre-match activation) > a Coach block on
// progression (near the match, recent leg load) > the progression rule
// (top of range with margin) > the last load used.
const num=value=>value===''||value==null?null:Number.isFinite(Number(value))?Number(value):null;
const REDUCING=new Set(['reduce_load','activation']);
const BLOCKING=new Set(['avoid_leg_progression','maintain_load','reduce_sets','deload','rest','avoid_high_plyo']);

export function startingLoad({progression=null,coach=null,lastLoad=null}={}){
  const last=num(lastLoad),suggested=num(progression?.kg),coachLoad=num(coach?.suggestedLoad);
  if(coach&&REDUCING.has(coach.action)&&coachLoad!=null&&(last==null||coachLoad<last))return {kind:'coach',load:coachLoad};
  if(coach?.action==='progress_load'&&coachLoad!=null&&(last==null||coachLoad>last))return {kind:'progress',load:coachLoad};
  if(coach&&BLOCKING.has(coach.action))return {kind:'last',load:last??suggested};
  if(suggested!=null&&last!=null&&suggested>last)return {kind:'progress',load:suggested};
  return {kind:'last',load:last??suggested};
}
