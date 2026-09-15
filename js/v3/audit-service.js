import {isV3AuditEnabled} from './feature-flags.js';
import {V3ConflictService} from './conflict-service.js';
import {withV3SyncLock} from './sync-lock.js';
import {classifySyncError,retryDelayMs} from './sync-protocol.js';
import {safeDiagnosticError} from './diagnostic-model.js';

export function resolutionAuditEvent(decision,userId){return {event_id:decision.id,user_id:userId,event_type:'conflict_resolution',entity:decision.entity,entity_id:decision.record_id,strategy:decision.strategy,local_revision:decision.local_revision,local_remote_version:decision.local_remote_version??null,remote_version:decision.remote_version??null,occurred_at:decision.resolved_at,error_kind:null,error_code:null};}
export class V3AuditService{
  constructor({repository,remote,flagStorage=globalThis.localStorage,locks=globalThis.navigator?.locks,now=Date.now,maxAttempts=5,batchSize=25}){Object.assign(this,{repository,remote,flagStorage,locks,now,maxAttempts,batchSize});this.conflicts=new V3ConflictService({repository,locks});}
  async events(){return [...(await this.conflicts.history()).map(row=>resolutionAuditEvent(row,this.repository.userId)),...await this.repository.auditEvents()];}
  async snapshot(){const events=await this.events(),counts={pending:0,syncing:0,sent:0,failed:0};for(const event of events){const delivery=await this.repository.auditDelivery(event.event_id);counts[delivery?.status||'pending']++;}const state=await this.repository.auditDelivery('state');return {enabled:isV3AuditEnabled(this.flagStorage),configured:!!this.remote,counts,lastError:state?.error?safeDiagnosticError(state.error,state.error.kind,'push'):null,lastAttemptAt:state?.at||null};}
  async flush(){
    if(!isV3AuditEnabled(this.flagStorage))return {skipped:'disabled'};if(!this.remote)return {skipped:'unconfigured'};
    return withV3SyncLock({repository:this.repository,userId:this.repository.userId,locks:this.locks,task:async()=>{
      try{if(await this.remote.authenticatedUserId()!==this.repository.userId)throw Object.assign(new Error('Audit auth mismatch'),{status:401});}
      catch(error){await this.repository.setAuditDelivery('state',{at:new Date(this.now()).toISOString(),error:safeDiagnosticError(error,'auth','auth')});return {sent:0,failed:1};}
      let sent=0,failed=0,processed=0;
      for(const event of await this.events()){
        const delivery=await this.repository.auditDelivery(event.event_id);if(delivery?.status==='sent'||delivery?.attempts>=this.maxAttempts||delivery?.nextRetryAt&&Date.parse(delivery.nextRetryAt)>this.now())continue;
        if(delivery?.status==='failed'&&delivery.error?.kind==='permanent')continue;if(processed++>=this.batchSize)break;
        const attempts=(delivery?.attempts||0)+1;await this.repository.setAuditDelivery(event.event_id,{status:'syncing',attempts});
        try{await this.remote.append(event);await this.repository.setAuditDelivery(event.event_id,{status:'sent',attempts,confirmedAt:new Date(this.now()).toISOString()});sent++;}
        catch(error){const kind=classifySyncError(error),safe=safeDiagnosticError(error,kind,'push');await this.repository.setAuditDelivery(event.event_id,{status:'failed',attempts,error:safe,nextRetryAt:kind==='transient'&&attempts<this.maxAttempts?new Date(this.now()+retryDelayMs(attempts)).toISOString():null});await this.repository.setAuditDelivery('state',{at:new Date(this.now()).toISOString(),error:safe});failed++;if(kind==='auth')break;}
      }
      if(!failed)await this.repository.setAuditDelivery('state',{at:new Date(this.now()).toISOString(),error:null});return {sent,failed};
    }});
  }
}
