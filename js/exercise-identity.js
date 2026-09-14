const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const aliases=new Map([
  ['sentadilla o prensa','sentadilla-prensa'],['dominadas o jalon','dominadas-jalon'],['dominadas jalon','dominadas-jalon'],
  ['gemelos','elevacion-gemelos'],['elevacion de gemelos','elevacion-gemelos'],['plancha pallof press','plancha-pallof']
]);

export function exerciseId(value){
  if(value&&typeof value==='object'&&value.id)return String(value.id);
  const name=normalize(typeof value==='string'?value:value?.name);return aliases.get(name)||name.replace(/ /g,'-');
}

export function sameExercise(a,b){return exerciseId(a)===exerciseId(b);}
export function canonicalExercise(exercise){return {id:exerciseId(exercise),name:String(exercise.name||'').trim()};}
