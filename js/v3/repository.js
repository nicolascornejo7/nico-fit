import {ENTITY_STORES,INTERNAL_STORES,openUserDatabase,requestResult,transactionDone} from './indexed-db.js';
import {isV3LocalStorageEnabled} from './feature-flags.js';

export const OPERATION_STATES=Object.freeze(['pending','syncing','synced','conflict','failed']);
export const MUTATION_TYPES=Object.freeze(['insert','update','soft_delete']);
const UNRESOLVED_OPERATION_STATES=new Set(['pending','syncing','conflict','failed']);

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

  async listRecords(entity,{includeDeleted=false}={}){
    assertEntity(entity);
    const rows=await requestResult(this.database.transaction(entity).objectStore(entity).getAll());
    return rows.filter(row=>row.owner_id===this.userId&&(includeDeleted||!row.deleted_at)).map(clone);
  }

  async getTrainingState(){
    const entry=await requestResult(this.database.transaction(INTERNAL_STORES.metadata).objectStore(INTERNAL_STORES.metadata).get('training:state'));
    return entry?.value?clone(entry.value):null;
  }

  // Entity graph, outbox and local UI checkpoint commit atomically.
  async commitLocalChanges(changes=[],{trainingState,guards=[]}={}){
    const prepared=changes.map(change=>({...change,id:change.id||change.payload?.id||uuid(this.crypto),operationId:change.operationId||uuid(this.crypto)}));
    return runTransaction(this.database,[...ENTITY_STORES,INTERNAL_STORES.operations,INTERNAL_STORES.metadata,INTERNAL_STORES.conflicts],'readwrite',async transaction=>{
      const operations=transaction.objectStore(INTERNAL_STORES.operations),conflicts=transaction.objectStore(INTERNAL_STORES.conflicts),results=[];
      for(const guard of guards){
        assertEntity(guard.entity);
        const current=assertOwned(await requestResult(transaction.objectStore(guard.entity).get(guard.id)),this.userId);
        if(!current||current.deleted_at||current.local_revision!==guard.expectedLocalRevision||(guard.status&&current.status!==guard.status))throw new Error('Local revision conflict. Reload the session before editing.');
      }
      let sequence=await nextOperationSequence(operations);
      for(const change of prepared){
        const {entity,id,type}=change;assertEntity(entity);
        if(!MUTATION_TYPES.includes(type))throw new Error('Unsupported local mutation.');
        const store=transaction.objectStore(entity),current=assertOwned(await requestResult(store.get(id)),this.userId);
        if(await requestResult(operations.get(change.operationId))){results.push(current?clone(current):null);continue;}
        if(type==='insert'&&current){results.push(clone(current));continue;}
        if(type!=='insert'&&!current)throw new Error('Local record not found.');
        if(current?.deleted_at){if(type==='soft_delete'){results.push(clone(current));continue;}throw new Error('Soft-deleted V3 records are immutable.');}
        if(change.expectedLocalRevision!=null&&current?.local_revision!==change.expectedLocalRevision)throw new Error('Local revision conflict.');
        const timestamp=nowIso(),patch=clone(change.payload||{});
        for(const key of ['id','owner_id','created_at','version','remote_version','local_revision','sync_status','deleted_at'])delete patch[key];
        let record=type==='insert'?normalizeRecord(entity,change.payload||{},{userId:this.userId,id,timestamp}):{
          ...current,...patch,local_revision:current.local_revision+1,updated_at:timestamp,sync_status:'pending',
          deleted_at:type==='soft_delete'?timestamp:current.deleted_at
        };
        await this.#assertParent(transaction,entity,record);
        const parentEntity=entity==='session_exercises'?'workout_sessions':entity==='exercise_sets'?'session_exercises':null;
        const parentId=record.session_id||record.session_exercise_id;
        const parent=parentEntity?await requestResult(transaction.objectStore(parentEntity).get(parentId)):null;
        if(parent?.deleted_at)throw new Error('Parent entity was deleted.');
        const existingConflict=await requestResult(conflicts.get(`${entity}:${id}`));
        const catalog=entity==='session_exercises'&&record.exercise_catalog_id?await requestResult(transaction.objectStore('exercise_catalog').get(record.exercise_catalog_id)):null;
        if(catalog?.deleted_at&&type!=='soft_delete')throw new Error('Catalog exercise was deleted.');
        const blocked=current?.sync_status==='conflict'||parent?.sync_status==='conflict'||catalog?.sync_status==='conflict'||existingConflict?.status==='open';
        if(blocked)record.sync_status='conflict';
        await requestResult(store.put(record));
        const mutation=type==='insert'?'insert':await mutationType(operations,entity,id,current.remote_version,type);
        const operation=operationRecord({operationId:change.operationId,userId:this.userId,entity,record,type:mutation,baseRemoteVersion:current?.remote_version,sequence:sequence++,timestamp});
        if(change.preserveTransition)operation.preserve_transition=true;
        if(blocked)operation.status='conflict';
        await requestResult(operations.add(operation));
        if(existingConflict){existingConflict.local_payload=clone(record);existingConflict.operation_ids.push(operation.operation_id);existingConflict.updated_at=timestamp;await requestResult(conflicts.put(existingConflict));}
        results.push(clone(record));
      }
      const affected=new Map();
      for(const record of results.filter(Boolean)){
        const entity=prepared.find(change=>change.id===record.id)?.entity;
        if(entity==='session_exercises')affected.set(`${entity}:${record.session_id}`,{entity,parentId:record.session_id,index:'session_id'});
        if(entity==='exercise_sets')affected.set(`${entity}:${record.session_exercise_id}`,{entity,parentId:record.session_exercise_id,index:'session_exercise_id'});
      }
      for(const {entity,parentId,index} of affected.values()){
        const rows=(await requestResult(transaction.objectStore(entity).index(index).getAll(parentId))).filter(row=>!row.deleted_at),positions=new Set();
        for(const row of rows){
          if(!Number.isInteger(row.position)||row.position<0||row.position>2147483647||positions.has(row.position))throw new Error('Local position conflict. Reload before adding or reordering.');
          positions.add(row.position);
        }
      }
      if(trainingState!==undefined)await requestResult(transaction.objectStore(INTERNAL_STORES.metadata).put({key:'training:state',owner_id:this.userId,value:clone(trainingState),updated_at:nowIso()}));
      return results;
    });
  }

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

  async claimPendingOperations(limit=25,{now=Date.now()}={}){
    return runTransaction(this.database,[INTERNAL_STORES.operations,...ENTITY_STORES],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.operations);
      const pending=(await requestResult(store.index('status').getAll('pending'))).filter(row=>
        row.owner_id===this.userId&&(!row.next_attempt_at||Date.parse(row.next_attempt_at)<=now)
      )
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

  async setOperationStatus(operationId,status,{error=null,remoteVersion,nextAttemptAt=null}={}){
    if(!OPERATION_STATES.includes(status))throw new Error(`Unsupported operation status: ${status}`);
    return runTransaction(this.database,[INTERNAL_STORES.operations,...ENTITY_STORES],'readwrite',async transaction=>{
      const operationStore=transaction.objectStore(INTERNAL_STORES.operations);
      const operation=assertOwned(await requestResult(operationStore.get(operationId)),this.userId);
      if(!operation)throw new Error('Operation not found.');
      operation.status=status;operation.last_error=error?String(error):null;operation.updated_at=nowIso();
      operation.next_attempt_at=nextAttemptAt;
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

  async requeueDueFailed({now=Date.now(),maxAttempts=5}={}){
    return runTransaction(this.database,[INTERNAL_STORES.operations,...ENTITY_STORES],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.operations);
      const failed=(await requestResult(store.index('status').getAll('failed'))).filter(operation=>
        operation.owner_id===this.userId&&operation.attempts<maxAttempts&&operation.next_attempt_at&&Date.parse(operation.next_attempt_at)<=now
      );
      const timestamp=nowIso();
      for(const operation of failed){
        operation.status='pending';operation.updated_at=timestamp;operation.next_attempt_at=null;
        await requestResult(store.put(operation));
        const entityStore=transaction.objectStore(operation.entity),record=await requestResult(entityStore.get(operation.record_id));
        if(record){record.sync_status='pending';record.updated_at=timestamp;await requestResult(entityStore.put(record));}
      }
      return failed.length;
    });
  }

  async unresolvedOperations(entity,recordId){
    assertEntity(entity);
    const store=this.database.transaction(INTERNAL_STORES.operations).objectStore(INTERNAL_STORES.operations);
    const rows=await requestResult(store.index('entity_record').getAll([entity,recordId]));
    return rows.filter(row=>row.owner_id===this.userId&&UNRESOLVED_OPERATION_STATES.has(row.status))
      .sort((a,b)=>a.sequence-b.sequence).map(clone);
  }

  async acknowledgeOperations(operationIds,{remoteRecord}={}){
    if(!operationIds.length)throw new Error('At least one operation is required.');
    return runTransaction(this.database,[INTERNAL_STORES.operations,...ENTITY_STORES],'readwrite',async transaction=>{
      const operationStore=transaction.objectStore(INTERNAL_STORES.operations),timestamp=nowIso(),operations=[];
      for(const operationId of operationIds){
        const operation=assertOwned(await requestResult(operationStore.get(operationId)),this.userId);
        if(!operation)throw new Error(`Operation not found: ${operationId}`);
        operations.push(operation);
      }
      const {entity,record_id:recordId}=operations[0];
      if(operations.some(item=>item.entity!==entity||item.record_id!==recordId))throw new Error('Acknowledged operations must target one record.');
      for(const operation of operations){
        operation.status='synced';operation.last_error=null;operation.next_attempt_at=null;operation.updated_at=timestamp;
        await requestResult(operationStore.put(operation));
      }
      const related=await requestResult(operationStore.index('entity_record').getAll([entity,recordId]));
      const acknowledged=new Set(operationIds),remaining=related.filter(item=>!acknowledged.has(item.operation_id)&&UNRESOLVED_OPERATION_STATES.has(item.status))
        .sort((a,b)=>a.sequence-b.sequence);
      const entityStore=transaction.objectStore(entity),current=await requestResult(entityStore.get(recordId));
      const remoteVersion=remoteRecord?.version??current?.remote_version??null;
      if(remaining.length){
        for(const operation of remaining){
          if(operation.type!=='insert')operation.base_remote_version=remoteVersion;
          await requestResult(operationStore.put(operation));
        }
        if(current){current.remote_version=remoteVersion;current.sync_status=remaining.at(-1).status;current.updated_at=timestamp;await requestResult(entityStore.put(current));}
        return current?clone(current):null;
      }
      if(remoteRecord){
        const record={...clone(remoteRecord),owner_id:this.userId,remote_version:remoteRecord.version,local_revision:current?.local_revision||1,sync_status:'synced'};
        delete record.version;
        await requestResult(entityStore.put(record));
        return clone(record);
      }
      if(current){current.remote_version=remoteVersion;current.sync_status='synced';current.updated_at=timestamp;await requestResult(entityStore.put(current));}
      return current?clone(current):null;
    });
  }

  async applyRemoteRecord(entity,remoteRecord){
    assertEntity(entity);
    if(!remoteRecord?.id||remoteRecord.version==null)throw new Error('Remote V3 record requires id and version.');
    return runTransaction(this.database,[entity,INTERNAL_STORES.operations],'readwrite',async transaction=>{
      const operationStore=transaction.objectStore(INTERNAL_STORES.operations);
      const unresolved=(await requestResult(operationStore.index('entity_record').getAll([entity,remoteRecord.id])))
        .filter(item=>item.owner_id===this.userId&&UNRESOLVED_OPERATION_STATES.has(item.status));
      if(unresolved.length)return {applied:false,unresolved:unresolved.sort((a,b)=>a.sequence-b.sequence).map(clone)};
      const entityStore=transaction.objectStore(entity),current=await requestResult(entityStore.get(remoteRecord.id));
      if(current?.remote_version!=null&&current.remote_version>remoteRecord.version)return {applied:false,stale:true,unresolved:[]};
      const record={...clone(remoteRecord),owner_id:this.userId,remote_version:remoteRecord.version,local_revision:current?.local_revision||1,sync_status:'synced'};
      delete record.version;
      await requestResult(entityStore.put(record));
      return {applied:true,record:clone(record),unresolved:[]};
    });
  }

  async recordConflict({entity,recordId,operationIds=[],reason,localPayload=null,remotePayload=null,error=null}){
    assertEntity(entity);
    const conflictId=`${entity}:${recordId}`;
    return runTransaction(this.database,[entity,INTERNAL_STORES.operations,INTERNAL_STORES.conflicts],'readwrite',async transaction=>{
      const conflictStore=transaction.objectStore(INTERNAL_STORES.conflicts),operationStore=transaction.objectStore(INTERNAL_STORES.operations);
      const existing=await requestResult(conflictStore.get(conflictId)),timestamp=nowIso();
      const conflict={
        conflict_id:conflictId,owner_id:this.userId,entity,record_id:recordId,status:'open',reason,
        operation_ids:[...new Set([...(existing?.operation_ids||[]),...operationIds])],
        local_payload:clone(localPayload),remote_payload:clone(remotePayload),error:error?clone(error):null,
        created_at:existing?.created_at||timestamp,updated_at:timestamp
      };
      await requestResult(conflictStore.put(conflict));
      for(const operationId of operationIds){
        const operation=await requestResult(operationStore.get(operationId));
        if(operation&&operation.owner_id===this.userId){operation.status='conflict';operation.last_error=reason;operation.next_attempt_at=null;operation.updated_at=timestamp;await requestResult(operationStore.put(operation));}
      }
      const entityStore=transaction.objectStore(entity),record=await requestResult(entityStore.get(recordId));
      if(record){record.sync_status='conflict';record.updated_at=timestamp;await requestResult(entityStore.put(record));}
      return clone(conflict);
    });
  }

  async listConflicts({status='open'}={}){
    const store=this.database.transaction(INTERNAL_STORES.conflicts).objectStore(INTERNAL_STORES.conflicts);
    const rows=status?await requestResult(store.index('status').getAll(status)):await requestResult(store.getAll());
    return rows.filter(row=>row.owner_id===this.userId).sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(clone);
  }

  async getSyncCheckpoint(entity){
    assertEntity(entity);
    const value=await requestResult(this.database.transaction(INTERNAL_STORES.metadata).objectStore(INTERNAL_STORES.metadata).get(`checkpoint:${entity}`));
    return value?.value?clone(value.value):null;
  }

  async setSyncCheckpoint(entity,value){
    assertEntity(entity);
    return runTransaction(this.database,[INTERNAL_STORES.metadata],'readwrite',async transaction=>{
      const entry={key:`checkpoint:${entity}`,owner_id:this.userId,value:clone(value),updated_at:nowIso()};
      await requestResult(transaction.objectStore(INTERNAL_STORES.metadata).put(entry));return clone(entry.value);
    });
  }

  async acquireLease(name,ownerToken,{ttlMs=30000,now=Date.now()}={}){
    return runTransaction(this.database,[INTERNAL_STORES.leases],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.leases),current=await requestResult(store.get(name));
      if(current&&current.owner_token!==ownerToken&&current.expires_at>now)return false;
      await requestResult(store.put({name,owner_id:this.userId,owner_token:ownerToken,acquired_at:current?.owner_token===ownerToken?current.acquired_at:now,expires_at:now+ttlMs}));
      return true;
    });
  }

  async renewLease(name,ownerToken,{ttlMs=30000,now=Date.now()}={}){
    return runTransaction(this.database,[INTERNAL_STORES.leases],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.leases),current=await requestResult(store.get(name));
      if(!current||current.owner_token!==ownerToken||current.expires_at<=now)return false;
      current.expires_at=now+ttlMs;await requestResult(store.put(current));return true;
    });
  }

  async releaseLease(name,ownerToken){
    return runTransaction(this.database,[INTERNAL_STORES.leases],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.leases),current=await requestResult(store.get(name));
      if(!current||current.owner_token!==ownerToken)return false;
      await requestResult(store.delete(name));return true;
    });
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
