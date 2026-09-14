import {ENTITY_STORES} from './indexed-db.js';
import {isV3SyncEnabled} from './feature-flags.js';
import {withV3SyncLock} from './sync-lock.js';
import {classifySyncError,compactOperations,remoteConfirmsOperation,retryDelayMs} from './sync-protocol.js';

const PULL_ORDER=['exercise_catalog','workout_sessions','session_exercises','exercise_sets'];

function effectiveOperation(group){
  return {
    ...group.operations[0],type:group.type,payload:structuredClone(group.payload),
    base_remote_version:group.baseRemoteVersion,record_id:group.recordId
  };
}

function errorSnapshot(error){
  return {name:error?.name||'Error',message:error?.message||String(error),code:error?.code||null,status:error?.status||error?.statusCode||null};
}

export class V3SyncEngine{
  constructor({repository,remote,flagStorage=globalThis.localStorage,featureEnabled,locks=globalThis.navigator?.locks,now=Date.now,random=Math.random,pageSize=100,batchSize=50,maxAttempts=5,leaseTtlMs=30000}={}){
    if(!repository||!remote)throw new Error('V3 sync requires a local repository and remote adapter.');
    this.repository=repository;this.remote=remote;this.flagStorage=flagStorage;this.featureEnabled=featureEnabled;
    this.locks=locks;this.now=now;this.random=random;this.pageSize=pageSize;this.batchSize=batchSize;
    this.maxAttempts=maxAttempts;this.leaseTtlMs=leaseTtlMs;
  }

  async syncOnce(){
    const enabled=this.featureEnabled??isV3SyncEnabled(this.flagStorage);
    if(!enabled)return {skipped:'disabled'};
    const remoteUserId=await this.remote.authenticatedUserId();
    if(remoteUserId!==this.repository.userId)throw new Error('Authenticated Supabase user does not match the local V3 repository.');
    return withV3SyncLock({
      repository:this.repository,userId:remoteUserId,locks:this.locks,ttlMs:this.leaseTtlMs,
      task:()=>this.#runLocked()
    });
  }

  async #runLocked(){
    const result={pulled:0,pushed:0,conflicts:0,failed:0,recovered:0,requeued:0};
    result.recovered=await this.repository.recoverInterruptedOperations();
    result.requeued=await this.repository.requeueDueFailed({now:this.now(),maxAttempts:this.maxAttempts});
    await this.#pull(result);
    await this.#push(result);
    return result;
  }

  async #pull(result){
    for(const entity of PULL_ORDER){
      if(!ENTITY_STORES.includes(entity))continue;
      let cursor=await this.repository.getSyncCheckpoint(entity);
      while(true){
        const rows=await this.remote.fetchChanges(entity,{cursor,pageSize:this.pageSize});
        if(!rows.length)break;
        const ordered=[...rows].sort((a,b)=>a.updated_at.localeCompare(b.updated_at)||a.id.localeCompare(b.id));
        const applyOrder=[...ordered].sort((a,b)=>Number(Boolean(b.deleted_at))-Number(Boolean(a.deleted_at)));
        for(const remoteRecord of applyOrder){
          this.#assertRemoteOwner(entity,remoteRecord);
          const unresolved=await this.repository.unresolvedOperations(entity,remoteRecord.id);
          if(unresolved.length){
            const groups=compactOperations(unresolved),last=groups.at(-1),effective=effectiveOperation(last);
            if(groups.length===1&&remoteConfirmsOperation(effective,remoteRecord,this.repository.userId)){
              await this.repository.acknowledgeOperations(last.operationIds,{remoteRecord});result.pushed+=1;
            }else if(!remoteRecord.deleted_at&&unresolved.every(item=>item.type!=='insert'&&item.base_remote_version===remoteRecord.version)){
              // The pull returned the exact server base on which these offline edits were made.
              // Keep the local draft and let the queued mutation advance version by one.
            }else{
              await this.repository.recordConflict({
                entity,recordId:remoteRecord.id,operationIds:unresolved.map(item=>item.operation_id),
                reason:remoteRecord.deleted_at?'remote_tombstone_vs_local_change':'remote_change_vs_local_change',
                localPayload:unresolved.at(-1).payload,remotePayload:remoteRecord
              });
              result.conflicts+=1;
            }
          }else{
            const applied=await this.repository.applyRemoteRecord(entity,remoteRecord);
            if(applied.applied)result.pulled+=1;
          }
        }
        const last=ordered.at(-1);cursor={updatedAt:last.updated_at,id:last.id};
        await this.repository.setSyncCheckpoint(entity,cursor);
        if(rows.length<this.pageSize)break;
      }
    }
  }

  async #push(result){
    const claimed=await this.repository.claimPendingOperations(this.batchSize,{now:this.now()});
    for(const group of compactOperations(claimed)){
      const operation=effectiveOperation(group);
      try{
        const remoteRecord=await this.remote.mutate(operation,this.repository.userId);
        this.#assertRemoteOwner(operation.entity,remoteRecord);
        await this.repository.acknowledgeOperations(group.operationIds,{remoteRecord});result.pushed+=1;
      }catch(error){
        const kind=classifySyncError(error);
        if(kind!=='auth'&&kind!=='transient'){
          const existing=await this.remote.fetchById(operation.entity,operation.record_id).catch(()=>null);
          if(existing&&remoteConfirmsOperation(operation,existing,this.repository.userId)){
            await this.repository.acknowledgeOperations(group.operationIds,{remoteRecord:existing});result.pushed+=1;continue;
          }
          if(kind==='conflict'){
            await this.repository.recordConflict({
              entity:operation.entity,recordId:operation.record_id,operationIds:group.operationIds,
              reason:'remote_version_conflict',localPayload:operation.payload,remotePayload:existing,error:errorSnapshot(error)
            });
            result.conflicts+=1;continue;
          }
        }
        const transient=kind==='transient',attempt=Math.max(...group.operations.map(item=>item.attempts));
        const retryAt=transient&&attempt<this.maxAttempts?new Date(this.now()+retryDelayMs(attempt,{random:this.random})).toISOString():null;
        for(const operationId of group.operationIds){
          await this.repository.setOperationStatus(operationId,'failed',{error:error.message||String(error),nextAttemptAt:retryAt});
        }
        result.failed+=group.operationIds.length;
        if(kind==='auth')break;
      }
    }
  }

  #assertRemoteOwner(entity,record){
    if(entity==='workout_sessions'&&record.user_id!==this.repository.userId)throw new Error('Remote workout session belongs to another user.');
    if(entity==='exercise_catalog'&&record.owner_user_id!=null&&record.owner_user_id!==this.repository.userId)throw new Error('Remote exercise catalog row belongs to another user.');
  }
}
