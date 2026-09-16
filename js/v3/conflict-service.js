import {withV3SyncLock} from './sync-lock.js';

const explanations={routine_version_number_collision:'Dos dispositivos publicaron el mismo número de versión con IDs distintos. Conservá los snapshots y revisá explícitamente la nueva versión; no se renumera ni se aplica automáticamente.',remote_changed:'El servidor cambió mientras había cambios locales pendientes.',remote_change_vs_local_change:'El servidor cambió mientras había cambios locales pendientes.',conflict_remote_refresh:'Se actualizó la copia remota de un conflicto que sigue abierto.',remote_version_conflict:'La versión enviada ya no coincide con la del servidor.',remote_tombstone:'El servidor conserva un registro de borrado. Su identidad no puede reactivarse.',version_conflict:'La versión enviada ya no coincide con la del servidor.',v2_source_changed:'La fuente V2 cambió después de importar. Requiere revisión explícita de la importación.'};
export function availableStrategies(conflict,local){
  const result=['defer'],remote=conflict.remote_payload;
  if(conflict.reason==='v2_source_changed'||local?.migration_status==='pending_review')return result;
  if(conflict.status!=='open'||!remote||remote.id!==local?.id||!Number.isSafeInteger(remote.version))return result;
  result.push('accept_remote');if(!remote.deleted_at)result.push('keep_local');
  if(conflict.entity==='football_sessions'&&!remote.deleted_at&&!local.deleted_at)result.push('keep_both');
  return result;
}
// Public read model: observability and UI never need database/store names.
export class V3ConflictService{
  constructor({repository,locks=globalThis.navigator?.locks}){this.repository=repository;this.locks=locks;}
  async list({status='all'}={}){
    const [conflicts,decisions,operations]=await Promise.all([this.repository.listConflicts({status:null}),this.repository.resolutionHistory(),this.repository.listOperations()]);
    const rows=[];
    for(const conflict of conflicts){
      if(status!=='all'&&conflict.status!==status)continue;
      const local=await this.repository.get(conflict.entity,conflict.record_id),history=decisions.filter(row=>row.conflict_id===conflict.conflict_id);
      rows.push({...conflict,local,remote:conflict.remote_payload,origin:conflict.reason,date:local?.local_date||local?.session_date||conflict.created_at,explanation:conflict.remote_payload?.deleted_at?explanations.remote_tombstone:explanations[conflict.reason]||`Cambios incompatibles detectados (${conflict.reason}). No se aplicó una sobrescritura automática.`,strategies:availableStrategies(conflict,local),decisions:history,operationStates:operations.filter(row=>history.some(decision=>decision.operation_ids.includes(row.operation_id))).map(row=>({id:row.operation_id,status:row.status,error:row.last_error}))});
    }
    return rows;
  }
  async count(){return (await this.list()).filter(row=>row.status!=='resolved').length;}
  async history(){return this.repository.resolutionHistory();}
  async resolve(view,strategy,{note=''}={}){
    if(!view.strategies.includes(strategy))throw new Error('Esta estrategia no está disponible. Actualizá el detalle.');
    const result=await withV3SyncLock({repository:this.repository,userId:this.repository.userId,locks:this.locks,task:()=>this.repository.resolveConflict({conflictId:view.conflict_id,strategy,expectedUpdatedAt:view.updated_at,expectedRemoteVersion:view.remote?.version??null,expectedLocalRevision:view.local.local_revision,metadata:{note:String(note).slice(0,2000),source:'conflict-ui',semantics:strategy==='keep_both'?'Independent football occurrence; linked reviews are not copied.':null}})});
    if(result?.skipped)throw new Error('La sincronización está trabajando. Reintentá cuando termine.');
    return result;
  }
}
