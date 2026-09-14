const STORE_PREFIX='gymFutbolAppV2';
const LEGACY_KEY='gymFutbolAppV1';

export const emptyData=()=>({readiness:[],workouts:[],matches:[],football:[],sessions:[],tombstones:[]});
export function storageKey(owner='guest'){return `${STORE_PREFIX}:${owner||'guest'}`;}
function normalizeData(parsed={}){return {
  readiness:Array.isArray(parsed.readiness)?parsed.readiness:[],workouts:Array.isArray(parsed.workouts)?parsed.workouts:[],
  matches:Array.isArray(parsed.matches)?parsed.matches:[],football:Array.isArray(parsed.football)?parsed.football:[],
  sessions:Array.isArray(parsed.sessions)?parsed.sessions:[],tombstones:Array.isArray(parsed.tombstones)?parsed.tombstones:[]
};}
export function loadLocalData(owner='guest'){
  const keys=[storageKey(owner)];
  // Unscoped V1/V2 data remains in the guest profile and is never uploaded
  // automatically to whichever account signs in next.
  if(owner==='guest')keys.push(STORE_PREFIX,LEGACY_KEY);
  for(const key of keys){try{const parsed=JSON.parse(localStorage.getItem(key)||'{}');if(Object.keys(parsed).length)return normalizeData(parsed);}catch{}}
  return emptyData();
}
export function saveLocalData(data,owner='guest'){localStorage.setItem(storageKey(owner),JSON.stringify(normalizeData(data)));}
export function clearLocalData(owner='guest'){
  localStorage.removeItem(storageKey(owner));
  if(owner==='guest'){localStorage.removeItem(STORE_PREFIX);localStorage.removeItem(LEGACY_KEY);}
}
export function nowIso(){return new Date().toISOString();}
export function dedupeBy(items,keyFn){
  const map=new Map();
  for(const item of items){const k=keyFn(item),old=map.get(k);if(!old||Date.parse(item.updatedAt||item.updated_at||item.deletedAt||item.deleted_at||0)>=Date.parse(old.updatedAt||old.updated_at||old.deletedAt||old.deleted_at||0))map.set(k,item);}
  return [...map.values()];
}
export const workoutKey=x=>JSON.stringify([x.date,x.exercise]);
export const recordKeys={readiness:x=>x.date,workouts:workoutKey,matches:x=>x.date,football:x=>JSON.stringify([x.date,x.type]),sessions:x=>JSON.stringify([x.date,x.label])};
export function tombstoneKey(x){return `${x.entity}\u0000${x.recordKey}`;}
export function applyTombstones(data){
  const result=normalizeData(data);result.tombstones=dedupeBy(result.tombstones,tombstoneKey);
  const deleted=new Set(result.tombstones.map(t=>tombstoneKey(t)));
  const deleteAll=result.tombstones.filter(t=>t.entity==='*').reduce((latest,t)=>Math.max(latest,Date.parse(t.deletedAt||0)||0),0);
  for(const [entity,keyFn] of Object.entries(recordKeys))result[entity]=result[entity].filter(item=>!deleted.has(tombstoneKey({entity,recordKey:keyFn(item)}))&&(!deleteAll||Date.parse(item.updatedAt||0)>deleteAll));
  return result;
}
