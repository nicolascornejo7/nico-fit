const QUEUED=new Set(['pending','syncing','failed','conflict']);
const SAFE_REASON=/^[a-z0-9_:-]{1,80}$/i;
const safeReason=value=>typeof value==='string'&&SAFE_REASON.test(value)?value:null;
const versionOf=row=>Number.isSafeInteger(row?.version)?row.version:Number.isSafeInteger(row?.remote_version)?row.remote_version:null;

export function buildV3SyncDiagnostic({operations=[],conflicts=[],buildId='unknown',now=()=>new Date()}={}){
  const conflictByOperation=new Map(),conflictRows=conflicts.map(conflict=>{
    const linked=(conflict.operation_ids||[]).map(id=>{conflictByOperation.set(id,conflict);return id;});
    return {entity:conflict.entity||null,type:linked.map(id=>operations.find(row=>row.operation_id===id)?.type).find(Boolean)||null,record_id:conflict.record_id||null,base_remote_version:linked.map(id=>operations.find(row=>row.operation_id===id)?.base_remote_version).find(value=>value!=null)??null,reason:safeReason(conflict.reason),local_version:versionOf(conflict.local_payload),remote_version:versionOf(conflict.remote_payload)};
  });
  const queued=operations.filter(row=>QUEUED.has(row.status));
  const operationRows=queued.map(operation=>{const conflict=conflictByOperation.get(operation.operation_id);return {entity:operation.entity,type:operation.type,record_id:operation.record_id,base_remote_version:operation.base_remote_version??null,reason:safeReason(conflict?.reason),local_version:versionOf(operation.payload),remote_version:versionOf(conflict?.remote_payload)??(Number.isSafeInteger(operation.payload?.remote_version)?operation.payload.remote_version:null)};});
  return {schemaVersion:1,build:String(buildId),exportedAt:new Date(now()).toISOString(),queueTotal:queued.length,conflictTotal:conflictRows.length,operations:operationRows,conflicts:conflictRows};
}
