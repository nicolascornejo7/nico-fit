import * as flags from './feature-flags.js';
import {safeDiagnosticError} from './diagnostic-model.js';
import {V3ConflictService} from './conflict-service.js';
import {withV3SyncLock} from './sync-lock.js';

const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const id=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value)?value:null;
const statuses=new Set(['running','offline','locked','failed','completed']);
const phases=new Set(['auth','pull','push','finished','offline','locked']);
function attemptView(row){return {attemptId:id(row.attemptId),startedAt:stamp(row.startedAt),finishedAt:stamp(row.finishedAt),status:statuses.has(row.status)?row.status:'unknown',phase:phases.has(row.phase)?row.phase:null,error:row.error?safeDiagnosticError(row.error,row.error.kind,phases.has(row.error.phase)?row.error.phase:null):null,result:Object.fromEntries(['pulled','pushed','conflicts','failed','recovered','requeued'].map(name=>[name,Number.isSafeInteger(row.result?.[name])&&row.result[name]>=0?row.result[name]:0]))};}
export function v3FlagState(storage){return Object.fromEntries(['V3_LOCAL_STORAGE_FLAG','V3_SYNC_FLAG','V3_TRAINING_FLAG','V3_COACH_FLAG','V3_BRIDGE_FLAG','V3_BRIDGE_SYNC_FLAG','V3_CONFLICT_UI_FLAG','V3_OBSERVABILITY_FLAG','V3_AUDIT_FLAG'].map(name=>{const key=flags[name];try{return [key,storage?.getItem(key)==='true'];}catch{return [key,false];}}));}

export class V3ObservabilityService{
  constructor({repository,engine=null,audit=null,flagStorage=globalThis.localStorage,online=()=>globalThis.navigator?.onLine!==false,locks=globalThis.navigator?.locks,now=Date.now}={}){
    if(!repository)throw new Error('Observability requires an authenticated repository.');
    if(engine&&engine.repository.userId!==repository.userId)throw new Error('Observability engine belongs to another user.');
    if(audit&&audit.repository.userId!==repository.userId)throw new Error('Audit belongs to another user.');
    Object.assign(this,{repository,engine,audit,flagStorage,online,locks,now});this.conflicts=new V3ConflictService({repository,locks});
  }
  async snapshot(){
    const [operational,conflicts]=await Promise.all([this.repository.operationalSnapshot({now:this.now(),maxAttempts:this.engine?.maxAttempts||5}),this.conflicts.list()]);
    const attempts=operational.attempts.map(attemptView),flagState=v3FlagState(this.flagStorage),lastAttempt=attempts[0]||null,lastSuccessful=operational.lastSuccess?attemptView(operational.lastSuccess):attempts.find(row=>row.status==='completed')||null;
    const resolutions=conflicts.flatMap(row=>row.decisions).sort((a,b)=>b.resolved_at.localeCompare(a.resolved_at)).slice(0,10).map(row=>({id:id(row.id),entity:row.entity,strategy:row.strategy,localRevision:row.local_revision,localRemoteVersion:row.local_remote_version,remoteVersion:row.remote_version,decidedAt:stamp(row.resolved_at),confirmedAt:stamp(row.confirmed_at),confirmation:row.confirmation}));
    const online=!!this.online(),syncEnabled=flagState[flags.V3_SYNC_FLAG],configured=!!this.engine,openConflicts=conflicts.filter(row=>row.status==='open').length;
    const errorAttempt=operational.lastError?attemptView(operational.lastError):attempts.find(row=>row.error)||null,lastError=errorAttempt?.error||(operational.counts.failed?safeDiagnosticError(null,'permanent','push'):null);
    const summary=!online?'Estás offline. Tus cambios locales se conservan.':!syncEnabled?'Sync V3 está desactivado. Los datos siguen guardados localmente.':!configured?'Falta configurar explícitamente el motor V3 de staging.':operational.lock.active?'Otra instancia puede estar sincronizando.':openConflicts?`${openConflicts} conflictos necesitan una decisión explícita.`:lastAttempt?.status==='failed'?'El último intento no terminó correctamente. Los cambios locales se conservan.':operational.queue.operations?`${operational.queue.operations} operaciones siguen pendientes.`:lastSuccessful?'No hay operaciones pendientes. Hay confirmación de un ciclo remoto exitoso.':'Todavía no hay un sync remoto confirmado.';
    return {online,summary,lastAttempt,lastSuccessfulSyncAt:lastSuccessful?.finishedAt||null,lastError,lastErrorAt:errorAttempt?.finishedAt||errorAttempt?.startedAt||null,checkpoints:Object.fromEntries(Object.entries(operational.checkpoints).map(([entity,cursor])=>[entity,{updatedAt:stamp(cursor.updatedAt),id:id(cursor.id)}])),operations:operational.counts,entities:operational.entities,queue:operational.queue,backoff:operational.backoff,lock:operational.lock,openConflicts,resolutionPending:conflicts.filter(row=>row.status==='resolution_pending').length,recentResolutions:resolutions,flags:flagState,actions:{syncNow:online&&syncEnabled&&configured&&!operational.lock.active,retryFailed:online&&syncEnabled&&configured&&!operational.lock.active&&operational.backoff.eligibleFailed>0},audit:await this.audit?.snapshot()||{enabled:flagState[flags.V3_AUDIT_FLAG],configured:false}};
  }
  async syncNow(){
    if(!flags.isV3SyncEnabled(this.flagStorage)||!this.engine)throw new Error('Sync V3 requiere flag y motor explícitos.');
    const result=await this.engine.syncOnce();if(!result.skipped&&this.audit)await this.audit.flush();return result;
  }
  async retryFailed(){
    if(!(await this.snapshot()).actions.retryFailed)throw new Error('No hay fallos elegibles: respetá el backoff o renová la sesión.');
    const result=await withV3SyncLock({repository:this.repository,userId:this.repository.userId,locks:this.locks,task:()=>this.repository.requeueDueFailed({now:this.now(),maxAttempts:this.engine.maxAttempts})});
    if(result?.skipped)return result;return {requeued:result,sync:await this.syncNow()};
  }
}
