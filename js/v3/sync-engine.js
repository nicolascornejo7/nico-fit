import {ENTITY_STORES,SIGNAL_STORES,ROUTINE_STORES} from './indexed-db.js';
import {isV3SyncEnabled,isV3SignalsSyncEnabled,isV3RoutinesSyncEnabled} from './feature-flags.js';
import {withV3SyncLock} from './sync-lock.js';
import {classifySyncError,compactOperations,remoteConfirmsOperation,retryDelayMs} from './sync-protocol.js';
import {safeDiagnosticError} from './diagnostic-model.js';
import {rolloutAllowsRemote,rolloutFlag} from './rollout-state.js';

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
  constructor({repository,remote,flagStorage=globalThis.localStorage,featureEnabled,signalsSyncEnabled,routinesSyncEnabled,locks=globalThis.navigator?.locks,now=Date.now,online=()=>globalThis.navigator?.onLine!==false,random=Math.random,pageSize=100,batchSize=50,maxAttempts=5,leaseTtlMs=30000}={}){
    if(!repository||!remote)throw new Error('V3 sync requires a local repository and remote adapter.');
    this.repository=repository;this.remote=remote;this.flagStorage=flagStorage;this.featureEnabled=featureEnabled;
    this.locks=locks;this.now=now;this.random=random;this.pageSize=pageSize;this.batchSize=batchSize;
    this.maxAttempts=maxAttempts;this.leaseTtlMs=leaseTtlMs;
    this.signalsSyncEnabled=signalsSyncEnabled;
    this.routinesSyncEnabled=routinesSyncEnabled;
    this.online=online;
  }

  async syncOnce(){
    const enabled=this.featureEnabled??isV3SyncEnabled(this.flagStorage);
    if(!enabled)return {skipped:'disabled'};
    if(!await rolloutAllowsRemote())return {skipped:'rollout_blocked'};
    const attemptId=globalThis.crypto.randomUUID(),stamp=()=>new Date(this.now()).toISOString();
    await this.#observe(attemptId,{startedAt:stamp(),status:'running',phase:'auth'});
    try{
      if(!this.online()){await this.#observe(attemptId,{status:'offline',phase:'offline',finishedAt:stamp()});return {skipped:'offline'};}
      const remoteUserId=await this.remote.authenticatedUserId();
      if(remoteUserId!==this.repository.userId)throw Object.assign(new Error('Authenticated Supabase user does not match the local V3 repository.'),{status:401});
      const result=await withV3SyncLock({repository:this.repository,userId:remoteUserId,locks:this.locks,ttlMs:this.leaseTtlMs,task:()=>this.#runLocked(attemptId)});
      await this.#observe(attemptId,{status:result.skipped==='locked'?'locked':result.failed?'failed':'completed',phase:result.skipped==='locked'?'locked':'finished',finishedAt:stamp(),result});
      return result;
    }catch(error){
      const snapshot=await this.repository.operationalSnapshot().catch(()=>({attempts:[]})),phase=snapshot.attempts.find(row=>row.attemptId===attemptId)?.phase||'auth';
      await this.#observe(attemptId,{status:'failed',phase,finishedAt:stamp(),error:safeDiagnosticError(error,classifySyncError(error),phase)});throw error;
    }
  }

  // Diagnostic writes are best effort; quota errors must not prevent domain sync.
  async #observe(attemptId,patch){try{await this.repository.recordSyncAttempt(attemptId,patch);}catch{}}

  async #runLocked(attemptId){
    const result={pulled:0,pushed:0,conflicts:0,failed:0,recovered:0,requeued:0};
    result.recovered=await this.repository.recoverInterruptedOperations();
    result.requeued=await this.repository.requeueDueFailed({now:this.now(),maxAttempts:this.maxAttempts});
    await this.#observe(attemptId,{phase:'pull'});if(!await this.#pull(result))return {...result,skipped:'rollout_blocked'};
    await this.#observe(attemptId,{phase:'push'});if(!await this.#push(result,attemptId))return {...result,skipped:'rollout_blocked'};
    return result;
  }

  async #pull(result){
    for(const entity of this.#entities()){
      if(!await rolloutAllowsRemote())return false;
      if(!ENTITY_STORES.includes(entity))continue;
      let cursor=await this.repository.getSyncCheckpoint(entity);
      while(true){
        if(!await rolloutAllowsRemote())return false;
        const rows=await this.remote.fetchChanges(entity,{cursor,pageSize:this.pageSize});
        if(!rows.length)break;
        const ordered=[...rows].sort((a,b)=>a.updated_at.localeCompare(b.updated_at)||a.id.localeCompare(b.id));
        const applyOrder=[...ordered].sort((a,b)=>Number(Boolean(b.deleted_at))-Number(Boolean(a.deleted_at)));
        for(const remoteRecord of applyOrder){
          this.#assertRemoteOwner(entity,remoteRecord);
          if(entity==='routine_versions'){
            const ordinalCollision=(await this.repository.listRecords('routine_versions',{includeDeleted:true})).find(local=>local.id!==remoteRecord.id&&local.routine_id===remoteRecord.routine_id&&local.version_number===remoteRecord.version_number);
            if(ordinalCollision){
              const operations=await this.repository.unresolvedOperations(entity,ordinalCollision.id);
              await this.repository.recordConflict({entity,recordId:ordinalCollision.id,operationIds:operations.map(item=>item.operation_id),reason:'routine_version_number_collision',localPayload:ordinalCollision,remotePayload:remoteRecord});
              result.conflicts+=1;
              continue;
            }
          }
          const unresolved=await this.repository.unresolvedOperations(entity,remoteRecord.id);
          if(unresolved.length){
            const groups=compactOperations(unresolved),last=groups.at(-1),effective=effectiveOperation(last);
            if(unresolved.some(item=>item.status==='conflict')){
              await this.repository.recordConflict({entity,recordId:remoteRecord.id,operationIds:unresolved.map(item=>item.operation_id),reason:'conflict_remote_refresh',localPayload:await this.repository.get(entity,remoteRecord.id),remotePayload:remoteRecord});
            }else if(groups.length===1&&remoteConfirmsOperation(effective,remoteRecord,this.repository.userId)){
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
    return true;
  }

  async #push(result,attemptId){
    if(!await rolloutAllowsRemote())return false;
    const claimed=await this.repository.claimPendingOperations(this.batchSize,{now:this.now(),entities:this.#entities(),routinesEnabled:this.#routinesEnabled()});
    for(const originalGroup of compactOperations(claimed)){
      if(!await rolloutAllowsRemote()){await this.repository.recoverInterruptedOperations();return false;}
      // A preceding insert/update may have advanced the base of later queued edits.
      // Use the persisted base, not the stale claim snapshot (important for reorders).
      const related=await this.repository.unresolvedOperations(originalGroup.entity,originalGroup.recordId);
      const operations=originalGroup.operationIds.map(id=>related.find(item=>item.operation_id===id)).filter(Boolean);
      if(!operations.length)continue;
      if(related.some(item=>item.sequence<operations[0].sequence&&['failed','conflict','pending'].includes(item.status))){
        for(const operation of operations)await this.repository.setOperationStatus(operation.operation_id,'pending');
        continue;
      }
      const group={...originalGroup,operations,payload:operations.at(-1).payload,baseRemoteVersion:operations[0].base_remote_version};
      const operation=effectiveOperation(group);
      try{
        const remoteRecord=await this.remote.mutate(operation,this.repository.userId);
        this.#assertRemoteOwner(operation.entity,remoteRecord);
        await this.repository.acknowledgeOperations(group.operationIds,{remoteRecord});result.pushed+=1;
      }catch(error){
        const kind=classifySyncError(error);
        await this.#observe(attemptId,{error:safeDiagnosticError(error,kind,'push')});
        if(kind!=='auth'&&kind!=='transient'){
          const existing=await this.remote.fetchById(operation.entity,operation.record_id).catch(()=>null);
          if(existing&&remoteConfirmsOperation(operation,existing,this.repository.userId)){
            await this.repository.acknowledgeOperations(group.operationIds,{remoteRecord:existing});result.pushed+=1;continue;
          }
          if(kind==='conflict'){
            await this.repository.recordConflict({
              entity:operation.entity,recordId:operation.record_id,operationIds:group.operationIds,
              reason:error.reason==='routine_version_number_collision'?'routine_version_number_collision':'remote_version_conflict',localPayload:operation.payload,remotePayload:existing,error:errorSnapshot(error)
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
    return true;
  }

  #assertRemoteOwner(entity,record){
    if(['workout_sessions',...SIGNAL_STORES,...ROUTINE_STORES].includes(entity)&&record.user_id!==this.repository.userId)throw new Error('Remote record belongs to another user.');
    if(entity==='exercise_catalog'&&record.owner_user_id!=null&&record.owner_user_id!==this.repository.userId)throw new Error('Remote exercise catalog row belongs to another user.');
  }
  #routinesEnabled(){return rolloutFlag('v3_routines_enabled')!==false&&(this.routinesSyncEnabled??isV3RoutinesSyncEnabled(this.flagStorage));}
  #signalsEnabled(){return rolloutFlag('v3_signals_enabled')!==false&&(this.signalsSyncEnabled??isV3SignalsSyncEnabled(this.flagStorage));}
  #entities(){return ['exercise_catalog',...(this.#routinesEnabled()?ROUTINE_STORES:[]),...PULL_ORDER.slice(1),...(this.#signalsEnabled()?SIGNAL_STORES:[])];}
}
