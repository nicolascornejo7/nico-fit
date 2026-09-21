import {ENTITY_STORES,INTERNAL_STORES,openUserDatabase,requestResult,transactionDone} from './indexed-db.js';
import {isV3LocalStorageEnabled} from './feature-flags.js';
import {withV3SyncLock} from './sync-lock.js';
import {summarizeOperations} from './diagnostic-model.js';
import {validateRoutineRecord,assertRoutineImmutable,sameRoutineValue} from './routine-validation.js';
import {rolloutBlocksNewWork} from './rollout-state.js';
const assertCurrentClient=()=>{if(rolloutBlocksNewWork())throw new Error('Actualización requerida: los cambios locales quedan conservados, pero esta versión no puede escribir más.');};

export const OPERATION_STATES=Object.freeze(['pending','syncing','synced','conflict','failed','superseded']);
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
  if(['workout_sessions','routine_templates','routine_versions','routine_exercises'].includes(entity))return [...ENTITY_STORES,...(enqueue?[INTERNAL_STORES.operations]:[])];
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
    await withV3SyncLock({repository,userId:owner,task:()=>repository.recoverInterruptedOperations()});
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
    if(changes.length)assertCurrentClient();
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
        if(current)assertRoutineImmutable(entity,current,record);
        await this.#assertParent(transaction,entity,record);
        const parentEntity=entity==='routine_versions'?'routine_templates':entity==='routine_exercises'?'routine_versions':entity==='session_exercises'?'workout_sessions':entity==='exercise_sets'?'session_exercises':entity==='match_reviews'&&record.football_session_id?'football_sessions':null;
        const parentId=record.routine_id||record.routine_version_id||record.session_id||record.session_exercise_id||record.football_session_id;
        const parent=parentEntity?await requestResult(transaction.objectStore(parentEntity).get(parentId)):null;
        if(parent?.deleted_at)throw new Error('Parent entity was deleted.');
        const existingConflict=await requestResult(conflicts.get(`${entity}:${id}`));
        const catalog=['session_exercises','routine_exercises'].includes(entity)&&record.exercise_catalog_id?await requestResult(transaction.objectStore('exercise_catalog').get(record.exercise_catalog_id)):null;
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
    assertCurrentClient();
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
      const record=normalizeRecord(entity,payload,{userId:this.userId,id,syncStatus:options.syncStatus||'pending'});
      await this.#assertParent(transaction,entity,record);
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
    assertCurrentClient();
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
      assertRoutineImmutable(entity,current,record);
      await this.#assertParent(transaction,entity,record);
      await requestResult(entityStore.put(record));
      const sequence=await nextOperationSequence(operationStore),type=await mutationType(operationStore,entity,id,current.remote_version,'update');
      await requestResult(operationStore.add(operationRecord({operationId,userId:this.userId,entity,record,type,baseRemoteVersion:current.remote_version,sequence,timestamp})));
      return clone(record);
    });
  }

  async softDelete(entity,id,options={}){
    assertCurrentClient();
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

  async recordSyncAttempt(attemptId,patch){
    return runTransaction(this.database,[INTERNAL_STORES.metadata],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.metadata),key=`diagnostic:attempt:${attemptId}`,existing=await requestResult(store.get(key));
      const value={...(existing?.value||{}),attemptId};
      if(!existing){const counter=await requestResult(store.get('diagnostic:sequence'));value.sequence=(counter?.value||0)+1;await requestResult(store.put({key:'diagnostic:sequence',owner_id:this.userId,value:value.sequence}));}
      for(const name of ['startedAt','finishedAt','status','phase','error','result'])if(Object.hasOwn(patch,name))value[name]=clone(patch[name]);
      await requestResult(store.put({key,owner_id:this.userId,value,updated_at:nowIso()}));
      for(const [durable,eligible] of [['last-success',value.status==='completed'],['last-error',!!value.error]])if(eligible){const previous=await requestResult(store.get(`diagnostic:${durable}`));if(!previous||previous.value.sequence<=value.sequence)await requestResult(store.put({key:`diagnostic:${durable}`,owner_id:this.userId,value:clone(value)}));}
      if(value.status==='failed')await requestResult(store.put({key:`audit:event:${attemptId}`,owner_id:this.userId,value:{event_id:attemptId,user_id:this.userId,event_type:'sync_failure',entity:null,entity_id:null,strategy:null,local_revision:null,local_remote_version:null,remote_version:null,occurred_at:value.finishedAt||value.startedAt,error_kind:value.error?.kind||'permanent',error_code:value.error?.code||null},updated_at:nowIso()}));
      const rows=(await requestResult(store.getAll())).filter(row=>row.key.startsWith('diagnostic:attempt:')).sort((a,b)=>b.value.sequence-a.value.sequence);
      for(const row of rows.slice(30))if(row.value.status!=='running')await requestResult(store.delete(row.key));
      return clone(value);
    });
  }

  async operationalSnapshot({now=Date.now(),maxAttempts=5}={}){
    return runTransaction(this.database,[INTERNAL_STORES.operations,INTERNAL_STORES.metadata,INTERNAL_STORES.leases],'readonly',async transaction=>{
      const operations=(await requestResult(transaction.objectStore(INTERNAL_STORES.operations).getAll())).filter(row=>row.owner_id===this.userId),metadata=(await requestResult(transaction.objectStore(INTERNAL_STORES.metadata).getAll())).filter(row=>row.owner_id===this.userId);
      const attempts=metadata.filter(row=>row.key.startsWith('diagnostic:attempt:')).map(row=>row.value).sort((a,b)=>b.sequence-a.sequence),checkpoints={};
      for(const row of metadata.filter(row=>row.key.startsWith('checkpoint:')))checkpoints[row.key.slice(11)]=clone(row.value);
      const lease=await requestResult(transaction.objectStore(INTERNAL_STORES.leases).get(`nico-fit-v3-sync:${this.userId}`));
      const lock=lease&&lease.owner_id===this.userId?{active:lease.expires_at>now,expired:lease.expires_at<=now,backend:lease.backend||'lease',acquiredAt:new Date(lease.acquired_at).toISOString(),expiresAt:new Date(lease.expires_at).toISOString()}: {active:false,expired:false,backend:null,acquiredAt:null,expiresAt:null};
      return {...summarizeOperations(operations,{now,maxAttempts}),attempts:clone(attempts),lastSuccess:clone(metadata.find(row=>row.key==='diagnostic:last-success')?.value||null),lastError:clone(metadata.find(row=>row.key==='diagnostic:last-error')?.value||null),checkpoints,lock};
    });
  }

  async auditEvents(){const rows=await requestResult(this.database.transaction(INTERNAL_STORES.metadata).objectStore(INTERNAL_STORES.metadata).getAll());return rows.filter(row=>row.owner_id===this.userId&&row.key.startsWith('audit:event:')).map(row=>clone(row.value));}
  async auditDelivery(eventId){return clone((await requestResult(this.database.transaction(INTERNAL_STORES.metadata).objectStore(INTERNAL_STORES.metadata).get(`audit:delivery:${eventId}`)))?.value||null);}
  async setAuditDelivery(eventId,value){return runTransaction(this.database,[INTERNAL_STORES.metadata],'readwrite',async transaction=>{await requestResult(transaction.objectStore(INTERNAL_STORES.metadata).put({key:`audit:delivery:${eventId}`,owner_id:this.userId,value:clone(value),updated_at:nowIso()}));});}

  async claimPendingOperations(limit=25,{now=Date.now(),entities=ENTITY_STORES,routinesEnabled=true}={}){
    return runTransaction(this.database,[INTERNAL_STORES.operations,...ENTITY_STORES],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.operations);
      let pending=(await requestResult(store.index('status').getAll('pending'))).filter(row=>
        row.owner_id===this.userId&&entities.includes(row.entity)&&(!row.next_attempt_at||Date.parse(row.next_attempt_at)<=now)
      )
        .sort((a,b)=>a.sequence-b.sequence);
      if(!routinesEnabled){const filtered=[];for(const row of pending){let session=row.entity==='workout_sessions'?row.payload:null;if(row.entity==='session_exercises')session=await requestResult(transaction.objectStore('workout_sessions').get(row.payload.session_id));if(row.entity==='exercise_sets'){const ex=await requestResult(transaction.objectStore('session_exercises').get(row.payload.session_exercise_id));if(ex)session=await requestResult(transaction.objectStore('workout_sessions').get(ex.session_id));}if(!session?.routine_id)filtered.push(row);}pending=filtered;}
      pending=pending.slice(0,limit);
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
        const unresolved=related.filter(item=>item.operation_id!==operationId&&UNRESOLVED_OPERATION_STATES.has(item.status)).sort((a,b)=>a.sequence-b.sequence);
        record.sync_status=unresolved.length?unresolved.at(-1).status:status;
        record.updated_at=nowIso();await requestResult(entityStore.put(record));
      }
      return clone(operation);
    });
  }

  async retryOperation(operationId){
    const operation=(await this.listOperations()).find(item=>item.operation_id===operationId);
    if(!operation)throw new Error('Operation not found.');
    if(operation.status==='conflict')throw new Error('Conflict requires an explicit resolution decision.');
    if(operation.status!=='failed')return operation;
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
    return runTransaction(this.database,[INTERNAL_STORES.operations,INTERNAL_STORES.metadata,INTERNAL_STORES.conflicts,...ENTITY_STORES],'readwrite',async transaction=>{
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
      for(const resolutionId of new Set(operations.map(row=>row.resolution_id).filter(Boolean))){
        const audits=transaction.objectStore(INTERNAL_STORES.metadata),entry=await requestResult(audits.get(`resolution:${resolutionId}`));
        if(!entry)continue;
        const statuses=await Promise.all(entry.value.operation_ids.map(id=>requestResult(operationStore.get(id))));
        if(!statuses.every(row=>row?.status==='synced'))continue;
        entry.value.confirmation='server_confirmed';entry.value.confirmed_at=timestamp;await requestResult(audits.put(entry));
        const conflicts=transaction.objectStore(INTERNAL_STORES.conflicts),conflict=await requestResult(conflicts.get(entry.value.conflict_id));
        if(conflict?.status==='resolution_pending'&&conflict.resolution_metadata?.decision_id===resolutionId){conflict.status='resolved';conflict.confirmed_at=timestamp;await requestResult(conflicts.put(conflict));}
      }
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
    return runTransaction(this.database,[entity,INTERNAL_STORES.operations,INTERNAL_STORES.conflicts],'readwrite',async transaction=>{
      const operationStore=transaction.objectStore(INTERNAL_STORES.operations);
      const unresolved=(await requestResult(operationStore.index('entity_record').getAll([entity,remoteRecord.id])))
        .filter(item=>item.owner_id===this.userId&&UNRESOLVED_OPERATION_STATES.has(item.status));
      if(unresolved.length)return {applied:false,unresolved:unresolved.sort((a,b)=>a.sequence-b.sequence).map(clone)};
      const conflictStore=transaction.objectStore(INTERNAL_STORES.conflicts),conflict=await requestResult(conflictStore.get(`${entity}:${remoteRecord.id}`));
      if(conflict?.status==='open'){conflict.remote_payload=clone(remoteRecord);conflict.updated_at=nowIso();await requestResult(conflictStore.put(conflict));return {applied:false,blocked:true,unresolved:[]};}
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
        created_at:existing?.created_at||timestamp,updated_at:timestamp,resolution_history:existing?.resolution_history||[]
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

  async resolveConflict({conflictId,strategy,expectedUpdatedAt,expectedRemoteVersion,expectedLocalRevision,metadata={}}){
    if(!['keep_local','accept_remote','keep_both','defer'].includes(strategy))throw new Error('Invalid conflict strategy.');
    return runTransaction(this.database,[...ENTITY_STORES,...Object.values(INTERNAL_STORES)],'readwrite',async transaction=>{
      const conflicts=transaction.objectStore(INTERNAL_STORES.conflicts),conflict=assertOwned(await requestResult(conflicts.get(conflictId)),this.userId);
      if(!conflict||conflict.status!=='open'||conflict.updated_at!==expectedUpdatedAt||(conflict.remote_payload?.version??null)!==expectedRemoteVersion)throw new Error('Conflict changed. Refresh before deciding.');
      const entity=conflict.entity;assertEntity(entity);const store=transaction.objectStore(entity),local=assertOwned(await requestResult(store.get(conflict.record_id)),this.userId),remote=clone(conflict.remote_payload);
      if(!local||local.local_revision!==expectedLocalRevision)throw new Error('Local revision changed. Refresh before deciding.');
      const timestamp=nowIso(),decisionId=uuid(this.crypto),operations=transaction.objectStore(INTERNAL_STORES.operations),auditStore=transaction.objectStore(INTERNAL_STORES.metadata);
      const audit={id:decisionId,owner_id:this.userId,entity,record_id:local.id,local_revision:local.local_revision,local_remote_version:local.remote_version,remote_version:remote?.version??null,conflict_id:conflictId,strategy,resolved_at:timestamp,metadata:clone(metadata),local_payload:clone(local),remote_payload:remote,operation_ids:[],confirmation:strategy==='defer'?'deferred':'local'};
      const persistAudit=async()=>{conflict.resolution_history=[...(conflict.resolution_history||[]),decisionId];conflict.updated_at=timestamp;await requestResult(auditStore.put({key:`resolution:${decisionId}`,owner_id:this.userId,value:audit,updated_at:timestamp}));await requestResult(conflicts.put(conflict));return clone(audit);};
      if(strategy==='defer'){conflict.deferred_at=timestamp;return persistAudit();}
      if(conflict.reason==='v2_source_changed'||local.migration_status==='pending_review')throw new Error('Review the changed import source separately before sync resolution.');
      if(!remote||remote.id!==local.id||!Number.isSafeInteger(remote.version)||remote.version<1)throw new Error('Remote snapshot required. Sync and refresh first.');
      if(['workout_sessions','daily_readiness','football_sessions','match_reviews','routine_templates','routine_versions','routine_exercises'].includes(entity)&&remote.user_id!==this.userId)throw new Error('Remote ownership mismatch.');
      if(entity==='exercise_catalog'&&remote.owner_user_id!==this.userId)throw new Error('Catalog ownership mismatch.');
      const related=await requestResult(operations.index('entity_record').getAll([entity,local.id]));if(related.some(row=>row.status==='syncing'))throw new Error('Operation in flight. Retry after sync.');
      const stateEntry=await requestResult(auditStore.get('training:state')),state=stateEntry?.value;
      let active=entity==='workout_sessions'?local.id:entity==='session_exercises'?local.session_id:null;
      if(entity==='exercise_sets')active=(await requestResult(transaction.objectStore('session_exercises').get(local.session_exercise_id)))?.session_id;
      if(entity==='exercise_catalog'&&state?.activeSessionId){const rows=await requestResult(transaction.objectStore('session_exercises').index('session_id').getAll(state.activeSessionId));if(rows.some(row=>row.exercise_catalog_id===local.id&&!row.deleted_at))active=state.activeSessionId;}
      if(state?.activeSessionId===active&&strategy!=='keep_local')throw new Error('Affected active session: finish locally or postpone before replacing its data.');
      if(remote.deleted_at&&strategy==='keep_local')throw new Error('Remote tombstone cannot be revived. Accept it or create a permitted separate occurrence.');
      if(strategy==='keep_both'&&(entity!=='football_sessions'||local.deleted_at||remote.deleted_at))throw new Error('Keeping both is not supported for this entity.');
      let candidate;
      if(strategy==='keep_local'||strategy==='keep_both'){
        candidate=clone(local);await this.#assertParent(transaction,entity,candidate);
        const parentEntity=entity==='exercise_sets'?'session_exercises':entity==='session_exercises'?'workout_sessions':entity==='match_reviews'&&candidate.football_session_id?'football_sessions':null;
        const parentId=candidate.session_exercise_id||candidate.session_id||candidate.football_session_id;
        if(parentEntity){const parent=assertOwned(await requestResult(transaction.objectStore(parentEntity).get(parentId)),this.userId);if(parent?.deleted_at||parent?.sync_status==='conflict')throw new Error('Resolve the parent conflict/deletion first.');}
        if(entity==='exercise_sets'){const exercise=await requestResult(transaction.objectStore('session_exercises').get(candidate.session_exercise_id)),session=assertOwned(await requestResult(transaction.objectStore('workout_sessions').get(exercise.session_id)),this.userId);if(!session||session.deleted_at||session.sync_status==='conflict')throw new Error('Resolve the session conflict/deletion first.');}
        if(entity==='session_exercises'&&candidate.exercise_catalog_id){const catalog=await requestResult(transaction.objectStore('exercise_catalog').get(candidate.exercise_catalog_id));if(!catalog||catalog.deleted_at||catalog.sync_status==='conflict')throw new Error('Resolve catalog conflict first.');}
      }
      if(strategy==='keep_both'){
        candidate.id=uuid(this.crypto);candidate.created_at=timestamp;candidate.remote_version=null;candidate.local_revision=1;candidate.deleted_at=null;
      }
      for(const operation of related.filter(row=>UNRESOLVED_OPERATION_STATES.has(row.status))){
        if(operation.resolution_id){
          const previous=await requestResult(auditStore.get(`resolution:${operation.resolution_id}`));
          if(previous){previous.value.confirmation='superseded';previous.value.superseded_by=decisionId;await requestResult(auditStore.put(previous));
            if(previous.value.conflict_id!==conflictId){const priorConflict=await requestResult(conflicts.get(previous.value.conflict_id));if(priorConflict?.status==='resolution_pending'){priorConflict.status='resolved';priorConflict.resolution_metadata={...priorConflict.resolution_metadata,superseded_by:decisionId,followup_conflict_id:conflictId};await requestResult(conflicts.put(priorConflict));}}
          }
        }
        operation.status='superseded';operation.archived_at=timestamp;operation.superseded_by=decisionId;operation.next_attempt_at=null;await requestResult(operations.put(operation));
      }
      if(strategy==='accept_remote'||strategy==='keep_both'){
        await this.#assertParent(transaction,entity,remote);
        if(remote.deleted_at&&['workout_sessions','session_exercises','football_sessions'].includes(entity)){
          const children=entity==='workout_sessions'?'session_exercises':entity==='session_exercises'?'exercise_sets':'match_reviews',foreignKey=entity==='workout_sessions'?'session_id':entity==='session_exercises'?'session_exercise_id':'football_session_id';
          const rows=await requestResult(transaction.objectStore(children).getAll());
          const childIds=new Set(rows.filter(row=>row[foreignKey]===local.id).map(row=>row.id));
          if(entity==='workout_sessions'){const sets=await requestResult(transaction.objectStore('exercise_sets').getAll());for(const row of sets)if(childIds.has(row.session_exercise_id))childIds.add(row.id);}
          const queued=await requestResult(operations.getAll());if(queued.some(row=>childIds.has(row.record_id)&&UNRESOLVED_OPERATION_STATES.has(row.status)))throw new Error('Review pending child changes before accepting parent deletion.');
        }
        if(entity==='session_exercises'||entity==='exercise_sets'){const index=entity==='exercise_sets'?'session_exercise_id':'session_id',parentId=remote[index];const rows=await requestResult(store.index(index).getAll(parentId));if(!remote.deleted_at&&rows.some(row=>row.id!==remote.id&&!row.deleted_at&&row.position===remote.position))throw new Error('Remote order collides locally. Resolve order first.');}
        const accepted={...remote,owner_id:this.userId,remote_version:remote.version,local_revision:local.local_revision+1,sync_status:'synced'};delete accepted.version;await requestResult(store.put(accepted));
      }
      if(candidate){
        if(strategy==='keep_local'){candidate.remote_version=remote.version;candidate.created_at=remote.created_at;candidate.local_revision=local.local_revision+1;}
        candidate.sync_status='pending';candidate.updated_at=timestamp;candidate.resolution_id=decisionId;delete candidate.version;
        const operation=operationRecord({operationId:uuid(this.crypto),userId:this.userId,entity,record:candidate,type:strategy==='keep_both'?'insert':candidate.deleted_at?'soft_delete':'update',baseRemoteVersion:strategy==='keep_both'?null:remote.version,sequence:await nextOperationSequence(operations),timestamp});operation.resolution_id=decisionId;operation.preserve_transition=true;
        await requestResult(store.put(candidate));await requestResult(operations.add(operation));audit.operation_ids.push(operation.operation_id);audit.target_id=candidate.id;audit.confirmation='pending_sync';
      }
      conflict.status=candidate?'resolution_pending':'resolved';conflict.resolved_at=timestamp;conflict.strategy=strategy;conflict.resolution_metadata={decision_id:decisionId,operation_ids:audit.operation_ids,target_id:audit.target_id??local.id};
      return persistAudit();
    });
  }

  async resolutionHistory(){const rows=await requestResult(this.database.transaction(INTERNAL_STORES.metadata).objectStore(INTERNAL_STORES.metadata).getAll());return rows.filter(row=>row.owner_id===this.userId&&row.key.startsWith('resolution:')).map(row=>clone(row.value));}

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

  async acquireLease(name,ownerToken,{ttlMs=30000,now=Date.now(),backend='lease'}={}){
    return runTransaction(this.database,[INTERNAL_STORES.leases],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.leases),current=await requestResult(store.get(name));
      if(current&&current.owner_token!==ownerToken&&current.expires_at>now)return false;
      await requestResult(store.put({name,owner_id:this.userId,owner_token:ownerToken,backend,acquired_at:current?.owner_token===ownerToken?current.acquired_at:now,expires_at:now+ttlMs}));
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

  async importRecord(entity,{sourceKey,id,payload,status='pending_review',note='',enqueue=false}){
    assertCurrentClient();
    assertEntity(entity);
    return runTransaction(this.database,[entity,INTERNAL_STORES.migrations,INTERNAL_STORES.operations],'readwrite',async transaction=>{
      const mappings=transaction.objectStore(INTERNAL_STORES.migrations),existingMap=await requestResult(mappings.get(sourceKey));
      if(existingMap){
        const record=await requestResult(transaction.objectStore(entity).get(existingMap.target_id));
        return {record:record?clone(assertOwned(record,this.userId)):null,mapping:clone(existingMap),created:false};
      }
      const record=normalizeRecord(entity,{...payload,migration_status:status,migration_note:note},{userId:this.userId,id,syncStatus:enqueue?'pending':'conflict'});
      await requestResult(transaction.objectStore(entity).add(record));
      if(enqueue){const operations=transaction.objectStore(INTERNAL_STORES.operations);await requestResult(operations.add(operationRecord({operationId:uuid(this.crypto),userId:this.userId,entity,record,type:'insert',baseRemoteVersion:null,sequence:await nextOperationSequence(operations)})));}
      const mapping={source_key:sourceKey,owner_id:this.userId,entity,target_id:id,migration_status:status,migration_note:note,source_payload:clone(payload.source_payload??payload),created_at:nowIso(),migrated_at:nowIso()};
      await requestResult(mappings.add(mapping));
      return {record:clone(record),mapping:clone(mapping),created:true};
    });
  }

  async listMigrationMappings(){
    const rows=await requestResult(this.database.transaction(INTERNAL_STORES.migrations).objectStore(INTERNAL_STORES.migrations).getAll());
    return rows.filter(row=>row.owner_id===this.userId).map(clone);
  }

  async markSignalImportChanged(sourceKey,sourcePayload){
    return runTransaction(this.database,[...ENTITY_STORES,INTERNAL_STORES.migrations,INTERNAL_STORES.operations,INTERNAL_STORES.conflicts],'readwrite',async transaction=>{
      const mappings=transaction.objectStore(INTERNAL_STORES.migrations),mapping=await requestResult(mappings.get(sourceKey));
      if(!mapping||mapping.migration_status==='pending_review')return false;
      const timestamp=nowIso();mapping.migration_status='pending_review';mapping.migration_note='V2 source changed after import; explicit review required.';mapping.latest_source_payload=clone(sourcePayload);mapping.updated_at=timestamp;await requestResult(mappings.put(mapping));
      if(mapping.target_id){
        const store=transaction.objectStore(mapping.entity),record=await requestResult(store.get(mapping.target_id));
        if(record){record.migration_status='pending_review';record.sync_status='conflict';record.updated_at=timestamp;await requestResult(store.put(record));
          const operations=transaction.objectStore(INTERNAL_STORES.operations),related=await requestResult(operations.index('entity_record').getAll([mapping.entity,record.id]));
          for(const operation of related.filter(row=>UNRESOLVED_OPERATION_STATES.has(row.status))){operation.status='conflict';operation.last_error=mapping.migration_note;await requestResult(operations.put(operation));}
          await requestResult(transaction.objectStore(INTERNAL_STORES.conflicts).put({conflict_id:`${mapping.entity}:${record.id}`,owner_id:this.userId,entity:mapping.entity,record_id:record.id,status:'open',reason:'v2_source_changed',operation_ids:related.filter(row=>UNRESOLVED_OPERATION_STATES.has(row.status)).map(row=>row.operation_id),local_payload:clone(record),remote_payload:null,source_payload:clone(sourcePayload),created_at:timestamp,updated_at:timestamp}));
        }
      }
      return true;
    });
  }

  async #assertParent(transaction,entity,payload){
    validateRoutineRecord(entity,payload);
    if(entity==='routine_versions'){
      const parent=assertOwned(await requestResult(transaction.objectStore('routine_templates').get(payload.routine_id)),this.userId);
      if(!parent||parent.deleted_at)throw new Error('Rutina padre no disponible.');
    }
    if(entity==='routine_exercises'){
      const parent=assertOwned(await requestResult(transaction.objectStore('routine_versions').get(payload.routine_version_id)),this.userId),catalog=assertOwned(await requestResult(transaction.objectStore('exercise_catalog').get(payload.exercise_catalog_id)),this.userId);
      const historical=parent?.prescription_snapshot.exercises.find(ex=>ex.id===payload.id);
      if(!parent||parent.deleted_at||!catalog||catalog.deleted_at||!historical||!['exercise_catalog_id','position','exercise_name_snapshot','prescription_snapshot'].every(key=>sameRoutineValue(historical[key],payload[key])))throw new Error('Ejercicio no coincide con snapshot de versión.');
    }
    if(entity==='workout_sessions'&&payload.routine_id){
      if(!payload.routine_snapshot||payload.routine_snapshot.routine_id!==payload.routine_id||payload.routine_snapshot.routine_version!==payload.routine_version||payload.routine_snapshot.routine_version_id!==payload.routine_version_id)throw new Error('Identidad histórica de sesión incompleta.');
      const existing=await requestResult(transaction.objectStore('workout_sessions').get(payload.id));
      if(!existing){const template=assertOwned(await requestResult(transaction.objectStore('routine_templates').get(payload.routine_id)),this.userId),version=assertOwned(await requestResult(transaction.objectStore('routine_versions').get(payload.routine_version_id)),this.userId);if(!template?.is_active||template.deleted_at||template.sync_status==='conflict'||!version||version.deleted_at||version.sync_status==='conflict'||version.version_number!==payload.routine_version||!sameRoutineValue(version.prescription_snapshot,payload.routine_snapshot))throw new Error('Rutina/version no disponible o snapshot histórico inconsistente.');}
    }
    if(entity==='match_reviews'&&payload.football_session_id){const parent=await requestResult(transaction.objectStore('football_sessions').get(payload.football_session_id));if(!parent)throw new Error('Parent football_session not found.');assertOwned(parent,this.userId);}
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

  async recordMigrationDecision({sourceKey,entity,status,note='',sourcePayload=null,targetId=null}){
    return runTransaction(this.database,[INTERNAL_STORES.migrations],'readwrite',async transaction=>{
      const store=transaction.objectStore(INTERNAL_STORES.migrations),existing=await requestResult(store.get(sourceKey));
      if(existing)return {...clone(existing),created:false};
      const mapping={source_key:sourceKey,owner_id:this.userId,entity,target_id:targetId,migration_status:status,migration_note:note,source_payload:clone(sourcePayload),created_at:nowIso(),migrated_at:nowIso()};
      await requestResult(store.add(mapping));return {...clone(mapping),created:true};
    });
  }
}
