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

async function v3UpdateReasons(indexedDB,storage,userId,now){
  const reasons=[];let names=[];
  if(typeof indexedDB?.databases==='function')names=(await indexedDB.databases()).filter(info=>info.name?.startsWith(DB_PREFIX)).map(info=>info.name);
  else if(userId)names=[`${DB_PREFIX}${encodeURIComponent(userId)}`];
  else if(storage.getItem(V3_LOCAL_FLAG)==='true')return ['No se puede verificar la sesión V3 de este navegador. Cerrá la vista V3 o recargá antes de actualizar.'];
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
      if((rows.workout_sessions||[]).some(row=>row.owner_id===owner&&!row.deleted_at&&row.status==='draft'))reasons.push('Hay una sesión V3 activa. Finalizala antes de actualizar.');
      if((rows.sync_metadata||[]).some(row=>row.owner_id===owner&&row.key==='training:state'&&row.value?.activeSessionId))reasons.push('Hay un borrador V3 activo. Conservalo y terminá la sesión antes de actualizar.');
      if((rows.pending_operations||[]).some(row=>row.owner_id===owner&&row.status==='syncing'))reasons.push('Hay una operación V3 sincronizándose. Esperá su resultado antes de actualizar.');
      if((rows.sync_leases||[]).some(row=>row.owner_id===owner&&row.expires_at>now))reasons.push('Otra pestaña mantiene una operación V3 crítica en curso.');
      if((rows.sync_metadata||[]).some(row=>row.owner_id===owner&&String(row.key).startsWith('diagnostic:attempt:')&&row.value?.status==='running'))reasons.push('Hay un intento de sync V3 en curso.');
    }finally{database.close();}
  }
  return reasons;
}

export async function collectPwaUpdateSafety({storage=globalThis.localStorage,indexedDB=globalThis.indexedDB,userId=null,critical=false,dirty=false,now=Date.now()}={}){
  const reasons=[];
  if(critical)reasons.push('Hay una operación local en curso. Esperá a que termine.');
  if(dirty)reasons.push('Hay cambios sin guardar en un formulario. Guardalos antes de actualizar.');
  try{reasons.push(...v2UpdateReasons(storage));}catch{reasons.push('No se pudo comprobar la sesión local V2.');}
  try{reasons.push(...await v3UpdateReasons(indexedDB,storage,userId,now));}catch{reasons.push('No se pudo comprobar IndexedDB V3.');}
  return {safe:reasons.length===0,reasons:[...new Set(reasons)]};
}
