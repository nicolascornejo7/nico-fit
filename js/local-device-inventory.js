const KIND='nico-fit-local-device-inventory';
const SCHEMA_VERSION=1;
const DEVICE_KEY='nicoFit.localDevice.id';
const DB_PREFIX='nico-fit-v3-local:';
const V3_ENTITIES=['workout_sessions','session_exercises','exercise_sets','exercise_catalog','daily_readiness','football_sessions','match_reviews','routine_templates','routine_versions','routine_exercises'];
const V3_INTERNAL=['pending_operations','migration_map','sync_metadata','sync_conflicts','sync_leases'];
const LOCAL_FLAGS=new Set(['nicoFit.v3.localStorage.enabled','nicoFit.v3.sync.enabled','v3.training.enabled','v3.coach.enabled','v3.conflicts.enabled','v3.observability.enabled','v3.audit.enabled','v3.routines.enabled','v3.routines.sync.enabled','v3.signals.enabled','v3.signals.sync.enabled']);
const SECRET_KEY=/(token|password|passphrase|authorization|cookie|service.?role|supabase.?key|api.?key|secret|jwt)/i;
const SECRET_TEXT=[/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/gi,/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/gi,/([?&](?:apikey|token|key)=)[^&\s]+/gi,/\b(?:access_token|refresh_token|password|apikey|api_key|service_role|secret)\s*[:=]\s*[^\s,;]+/gi];
const OP_STATES=['pending','syncing','synced','conflict','failed','superseded'];
import {pwaVersionSnapshot} from './pwa-version.js';

const clone=value=>globalThis.structuredClone?globalThis.structuredClone(value):JSON.parse(JSON.stringify(value));
function canonical(value){
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function redactText(value){let text=String(value);for(const pattern of SECRET_TEXT)text=text.replace(pattern,(match,prefix)=>prefix?`${prefix}[REDACTED]`:'[REDACTED]');return text;}
export function sanitizeInventoryValue(value,{error=false}={}){
  if(value==null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return error?redactText(value).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[EMAIL]'):redactText(value);
  if(Array.isArray(value))return value.map(item=>sanitizeInventoryValue(item,{error}));
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!SECRET_KEY.test(key)).map(([key,item])=>[key,sanitizeInventoryValue(item,{error:error||/error/i.test(key)})]));
  return null;
}
async function digest(value,cryptoImpl){
  if(!cryptoImpl?.subtle)throw new Error('Web Crypto no está disponible para calcular el checksum.');
  const bytes=await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function knownLocalKey(key){return key==='gymFutbolAppV1'||key==='gymFutbolAppV2'||key.startsWith('gymFutbolAppV2:')||key.startsWith('gymFutbolActiveSessionV2:')||LOCAL_FLAGS.has(key);}
function scopedKey(key,userId){
  if(!userId)return !key.includes(':')||LOCAL_FLAGS.has(key);
  if(LOCAL_FLAGS.has(key))return true;
  if(userId==='guest'&&(key==='gymFutbolAppV1'||key==='gymFutbolAppV2'))return true;
  return key.endsWith(`:${userId}`);
}
function storageEntries(storage,userId){const result=[];for(let index=0;index<(storage?.length||0);index++){const key=storage.key(index);if(key&&knownLocalKey(key)&&scopedKey(key,userId))result.push([key,storage.getItem(key)]);}return result.sort(([a],[b])=>a.localeCompare(b));}
function parseLocalEntry([key,value],warnings){
  if(LOCAL_FLAGS.has(key))return {key,value:value==='true'?'true':value==='false'?'false':'invalid'};
  try{return {key,value:sanitizeInventoryValue(JSON.parse(value))};}catch{warnings.push(`No se pudo interpretar ${key}; se omitió su contenido por seguridad.`);return {key,value:null,corrupt:true};}
}
const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
const transactionDone=transaction=>new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error||new Error('IndexedDB transaction aborted.'));transaction.onerror=()=>reject(transaction.error||new Error('IndexedDB transaction failed.'));});
function openExistingDatabase(indexedDB,name){return new Promise((resolve,reject)=>{const request=indexedDB.open(name);let missing=false;request.onupgradeneeded=()=>{missing=true;request.transaction.abort();};request.onsuccess=()=>resolve(request.result);request.onerror=()=>missing?resolve(null):reject(request.error||new Error('No se pudo abrir IndexedDB.'));});}
async function readDatabase(indexedDB,info,owner,warnings){
  let database;
  try{
    database=await openExistingDatabase(indexedDB,info.name);if(!database)return null;const stores={};
    const names=[...database.objectStoreNames].sort(),known=names.filter(name=>[...V3_ENTITIES,...V3_INTERNAL].includes(name));
    for(const name of names.filter(name=>!known.includes(name)))warnings.push(`Store no reconocido en ${info.name}: ${name}; se omitió.`);
    const transaction=known.length?database.transaction(known,'readonly'):null;
    const done=transaction?transactionDone(transaction):Promise.resolve();
    const requests=known.map(name=>[name,requestResult(transaction.objectStore(name).getAll())]);
    for(const [name,result] of requests){
      const rows=await result;
      const owned=rows.filter(row=>row?.owner_id===owner);
      if(owned.length!==rows.length)warnings.push(`Filas sin propietario válido o de otro usuario omitidas en ${info.name}/${name}; revisar la base local.`);
      stores[name]=owned.map(row=>sanitizeInventoryValue(row)).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
    }
    await done;
    return {name:info.name,version:database.version,userId:owner,stores};
  }catch(error){warnings.push(`No se pudo leer ${info.name}: ${sanitizeInventoryValue(error?.message||'error',{error:true})}`);return {name:info.name,version:info.version||null,userId:null,stores:{},corrupt:true};}
  finally{database?.close();}
}
function browserDescriptor(navigatorLike={}){
  const brands=navigatorLike.userAgentData?.brands?.map(item=>item.brand).filter(brand=>!/^Not/i.test(brand)).join(', ');
  const agent=String(navigatorLike.userAgent||'');
  const browser=brands||(/Edg\//.test(agent)?'Edge':/Chrome\//.test(agent)?'Chrome':/Firefox\//.test(agent)?'Firefox':/Safari\//.test(agent)?'Safari':'Unknown');
  const platform=navigatorLike.userAgentData?.platform||navigatorLike.platform||(/Android/.test(agent)?'Android':/iPhone|iPad/.test(agent)?'iOS':'Unknown');
  return {browser:redactText(browser).slice(0,120),platform:redactText(platform).slice(0,80),mobile:!!navigatorLike.userAgentData?.mobile,standalone:!!navigatorLike.standalone};
}
function deviceId(storage,cryptoImpl){let value=storage?.getItem(DEVICE_KEY);if(!/^[0-9a-f-]{36}$/i.test(value||'')){value=cryptoImpl?.randomUUID?.()||`local-${Date.now().toString(36)}`;storage?.setItem(DEVICE_KEY,value);}return value;}
function userIdFromDatabaseName(name){try{return decodeURIComponent(name.slice(DB_PREFIX.length));}catch{return null;}}
export async function discoverLocalInventoryUsers({storage=globalThis.localStorage,indexedDB=globalThis.indexedDB}={}){
  const users=new Set();
  for(let index=0;index<(storage?.length||0);index++){
    const match=storage.key(index)?.match(/^gymFutbol(?:AppV2|ActiveSessionV2):(.+)$/);
    if(match?.[1])users.add(match[1]);
  }
  if(storage?.getItem('gymFutbolAppV1')||storage?.getItem('gymFutbolAppV2'))users.add('guest');
  if(typeof indexedDB?.databases==='function')for(const info of await indexedDB.databases())if(info.name?.startsWith(DB_PREFIX)){const userId=userIdFromDatabaseName(info.name);if(userId)users.add(userId);}
  return [...users].sort();
}
function v2Summary(entries){const totals={readiness:0,workouts:0,matches:0,football:0,sessions:0,tombstones:0};for(const item of entries.filter(row=>/^gymFutbolAppV[12](?::|$)/.test(row.key))){for(const key of Object.keys(totals))totals[key]+=Array.isArray(item.value?.[key])?item.value[key].length:0;}return totals;}
function inventorySummary(localStorageEntries,indexedDatabases){
  const v3Entities=Object.fromEntries(V3_ENTITIES.map(name=>[name,0])),operations=Object.fromEntries(OP_STATES.map(status=>[status,0]));let conflicts=0,resolutionsPending=0,resolutionDecisions=0,checkpoints=0;
  const syncState={lastSuccessfulAt:null,lastAttemptAt:null,lastAttemptStatus:null,lastErrorKind:null};
  for(const database of indexedDatabases){for(const [name,rows] of Object.entries(database.stores||{})){
    if(name in v3Entities)v3Entities[name]+=rows.length;
    if(name==='pending_operations')for(const row of rows)operations[row.status]===undefined?operations.failed++:operations[row.status]++;
    if(name==='sync_conflicts')conflicts+=rows.filter(row=>row.status==='open'||row.status==='resolution_pending').length;
    if(name==='sync_metadata'){
      checkpoints+=rows.filter(row=>String(row.key||'').startsWith('checkpoint:')).length;
      const resolutions=rows.filter(row=>String(row.key||'').startsWith('resolution:'));
      resolutionDecisions+=resolutions.length;
      resolutionsPending+=resolutions.filter(row=>row.value?.confirmation==='pending_sync').length;
      const success=rows.find(row=>row.key==='diagnostic:last-success')?.value;
      const attempt=rows.filter(row=>String(row.key||'').startsWith('diagnostic:attempt:')).sort((a,b)=>(b.value?.sequence||0)-(a.value?.sequence||0))[0]?.value;
      const error=rows.find(row=>row.key==='diagnostic:last-error')?.value;
      syncState.lastSuccessfulAt=success?.finishedAt||null;
      syncState.lastAttemptAt=attempt?.startedAt||null;
      syncState.lastAttemptStatus=attempt?.status||null;
      syncState.lastErrorKind=error?.error?.kind||null;
    }
  }}
  const activeSessions=localStorageEntries.filter(row=>row.key.startsWith('gymFutbolActiveSessionV2:')&&row.value).length+indexedDatabases.reduce((sum,database)=>sum+(database.stores?.workout_sessions||[]).filter(row=>!row.deleted_at&&['active','draft','summary'].includes(row.status)).length,0);
  return {v2:v2Summary(localStorageEntries),v3Entities,operations,conflicts,resolutionDecisions,resolutionsPending,checkpoints,syncState,activeSessions,indexedDatabases:indexedDatabases.length};
}

export async function createLocalDeviceInventory({userId=null,storage=globalThis.localStorage,indexedDB=globalThis.indexedDB,navigatorLike=globalThis.navigator,locationLike=globalThis.location,cacheStorage=globalThis.caches,documentLike=globalThis.document,cryptoImpl=globalThis.crypto,now=()=>new Date()}={}){
  const owner=userId?String(userId):null,warnings=[],localEntries=storageEntries(storage,owner).map(entry=>parseLocalEntry(entry,warnings));let databaseInfos=[];
  if(typeof indexedDB?.databases==='function')databaseInfos=(await indexedDB.databases()).filter(info=>info.name===`${DB_PREFIX}${encodeURIComponent(owner||'')}`).sort((a,b)=>a.name.localeCompare(b.name));
  else if(owner)databaseInfos=[{name:`${DB_PREFIX}${encodeURIComponent(owner)}`,version:null}];
  else warnings.push('Este navegador no permite enumerar IndexedDB y no se seleccionó un usuario; el inventario V3 puede estar incompleto.');
  if(!owner)warnings.push('No se seleccionó un usuario: sólo se exportaron datos V2 legacy sin ámbito y flags locales.');
  const indexedDatabases=[];for(const info of databaseInfos){const database=await readDatabase(indexedDB,info,owner,warnings);if(database)indexedDatabases.push(database);}
  let cacheNames=[];try{cacheNames=(await cacheStorage?.keys?.()||[]).filter(name=>name.startsWith('nico-fit-v')).sort();}catch(error){warnings.push(`No se pudo consultar la versión del service worker: ${sanitizeInventoryValue(error?.message||'error',{error:true})}`);}
  let registration=null;try{registration=await navigatorLike?.serviceWorker?.getRegistration?.();}catch{}
  const base={kind:KIND,schemaVersion:SCHEMA_VERSION,createdAt:now().toISOString(),origin:String(locationLike?.origin||'unknown'),userId:owner,device:{id:deviceId(storage,cryptoImpl),...browserDescriptor(navigatorLike)},app:{build:documentLike?.querySelector?.('meta[name="nico-fit-build"]')?.content||'unknown',online:navigatorLike?.onLine!==false,serviceWorker:{controlled:!!navigatorLike?.serviceWorker?.controller,script:registration?.active?.scriptURL?new URL(registration.active.scriptURL,String(locationLike?.origin||undefined)).pathname:null,cacheVersions:cacheNames,...await pwaVersionSnapshot({documentLike,navigatorLike,registration})}},summary:null,payload:{localStorage:localEntries,indexedDB:indexedDatabases},warnings:sanitizeInventoryValue(warnings,{error:true})};
  base.summary=inventorySummary(localEntries,indexedDatabases);const value=await digest(canonical(base),cryptoImpl);return {...base,checksum:{algorithm:'SHA-256',value}};
}

export async function validateLocalDeviceInventory(input,{cryptoImpl=globalThis.crypto}={}){
  const errors=[],warnings=[];let data;
  try{data=typeof input==='string'?JSON.parse(input):clone(input);}catch{return {valid:false,complete:false,corrupt:true,errors:['JSON inválido.'],warnings:[],summary:null,localOnlyCandidates:[],shouldSyncBeforeCutover:true};}
  if(data?.kind!==KIND)errors.push('Tipo de archivo incorrecto.');if(data?.schemaVersion!==SCHEMA_VERSION)errors.push('schemaVersion no soportado.');
  if(!data?.checksum?.value)errors.push('Falta checksum.');else{const checksum=data.checksum;delete data.checksum;const actual=await digest(canonical(data),cryptoImpl);data.checksum=checksum;if(checksum.algorithm!=='SHA-256'||actual!==checksum.value)errors.push('Checksum inválido: el archivo cambió o está corrupto.');}
  if(!Array.isArray(data?.payload?.localStorage))errors.push('Falta payload.localStorage.');if(!Array.isArray(data?.payload?.indexedDB))errors.push('Falta payload.indexedDB.');
  const localEntries=Array.isArray(data?.payload?.localStorage)?data.payload.localStorage:[],databases=Array.isArray(data?.payload?.indexedDB)?data.payload.indexedDB:[];
  if(localEntries.some(row=>!row||typeof row.key!=='string')||databases.some(row=>!row||!row.stores||typeof row.stores!=='object'||Object.values(row.stores).some(store=>!Array.isArray(store)||store.some(entry=>!entry||typeof entry!=='object'))))errors.push('Estructura del payload inválida.');
  if(databases.some(row=>row?.userId!==data?.userId))errors.push('La base IndexedDB no corresponde al usuario del archivo.');
  if(errors.some(error=>/Estructura del payload/.test(error)))return {valid:false,complete:false,corrupt:true,errors,warnings:[],summary:null,localOnlyCandidates:[],shouldSyncBeforeCutover:true};
  const summary=inventorySummary(localEntries,databases);
  if(JSON.stringify(summary)!==JSON.stringify(data?.summary))errors.push('Los conteos declarados no coinciden con el payload.');
  if(data?.warnings?.length)warnings.push(...data.warnings);
  const localOnlyCandidates=[];
  for(const item of localEntries.filter(row=>/^gymFutbolAppV[12](?::|$)/.test(row.key)))for(const entity of ['readiness','workouts','matches','football','sessions','tombstones'])if(item.value?.[entity]?.length)localOnlyCandidates.push({source:'V2',scope:item.key,entity,count:item.value[entity].length,reason:'Requiere comparar con Supabase V2.'});
  for(const database of databases)for(const entity of V3_ENTITIES){const rows=database.stores?.[entity]||[],local=rows.filter(row=>row.sync_status!=='synced'||row.remote_version==null);if(local.length)localOnlyCandidates.push({source:'V3',scope:database.userId||database.name,entity,count:local.length,reason:'Sin confirmación remota completa.'});}
  const unresolved=(summary.operations.pending||0)+(summary.operations.syncing||0)+(summary.operations.failed||0)+(summary.operations.conflict||0),active=summary.activeSessions>0,conflicts=summary.conflicts>0,complete=errors.length===0&&!databases.some(item=>item.corrupt)&&!localEntries.some(item=>item.corrupt)&&!warnings.some(item=>/incompleto|No se seleccionó|otro usuario|propietario válido|Store no reconocido/i.test(item));
  return {valid:errors.length===0,complete,corrupt:errors.length>0,errors,warnings,summary,localOnlyCandidates,pendingSync:unresolved,activeSession:active,conflicts,shouldSyncBeforeCutover:errors.length>0||!complete||unresolved>0||active||conflicts||localOnlyCandidates.length>0,device:data?.device||null,createdAt:data?.createdAt||null};
}

export function downloadLocalDeviceInventory(inventory,{documentLike=globalThis.document,urlApi=globalThis.URL}={}){
  const blob=new Blob([JSON.stringify(inventory,null,2)],{type:'application/json'}),link=documentLike.createElement('a');link.href=urlApi.createObjectURL(blob);link.download=`nico-fit-device-inventory-${inventory.createdAt.replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>urlApi.revokeObjectURL(link.href),1000);return link.download;
}
