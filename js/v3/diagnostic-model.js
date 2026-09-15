const codes=new Set(['PT409','55000','42501','23505','23514','PGRST301','NETWORK_ERROR','REMOTE_ROW_MISSING']);
const messages={auth:'La sesión necesita una nueva autenticación.',transient:'No se pudo completar la conexión. Se conservaron los cambios locales.',conflict:'Hay versiones incompatibles que requieren una decisión.',permanent:'Una operación fue rechazada y requiere revisión.'};
export function safeDiagnosticError(error,kind='permanent',phase=null){
  return {kind:Object.hasOwn(messages,kind)?kind:'permanent',code:codes.has(String(error?.code))?String(error.code):null,status:Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:null,phase,message:messages[kind]||messages.permanent};
}
export function summarizeOperations(operations,{now=Date.now(),maxAttempts=5}={}){
  const counts=Object.fromEntries(['pending','syncing','synced','conflict','failed','superseded'].map(status=>[status,0])),entities={};let approximateBytes=0;
  const pendingStates=new Set(['pending','syncing','conflict','failed']),retries=[];let eligibleFailed=0;
  for(const operation of operations){
    if(Object.hasOwn(counts,operation.status))counts[operation.status]++;
    entities[operation.entity]??={pending:0,syncing:0,synced:0,conflict:0,failed:0,superseded:0};if(Object.hasOwn(entities[operation.entity],operation.status))entities[operation.entity][operation.status]++;
    if(pendingStates.has(operation.status))approximateBytes+=new TextEncoder().encode(JSON.stringify(operation)).length;
    if(operation.status==='failed'&&operation.next_attempt_at&&operation.attempts<maxAttempts){retries.push(operation.next_attempt_at);if(Date.parse(operation.next_attempt_at)<=now)eligibleFailed++;}
  }
  const future=retries.filter(date=>Date.parse(date)>now).sort();
  return {counts,entities,queue:{operations:counts.pending+counts.syncing+counts.conflict+counts.failed,approximateBytes},backoff:{active:future.length>0,nextRetryAt:future[0]||null,eligibleFailed,blockedFailed:counts.failed-eligibleFailed}};
}
