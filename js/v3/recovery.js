export const V3_RECOVERY_TIMEOUT_MS=45000;

export class V3RecoveryError extends Error{
  constructor(code,{stage='recovery',cause=null,message}={}){
    super(message||'No se pudo completar la recuperación. Podés reintentar.');
    this.name='V3RecoveryError';this.code=code;this.stage=stage;this.cause=cause;this.retryable=true;
  }
}

export function recoveryError(error,{stage='recovery',timedOut=false}={}){
  if(error instanceof V3RecoveryError)return error;
  const status=Number(error?.status||error?.statusCode||0),phase=String(stage).split(':')[0];
  const indexed=/^(ConstraintError|DataError|InvalidStateError|NotFoundError|QuotaExceededError|TransactionInactiveError|UnknownError|VersionError)$/.test(error?.name||'');
  const code=timedOut||error?.name==='AbortError'?'RECOVERY_TIMEOUT'
    :[401,403].includes(status)||phase==='auth'?'RECOVERY_AUTH'
    :phase==='config'?'RECOVERY_CONFIG'
    :indexed||phase==='indexeddb'?'RECOVERY_INDEXEDDB'
    :phase==='lock'?'RECOVERY_LOCK'
    :status===404||status>=500?'RECOVERY_REMOTE'
    :phase==='reconcile'||phase==='hydrate'?'RECOVERY_RECONCILE'
    :'RECOVERY_NETWORK';
  return new V3RecoveryError(code,{stage,cause:error,message:recoveryUserMessage({code})});
}

export function recoveryUserMessage(error){
  if(error?.code==='RECOVERY_TIMEOUT')return 'La recuperación tardó demasiado. Podés reintentar.';
  if(error?.code==='RECOVERY_AUTH')return 'No se pudo validar la sesión para recuperar tus datos. Podés reintentar.';
  if(error?.code==='RECOVERY_CONFIG')return 'No se pudo preparar la recuperación. Podés reintentar.';
  if(error?.code==='RECOVERY_NETWORK')return 'No hay conexión suficiente para recuperar tus datos. Podés reintentar.';
  if(error?.code==='RECOVERY_LOCK')return 'Otra pestaña está sincronizando. Podés reintentar en unos segundos.';
  return 'No se pudo recuperar la información. Podés reintentar.';
}

function publish(entry,onTrace){const safe={stage:entry.stage,durationMs:entry.durationMs??null,code:entry.code??null,entity:entry.entity??null};onTrace?.(safe);globalThis.document?.dispatchEvent?.(new CustomEvent('nico-fit:v3-recovery-diagnostic',{detail:safe}));}

export function createV3RecoveryAttempt({timeoutMs=V3_RECOVERY_TIMEOUT_MS,onTrace,now=Date.now}={}){
  const controller=new AbortController(),startedAt=now();let stage='recovery:start',timer;
  const attempt={signal:controller.signal,trace(next,extra={}){stage=next;publish({stage:next,durationMs:now()-startedAt,...extra},onTrace);},throwIfAborted(){if(controller.signal.aborted)throw recoveryError(controller.signal.reason,{stage,timedOut:controller.signal.reason?.code==='RECOVERY_TIMEOUT'});},abort(reason){if(!controller.signal.aborted)controller.abort(reason);},get stage(){return stage;},dispose(){clearTimeout(timer);}};
  timer=setTimeout(()=>attempt.abort(new V3RecoveryError('RECOVERY_TIMEOUT',{stage,message:'La recuperación tardó demasiado. Podés reintentar.'})),timeoutMs);attempt.trace('recovery:start');return attempt;
}

// The timeout aborts the shared signal used by Supabase fetch. Guards in the pull
// path prevent any late non-abortable browser task from hydrating or seeding.
export async function runV3Recovery(work,options={}){
  const attempt=createV3RecoveryAttempt(options);let rejectAbort;const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(recoveryError(attempt.signal.reason,{stage:attempt.stage,timedOut:true}));});
  attempt.signal.addEventListener('abort',rejectAbort,{once:true});
  try{const result=await Promise.race([Promise.resolve().then(()=>work(attempt)),aborted]);attempt.throwIfAborted();return result;}
  catch(error){const normalized=recoveryError(error,{stage:attempt.stage,timedOut:attempt.signal.aborted});attempt.trace('recovery:error',{code:normalized.code});throw normalized;}
  finally{attempt.signal.removeEventListener('abort',rejectAbort);attempt.dispose();}
}

export function recoveryFetch(fetchImpl,signal){
  if(!signal)return fetchImpl;
  return (input,init={})=>{const controller=new AbortController(),abort=()=>controller.abort(signal.reason);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});return fetchImpl(input,{...init,signal:controller.signal}).finally(()=>signal.removeEventListener('abort',abort));};
}
