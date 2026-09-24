const DB_PREFIX='nico-fit-v3-local:';
const V3_LOCAL_FLAG='nicoFit.v3.localStorage.enabled';
const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB no disponible.'));});

function existingDatabase(indexedDB,name){return new Promise((resolve,reject)=>{
  const request=indexedDB.open(name);let absent=false;
  request.onupgradeneeded=()=>{absent=true;request.transaction.abort();};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>absent?resolve(null):reject(request.error||new Error('No se pudo abrir IndexedDB.'));
});}

export function v2UpdateReasons(storage){
  const reasons=[];
  for(let index=0;index<storage.length;index++){
    const key=storage.key(index);
    if(!key?.startsWith('gymFutbolActiveSessionV2:'))continue;
    const raw=storage.getItem(key);if(!raw)continue;
    try{
      const state=JSON.parse(raw);if(!state)continue;
      if(state.phase==='summary'||['pending','saving'].includes(state.saveStatus))reasons.push('Hay una finalización V2 pendiente. Guardala o resolvé la sincronización antes de actualizar.');
      else reasons.push('Hay una sesión V2 activa. Finalizala antes de actualizar.');
    }catch{reasons.push('Hay un estado V2 local que no se puede verificar. Hacé un respaldo antes de actualizar.');}
  }
  return reasons;
}

async function v3UpdateReasons(indexedDB,storage,userId,now,blockers,observations){
  const reasons=[];let names=[];
  if(userId)names=[`${DB_PREFIX}${encodeURIComponent(userId)}`];
  else if(typeof indexedDB?.databases==='function')names=(await indexedDB.databases()).filter(info=>info.name?.startsWith(DB_PREFIX)).map(info=>info.name);
  else if(storage.getItem(V3_LOCAL_FLAG)==='true'){blockers.v3VerificationError=true;return ['No se puede verificar la sesión V3 de este navegador. Cerrá la vista V3 o recargá antes de actualizar.'];}
  for(const name of names){
    const database=await existingDatabase(indexedDB,name);if(!database)continue;
    try{
      const stores=['workout_sessions','sync_metadata','pending_operations','sync_leases'].filter(store=>database.objectStoreNames.contains(store));
      if(!stores.length)continue;
      const transaction=database.transaction(stores,'readonly');
      const finished=new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error||new Error('Lectura interrumpida.'));transaction.onerror=()=>reject(transaction.error||new Error('Lectura fallida.'));});
      const reads=Object.fromEntries(stores.map(store=>[store,requestResult(transaction.objectStore(store).getAll())]));
      const rows=Object.fromEntries(await Promise.all(Object.entries(reads).map(async([store,promise])=>[store,await promise])));
      await finished;
      const owner=decodeURIComponent(name.slice(DB_PREFIX.length));
      const sessions=(rows.workout_sessions||[]).filter(row=>row.owner_id===owner&&!row.deleted_at&&row.status==='draft');
      const sessionById=new Map(sessions.map(row=>[row.id,row]));
      const checkpoints=(rows.sync_metadata||[]).filter(row=>row.owner_id===owner&&row.key==='training:state'&&row.value?.activeSessionId);
      const drafts=checkpoints.filter(row=>sessionById.has(row.value.activeSessionId));
      const activeIds=new Set(drafts.map(row=>row.value.activeSessionId));
      const syncing=(rows.pending_operations||[]).filter(row=>row.owner_id===owner&&row.status==='syncing');
      const leases=(rows.sync_leases||[]).filter(row=>row.owner_id===owner&&row.expires_at>now);
      const attempts=(rows.sync_metadata||[]).filter(row=>row.owner_id===owner&&String(row.key).startsWith('diagnostic:attempt:')&&row.value?.status==='running');
      blockers.activeSessionCount+=activeIds.size;blockers.activeDraftCount+=drafts.length;blockers.syncingOperationCount+=syncing.length;blockers.activeLeaseCount+=leases.length;blockers.runningSyncAttemptCount+=attempts.length;
      observations.pendingLocalWriteCount+=(rows.pending_operations||[]).filter(row=>row.owner_id===owner&&row.status==='pending').length;
      observations.orphanDraftSessionCount+=sessions.filter(row=>!activeIds.has(row.id)).length;
      observations.staleTrainingStateCount+=checkpoints.length-drafts.length;
      if(activeIds.size)reasons.push('Hay una sesión V3 activa. Finalizala antes de actualizar.');
      if(drafts.length)reasons.push('Hay un borrador V3 activo. Conservalo y terminá la sesión antes de actualizar.');
      if(syncing.length)reasons.push('Hay una operación V3 sincronizándose. Esperá su resultado antes de actualizar.');
      if(leases.length)reasons.push('Otra pestaña mantiene una operación V3 crítica en curso.');
      if(attempts.length)reasons.push('Hay un intento de sync V3 en curso.');
    }finally{database.close();}
  }
  return reasons;
}

export async function collectPwaUpdateSafety({storage=globalThis.localStorage,indexedDB=globalThis.indexedDB,userId=null,critical=false,dirty=false,now=Date.now()}={}){
  const reasons=[],blockers={criticalOperation:!!critical,dirtyForm:!!dirty,activeSessionCount:0,activeDraftCount:0,syncingOperationCount:0,activeLeaseCount:0,runningSyncAttemptCount:0,v3VerificationError:false},observations={pendingLocalWriteCount:0,orphanDraftSessionCount:0,staleTrainingStateCount:0};
  if(critical)reasons.push('Hay una operación local en curso. Esperá a que termine.');
  if(dirty)reasons.push('Hay cambios sin guardar en un formulario. Guardalos antes de actualizar.');
  try{reasons.push(...v2UpdateReasons(storage));}catch{reasons.push('No se pudo comprobar la sesión local V2.');}
  try{reasons.push(...await v3UpdateReasons(indexedDB,storage,userId,now,blockers,observations));}catch{blockers.v3VerificationError=true;reasons.push('No se pudo comprobar IndexedDB V3.');}
  return {safe:reasons.length===0,reasons:[...new Set(reasons)],blockers,observations};
}
