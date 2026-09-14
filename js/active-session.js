const ACTIVE_PREFIX='gymFutbolActiveSessionV2';

const clone=value=>JSON.parse(JSON.stringify(value));
const toMs=value=>Number.isFinite(value)?value:Date.parse(value);

export function activeSessionKey(owner='guest'){return `${ACTIVE_PREFIX}:${owner||'guest'}`;}
export function elapsedSeconds(startedAt,now=Date.now()){return Math.max(0,Math.floor((now-toMs(startedAt))/1000)||0);}
export function remainingRestSeconds(rest,now=Date.now()){return rest?Math.max(0,Math.ceil((toMs(rest.endsAt)-now)/1000)||0):0;}

function normalizeSet(value={}){return {kg:String(value.kg??''),reps:String(value.reps??''),rir:String(value.rir??''),done:!!value.done};}
function normalizeState(value){
  if(!value||value.version!==1||!['active','summary'].includes(value.phase)||!value.sessionDate||!Number.isInteger(+value.dayIndex)||+value.dayIndex<0||+value.dayIndex>6||!Number.isFinite(toMs(value.startedAt)))return null;
  const exercises=Array.isArray(value.exercises)?value.exercises.map(ex=>({name:String(ex.name||''),sets:Array.isArray(ex.sets)?ex.sets.map(normalizeSet):[]})):[];
  return {
    version:1,phase:value.phase,sessionDate:value.sessionDate,dayIndex:+value.dayIndex,day:String(value.day||''),
    label:String(value.label||''),intensity:String(value.intensity||''),startedAt:new Date(toMs(value.startedAt)).toISOString(),
    currentExercise:Math.max(0,Math.min(+value.currentExercise||0,Math.max(0,exercises.length-1))),exercises,
    rest:value.rest&&Number.isFinite(toMs(value.rest.startedAt))&&Number.isFinite(toMs(value.rest.endsAt))?{
      startedAt:new Date(toMs(value.rest.startedAt)).toISOString(),endsAt:new Date(toMs(value.rest.endsAt)).toISOString(),durationSeconds:Math.max(0,+value.rest.durationSeconds||0)
    }:null,
    restFinishedAt:value.restFinishedAt||null,summary:value.summary?clone(value.summary):null,
    saveStatus:value.saveStatus||'draft',saveMessage:value.saveMessage||'',updatedAt:value.updatedAt||new Date().toISOString()
  };
}

export class ActiveSessionStore{
  constructor({storage=localStorage,owner='guest',now=()=>Date.now()}={}){this.storage=storage;this.owner=owner||'guest';this.now=now;this.state=this.load();}
  load(){try{return normalizeState(JSON.parse(this.storage.getItem(activeSessionKey(this.owner))||'null'));}catch{return null;}}
  setOwner(owner='guest'){this.owner=owner||'guest';this.state=this.load();return this.state;}
  persist(){
    if(this.state){this.state.updatedAt=new Date(this.now()).toISOString();this.storage.setItem(activeSessionKey(this.owner),JSON.stringify(this.state));}
    else this.storage.removeItem(activeSessionKey(this.owner));
    return this.state;
  }
  start({sessionDate,dayIndex,day,label,intensity,exercises,startedAt=this.now()}){
    this.state=normalizeState({version:1,phase:'active',sessionDate,dayIndex,day,label,intensity,startedAt,currentExercise:0,
      exercises:exercises.map(ex=>({name:ex.name,sets:(ex.sets||[]).map(normalizeSet)})),rest:null,summary:null,saveStatus:'draft'});
    return this.persist();
  }
  replaceDrafts(exercises,currentExercise=this.state?.currentExercise||0){
    if(!this.state)return null;this.state.exercises=exercises.map(ex=>({name:ex.name,sets:(ex.sets||[]).map(normalizeSet)}));
    this.state.currentExercise=Math.max(0,Math.min(+currentExercise||0,Math.max(0,this.state.exercises.length-1)));return this.persist();
  }
  setCurrentExercise(index){if(!this.state)return;this.state.currentExercise=Math.max(0,+index||0);this.persist();}
  startRest(durationSeconds){
    if(!this.state)return null;const started=this.now();this.state.rest={startedAt:new Date(started).toISOString(),endsAt:new Date(started+durationSeconds*1000).toISOString(),durationSeconds};
    this.state.restFinishedAt=null;return this.persist();
  }
  extendRest(seconds){if(!this.state?.rest)return null;this.state.rest.endsAt=new Date(toMs(this.state.rest.endsAt)+seconds*1000).toISOString();this.state.rest.durationSeconds+=seconds;return this.persist();}
  stopRest(){if(!this.state)return null;this.state.rest=null;this.state.restFinishedAt=null;return this.persist();}
  reconcileTime(){
    if(!this.state?.rest||remainingRestSeconds(this.state.rest,this.now())>0)return false;
    this.state.restFinishedAt=this.state.rest.endsAt;this.state.rest=null;this.persist();return true;
  }
  prepareSummary(summary){if(!this.state)return null;this.state.phase='summary';this.state.rest=null;this.state.summary=clone(summary);this.state.saveStatus='draft';this.state.saveMessage='';return this.persist();}
  updateSummary(fields){if(!this.state?.summary)return null;Object.assign(this.state.summary,fields);return this.persist();}
  markSaving(){if(!this.state)return;this.state.saveStatus='saving';this.state.saveMessage='Guardando y confirmando…';this.persist();}
  markSavePending(message='Pendiente de sincronizar'){if(!this.state)return;this.state.saveStatus='pending';this.state.saveMessage=message;this.persist();}
  clear(){this.state=null;this.persist();}
}

export async function commitPendingSession({store,persistLocal,syncRemote,requireRemote}){
  if(!store.state?.summary)return {saved:false,error:new Error('No hay un resumen pendiente.')};
  store.markSaving();
  try{
    await persistLocal(clone(store.state));
    if(requireRemote){const confirmed=await syncRemote();if(!confirmed)throw new Error('Pendiente de sincronizar');}
    store.clear();return {saved:true};
  }catch(error){store.markSavePending(error?.message||'Pendiente de sincronizar');return {saved:false,error};}
}
