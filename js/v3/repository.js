import {ENTITY_STORES,INTERNAL_STORES,openUserDatabase,requestResult,transactionDone} from './indexed-db.js';
import {isV3LocalStorageEnabled} from './feature-flags.js';

export const OPERATION_STATES=Object.freeze(['pending','syncing','synced','conflict','failed']);
export const MUTATION_TYPES=Object.freeze(['insert','update','soft_delete']);

const nowIso=()=>new Date().toISOString();
const uuid=cryptoImpl=>cryptoImpl.randomUUID();
const clone=value=>structuredClone(value);

function assertEntity(entity){
  if(!ENTITY_STORES.includes(entity))throw new Error(`Unsupported V3 entity: ${entity}`);
}

function assertOwned(record,userId){
  if(record&&record.owner_id!==userId)throw new Error('V3 record belongs to another user.');
  return record;
}

function normalizeRecord(entity,payload,{userId,id,syncStatus='pending',timestamp=nowIso()}={}){
  const record={...clone(payload),id,owner_id:userId};
  record.created_at=record.created_at||timestamp;
  record.updated_at=timestamp;
  record.deleted_at=record.deleted_at??null;
  record.remote_version=record.remote_version??record.version??null;
  delete record.version;
  record.local_revision=Number.isInteger(record.local_revision)&&record.local_revision>0?record.local_revision:1;
  record.sync_status=syncStatus;
  if(entity==='workout_sessions'){
    if(!record.session_date)throw new Error('workout_sessions requires session_date.');
    record.status=record.status||'draft';
  }
  if(entity==='session_exercises'&&!record.session_id)throw new Error('session_exercises requires session_id.');
  if(entity==='exercise_sets'&&!record.session_exercise_id)throw new Error('exercise_sets requires session_exercise_id.');
  if(entity==='exercise_catalog'&&!String(record.stable_key||'').trim())throw new Error('exercise_catalog requires stable_key.');
  return record;
}

function operationRecord({operationId,userId,entity,record,type,baseRemoteVersion,sequence,timestamp=nowIso()}){
  return {
    operation_id:operationId,owner_id:userId,entity,record_id:record.id,type,
    status:'pending',base_remote_version:baseRemoteVersion??null,
    local_revision:record.local_revision,payload:clone(record),attempts:0,last_error:null,
    sequence,created_at:timestamp,updated_at:timestamp
  };
}

async function nextOperationSequence(store){
  const cursor=await requestResult(store.index('sequence').openCursor(null,'prev'));
  return (cursor?.key||0)+1;
}

async function mutationType(operationStore,entity,recordId,remoteVersion,fallback){
  if(remoteVersion!=null)return fallback;
  const related=await requestResult(operationStore.index('entity_record').getAll([entity,recordId]));
  return related.some(operation=>operation.type==='insert')?fallback:'insert';
}

function mutationStores(entity,enqueue=true){
  const stores=[entity];
  if(entity==='session_exercises')stores.push('workout_sessions');
  if(entity==='exercise_sets')stores.push('session_exercises');
  if(enqueue)stores.push(INTERNAL_STORES.operations);
  return stores;
}

async function runTransaction(database,stores,mode,callback){
  const transaction=database.transaction(stores,mode),completion=transactionDone(transaction);
  try{const result=await callback(transaction);await completion;return result;}
  catch(error){try{transaction.abort();}catch{}await completion.catch(()=>{});throw error;}
}

export class V3LocalRepository{
  static async open({userId,indexedDB=globalThis.indexedDB,flagStorage=globalThis.localStorage,featureEnabled}={}){
    const enabled=featureEnabled??isV3LocalStorageEnabled(flagStorage);
    if(!enabled)throw new Error('V3 local storage is disabled. Enable the explicit feature flag first.');
    const owner=String(userId||'').trim();
    const database=await openUserDatabase({userId:owner,indexedDB});
    const repository=new V3LocalRepository({userId:owner,database,cryptoImpl:globalThis.crypto});
    await repository.recoverInterruptedOperations();
    return repository;
  }

  constructor({userId,database,cryptoImpl=globalThis.crypto}){
    this.userId=userId;this.database=database;this.crypto=cryptoImpl;
  }

  close(){this.database.close();}

  async get(entity,id){
    assertEntity(entity);
    const record=await requestResult(this.database.transaction(entity).objectStore(entity).get(id));
    return record?clone(assertOwned(record,this.userId)):null;
  }

  async create(entity,payload={},options={}){
    assertEntity(entity);
    const id=String(options.id||payload.id||uuid(this.crypto));
    const operationId=String(options.operationId||uuid(this.crypto));
    const enqueue=options.enqueue!==false;
    const stores=mutationStores(entity,enqueue);
    return runTransaction(this.database,stores,'readwrite',async transaction=>{
      const entityStore=transaction.objectStore(entity);
      if(enqueue){
        const priorOperation=await requestResult(transaction.objectStore(INTERNAL_STORES.operations).get(operationId));
        if(priorOperation)return clone(assertOwned(await requestResult(entityStore.get(priorOperation.record_id)),this.userId));
      }
      const existing=await requestResult(entityStore.get(id));
      if(existing)return clone(assertOwned(existing,this.userId));
      await this.#assertParent(transaction,entity,payload);
      const record=normalizeRecord(entity,payload,{userId:this.userId,id,syncStatus:options.syncStatus||'pending'});
      await requestResult(entityStore.add(record));
      if(enqueue){
        const operationStore=transaction.objectStore(INTERNAL_STORES.operations),sequence=await nextOperationSequence(operationStore);
        const operation=operationRecord({operationId,userId:this.userId,entity,record,type:'insert',baseRemoteVersion:null,sequence});
        await requestResult(operationStore.add(operation));
      }
      return clone(record);
    });
  }

  async update(entity,id,patch={},options={}){
    assertEntity(entity);
    const operationId=String(options.operationId||uuid(this.crypto));
    return runTransaction(this.database,mutationStores(entity),'readwrite',async transaction=>{
      const operationStore=transaction.objectStore(INTERNAL_STORES.operations);
      const priorOperation=await requestResult(operationStore.get(operationId));
      const entityStore=transaction.objectStore(entity);
      if(priorOperation)return clone(assertOwned(await requestResult(entityStore.get(id)),this.userId));
      const current=assertOwned(await requestResult(entityStore.get(id)),this.userId);
      if(!current)throw new Error(`${entity} record not found.`);
      if(current.deleted_at)throw new Error('Soft-deleted V3 records are immutable.');
      if(options.expectedLocalRevision!=null&&current.local_revision!==options.expectedLocalRevision)throw new Error('Local revision conflict.');
      const immutable=['id','owner_id','created_at','remote_version','version','local_revision','sync_status','deleted_at'];
      const safePatch={...clone(patch)};for(const key of immutable)delete safePatch[key];
      const timestamp=nowIso(),record={...current,...safePatch,updated_at:timestamp,local_revision:current.local_revision+1,sync_status:'pending'};
      await this.#assertParent(transaction,entity,record);
      await requestResult(entityStore.put(record));
      const sequence=await nextOperationSequence(operationStore),type=await mutationType(operationStore,entity,id,current.remote_version,'update');
      await requestResult(operationStore.add(operationRecord({operationId,userId:this.userId,entity,record,type,baseRemoteVersion:current.remote_version,sequence,timestamp})));
      return clone(record);
    });
  }

  async softDelete(entity,id,options={}){
    assertEntity(entity);
    const operationId=String(options.operationId||uuid(this.crypto));
    return runTransaction(this.database,[entity,INTERNAL_STORES.operations],'readwrite',async transaction=>{
      const operationStore=transaction.objectStore(INTERNAL_STORES.operations),entityStore=transaction.objectStore(entity);
      const priorOperation=await requestResult(operationStore.get(operationId));
      if(priorOperation)return clone(assertOwned(await requestResult(entityStore.get(id)),this.userId));
      const current=assertOwned(await requestResult(entityStore.get(id)),this.userId);
      if(!current)throw new Error(`${entity} record not found.`);
      if(current.deleted_at)return clone(current);
      const timestamp=nowIso(),record={...current,deleted_at:timestamp,updated_at:timestamp,local_revision:current.local_revision+1,sync_status:'pending'};
      await requestResult(entityStore.put(record));
      const sequence=await nextOperationSequence(operationStore),type=await mutationType(operationStore,entity,id,current.remote_version,'soft_delete');
      await requestResult(operationStore.add(operationRecord({operationId,userId:this.userId,entity,record,type,baseRemoteVersion:current.remote_version,sequence,timestamp})));
      return clone(record);
    });
  }

  async listSessions({date,status,syncStatus,exerciseId,includeDeleted=false}={}){
    const transaction=this.database.transaction(['workout_sessions','session_exercises'],'readonly');
    let sessions;
    if(date)sessions=await requestResult(transaction.objectStore('workout_sessions').index('session_date').getAll(date));
    else if(status)sessions=await requestResult(transaction.objectStore('workout_sessions').index('status').getAll(status));
    else sessions=await requestResult(transaction.objectStore('workout_sessions').getAll());
    if(date&&status)sessions=sessions.filter(session=>session.status===status);
    if(syncStatus)sessions=sessions.filter(session=>session.sync_status===syncStatus);
    if(exerciseId){
      const exerciseStore=transaction.objectStore('session_exercises');
      const [byCatalog,byKey]=await Promise.all([
        requestResult(exerciseStore.index('exercise_catalog_id').getAll(exerciseId)),
        requestResult(exerciseStore.index('exercise_key').getAll(exerciseId))
      ]);
      const sessionIds=new Set([...byCatalog,...byKey].filter(item=>includeDeleted||!item.deleted_at).map(item=>item.session_id));
      sessions=sessions.filter(session=>sessionIds.has(session.id));
    }
    return sessions.filter(session=>session.owner_id===this.userId&&(includeDeleted||!session.deleted_at))
      .sort((a,b)=>b.session_date.localeCompare(a.session_date)||b.created_at.localeCompare(a.created_at)).map(clone);
  }

  async listChildren(entity,parentId,{includeDeleted=false}={}){
    const indexName=entity==='session_exercises'?'session_id':entity==='exercise_sets'?'session_exercise_id':null;
    if(!indexName)throw new Error('listChildren supports session_exercises and exercise_sets.');
    const rows=await requestResult(this.database.transaction(entity).objectStore(entity).index(indexName).getAll(parentId));
    return rows.filter(row=>row.owner_id===this.userId&&(includeDeleted||!row.deleted_at)).sort((a,b)=>(a.position??0)-(b.position??0)).map(clone);
  }

  async listOperations({status,limit=Infinity}={}){
    const store=this.database.transaction(INTERNAL_STORES.operations).objectStore(INTERNAL_STORES.operations);
    const rows=status?await requestResult(store.index('status').getAll(status)):await requestResult(store.getAll());
    return rows.filter(row=>row.owner_id===this.userId).sort((a,b)=>a.sequence-b.sequence).slice(0,limit).map(clone);
  }

  async claimPendingOperations(limit=25){
    return runTransaction(this.database,[INTERNAL_STORES.operations,...ENTITY_STORES],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.operations);
      const pending=(await requestResult(store.index('status').getAll('pending'))).filter(row=>row.owner_id===this.userId)
        .sort((a,b)=>a.sequence-b.sequence).slice(0,limit);
      const timestamp=nowIso();
      for(const operation of pending){
        operation.status='syncing';operation.attempts+=1;operation.updated_at=timestamp;await requestResult(store.put(operation));
        const entityStore=transaction.objectStore(operation.entity),record=await requestResult(entityStore.get(operation.record_id));
        if(record){record.sync_status='syncing';record.updated_at=timestamp;await requestResult(entityStore.put(record));}
      }
      return pending.map(clone);
    });
  }

  async setOperationStatus(operationId,status,{error=null,remoteVersion}={}){
    if(!OPERATION_STATES.includes(status))throw new Error(`Unsupported operation status: ${status}`);
    return runTransaction(this.database,[INTERNAL_STORES.operations,...ENTITY_STORES],'readwrite',async transaction=>{
      const operationStore=transaction.objectStore(INTERNAL_STORES.operations);
      const operation=assertOwned(await requestResult(operationStore.get(operationId)),this.userId);
      if(!operation)throw new Error('Operation not found.');
      operation.status=status;operation.last_error=error?String(error):null;operation.updated_at=nowIso();
      await requestResult(operationStore.put(operation));
      const entityStore=transaction.objectStore(operation.entity),record=await requestResult(entityStore.get(operation.record_id));
      if(record){
        if(remoteVersion!=null)record.remote_version=remoteVersion;
        const related=await requestResult(operationStore.index('entity_record').getAll([operation.entity,operation.record_id]));
        const unresolved=related.filter(item=>item.operation_id!==operationId&&item.status!=='synced').sort((a,b)=>a.sequence-b.sequence);
        record.sync_status=unresolved.length?unresolved.at(-1).status:status;
        record.updated_at=nowIso();await requestResult(entityStore.put(record));
      }
      return clone(operation);
    });
  }

  async retryOperation(operationId){
    const operation=(await this.listOperations()).find(item=>item.operation_id===operationId);
    if(!operation)throw new Error('Operation not found.');
    if(!['failed','conflict'].includes(operation.status))return operation;
    return this.setOperationStatus(operationId,'pending');
  }

  async recoverInterruptedOperations(){
    return runTransaction(this.database,[INTERNAL_STORES.operations,...ENTITY_STORES],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.operations),rows=await requestResult(store.index('status').getAll('syncing'));
      const timestamp=nowIso();let recovered=0;
      for(const row of rows.filter(item=>item.owner_id===this.userId)){
        row.status='pending';row.last_error='Recovered after interrupted sync.';row.updated_at=timestamp;
        await requestResult(store.put(row));
        const entityStore=transaction.objectStore(row.entity),record=await requestResult(entityStore.get(row.record_id));
        if(record){record.sync_status='pending';record.updated_at=timestamp;await requestResult(entityStore.put(record));}
        recovered+=1;
      }
      return recovered;
    });
  }

  async importRecord(entity,{sourceKey,id,payload,status='pending_review',note=''}){
    assertEntity(entity);
    return runTransaction(this.database,[entity,INTERNAL_STORES.migrations],'readwrite',async transaction=>{
      const mappings=transaction.objectStore(INTERNAL_STORES.migrations),existingMap=await requestResult(mappings.get(sourceKey));
      if(existingMap){
        const record=await requestResult(transaction.objectStore(entity).get(existingMap.target_id));
        return {record:record?clone(assertOwned(record,this.userId)):null,mapping:clone(existingMap),created:false};
      }
      const record=normalizeRecord(entity,{...payload,migration_status:status,migration_note:note},{userId:this.userId,id,syncStatus:'conflict'});
      await requestResult(transaction.objectStore(entity).add(record));
      const mapping={source_key:sourceKey,owner_id:this.userId,entity,target_id:id,migration_status:status,migration_note:note,created_at:nowIso()};
      await requestResult(mappings.add(mapping));
      return {record:clone(record),mapping:clone(mapping),created:true};
    });
  }

  async listMigrationMappings(){
    const rows=await requestResult(this.database.transaction(INTERNAL_STORES.migrations).objectStore(INTERNAL_STORES.migrations).getAll());
    return rows.filter(row=>row.owner_id===this.userId).map(clone);
  }

  async #assertParent(transaction,entity,payload){
    if(entity==='session_exercises'){
      const sessionStore=transaction.objectStoreNames.contains('workout_sessions')?transaction.objectStore('workout_sessions'):null;
      const parent=sessionStore&&await requestResult(sessionStore.get(payload.session_id));
      if(!parent)throw new Error('Parent workout_session not found.');
      assertOwned(parent,this.userId);
    }
    if(entity==='exercise_sets'){
      const exerciseStore=transaction.objectStoreNames.contains('session_exercises')?transaction.objectStore('session_exercises'):null;
      const parent=exerciseStore&&await requestResult(exerciseStore.get(payload.session_exercise_id));
      if(!parent)throw new Error('Parent session_exercise not found.');
      assertOwned(parent,this.userId);
    }
  }

  async recordMigrationDecision({sourceKey,entity,status,note='',sourcePayload=null}){
    return runTransaction(this.database,[INTERNAL_STORES.migrations],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.migrations),existing=await requestResult(store.get(sourceKey));
      if(existing)return {...clone(existing),created:false};
      const mapping={source_key:sourceKey,owner_id:this.userId,entity,target_id:null,migration_status:status,migration_note:note,source_payload:clone(sourcePayload),created_at:nowIso()};
      await requestResult(store.add(mapping));return {...clone(mapping),created:true};
    });
  }
}
