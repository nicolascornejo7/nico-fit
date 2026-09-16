const DB_VERSION=4;
const DB_PREFIX='nico-fit-v3-local';

export const SIGNAL_STORES=['daily_readiness','football_sessions','match_reviews'];
export const ROUTINE_STORES=['routine_templates','routine_versions','routine_exercises'];
export const ENTITY_STORES=['workout_sessions','session_exercises','exercise_sets','exercise_catalog',...SIGNAL_STORES,...ROUTINE_STORES];
export const INTERNAL_STORES={
  operations:'pending_operations',migrations:'migration_map',
  metadata:'sync_metadata',conflicts:'sync_conflicts',leases:'sync_leases'
};

export function databaseNameForUser(userId){
  const owner=String(userId||'').trim();
  if(!owner||owner==='guest')throw new Error('V3 IndexedDB requires an authenticated user id.');
  return `${DB_PREFIX}:${encodeURIComponent(owner)}`;
}

export function requestResult(request){
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));
  });
}

export function transactionDone(transaction){
  return new Promise((resolve,reject)=>{
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(transaction.error||new Error('IndexedDB transaction aborted.'));
    transaction.onerror=()=>reject(transaction.error||new Error('IndexedDB transaction failed.'));
  });
}

function getOrCreateStore(database,transaction,name,options={keyPath:'id'}){
  return database.objectStoreNames.contains(name)?transaction.objectStore(name):database.createObjectStore(name,options);
}

function ensureIndex(store,name,keyPath,options){
  if(store&&!store.indexNames.contains(name))store.createIndex(name,keyPath,options);
}

function upgrade(database,transaction){
  for(const name of ROUTINE_STORES){const store=getOrCreateStore(database,transaction,name);ensureIndex(store,'updated_at','updated_at');ensureIndex(store,'sync_status','sync_status');}
  ensureIndex(transaction.objectStore('routine_templates'),'stable_key','stable_key',{unique:true});
  ensureIndex(transaction.objectStore('routine_versions'),'routine_id','routine_id');
  ensureIndex(transaction.objectStore('routine_versions'),'routine_number',['routine_id','version_number'],{unique:true});
  ensureIndex(transaction.objectStore('routine_exercises'),'routine_version_id','routine_version_id');
  ensureIndex(transaction.objectStore('routine_exercises'),'version_position',['routine_version_id','position'],{unique:true});
  for(const name of SIGNAL_STORES){const store=getOrCreateStore(database,transaction,name);ensureIndex(store,'local_date','local_date',{unique:name==='daily_readiness'});ensureIndex(store,'updated_at','updated_at');ensureIndex(store,'sync_status','sync_status');if(name==='match_reviews')ensureIndex(store,'football_session_id','football_session_id');}
  const sessions=getOrCreateStore(database,transaction,'workout_sessions');
  ensureIndex(sessions,'session_date','session_date');
  ensureIndex(sessions,'status','status');
  ensureIndex(sessions,'sync_status','sync_status');
  ensureIndex(sessions,'updated_at','updated_at');
  ensureIndex(sessions,'routine_id','routine_id');

  const exercises=getOrCreateStore(database,transaction,'session_exercises');
  ensureIndex(exercises,'session_id','session_id');
  ensureIndex(exercises,'exercise_catalog_id','exercise_catalog_id');
  ensureIndex(exercises,'exercise_key','exercise_key');

  const sets=getOrCreateStore(database,transaction,'exercise_sets');
  ensureIndex(sets,'session_exercise_id','session_exercise_id');

  const catalog=getOrCreateStore(database,transaction,'exercise_catalog');
  ensureIndex(catalog,'stable_key','stable_key',{unique:true});

  const operations=getOrCreateStore(database,transaction,INTERNAL_STORES.operations,{keyPath:'operation_id'});
  ensureIndex(operations,'status','status');
  ensureIndex(operations,'entity_record',['entity','record_id']);
  ensureIndex(operations,'created_at','created_at');
  ensureIndex(operations,'sequence','sequence',{unique:true});

  getOrCreateStore(database,transaction,INTERNAL_STORES.migrations,{keyPath:'source_key'});

  getOrCreateStore(database,transaction,INTERNAL_STORES.metadata,{keyPath:'key'});
  const conflicts=getOrCreateStore(database,transaction,INTERNAL_STORES.conflicts,{keyPath:'conflict_id'});
  ensureIndex(conflicts,'entity_record',['entity','record_id'],{unique:true});
  ensureIndex(conflicts,'status','status');
  getOrCreateStore(database,transaction,INTERNAL_STORES.leases,{keyPath:'name'});

  // Future upgrades need existing stores from the upgrade transaction.
  for(const name of ENTITY_STORES){
    if(!database.objectStoreNames.contains(name))throw new Error(`Missing IndexedDB store ${name}`);
    transaction.objectStore(name);
  }
}

export async function openUserDatabase({userId,indexedDB=globalThis.indexedDB}={}){
  if(!indexedDB)throw new Error('IndexedDB is unavailable.');
  const name=databaseNameForUser(userId),request=indexedDB.open(name,DB_VERSION);
  request.onupgradeneeded=()=>upgrade(request.result,request.transaction);
  const database=await requestResult(request);
  database.onversionchange=()=>database.close();
  return database;
}

export function deleteUserDatabase({userId,indexedDB=globalThis.indexedDB}={}){
  return requestResult(indexedDB.deleteDatabase(databaseNameForUser(userId)));
}
