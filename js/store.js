const STORE_KEY='gymFutbolAppV2';
const LEGACY_KEY='gymFutbolAppV1';
export const emptyData=()=>({readiness:[],workouts:[],matches:[],football:[],sessions:[]});
export function loadLocalData(){
  for(const key of [STORE_KEY,LEGACY_KEY]){
    try{
      const parsed=JSON.parse(localStorage.getItem(key)||'{}');
      if(Object.keys(parsed).length) return {
        readiness:Array.isArray(parsed.readiness)?parsed.readiness:[],
        workouts:Array.isArray(parsed.workouts)?parsed.workouts:[],
        matches:Array.isArray(parsed.matches)?parsed.matches:[],
        football:Array.isArray(parsed.football)?parsed.football:[],
        sessions:Array.isArray(parsed.sessions)?parsed.sessions:[]
      };
    }catch{}
  }
  return emptyData();
}
export function saveLocalData(data){ localStorage.setItem(STORE_KEY,JSON.stringify(data)); }
export function clearLocalData(){ localStorage.removeItem(STORE_KEY); localStorage.removeItem(LEGACY_KEY); }
export function nowIso(){return new Date().toISOString();}
export function dedupeBy(items,keyFn){
  const map=new Map();
  for(const item of items){const k=keyFn(item);const old=map.get(k);if(!old||(item.updatedAt||item.updated_at||'')>=(old.updatedAt||old.updated_at||''))map.set(k,item);}
  return [...map.values()];
}
export const workoutKey=x=>`${x.date}::${x.exercise}`;
