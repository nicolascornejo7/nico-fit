const fields=new Set(['sleep','energy','freshness','pain','painArea','footballDuration','footballRpe','footballMinutes','matchEnergy','legs','performance','matchNotes']);
const drafts=new Map();
export function trackPwaFormDrafts(documentLike=globalThis.document){
  documentLike.addEventListener('input',event=>{if(fields.has(event.target?.id))drafts.set(event.target.id,event.target.value);});
}
export function hasPwaFormDrafts(){return drafts.size>0;}
export function restorePwaFormDrafts(documentLike=globalThis.document){for(const [id,value] of drafts){const field=documentLike.getElementById(id);if(field)field.value=value;}}
export function clearPwaFormDrafts(ids){for(const id of ids)drafts.delete(id);}
