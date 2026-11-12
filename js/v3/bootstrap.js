import {isV3RoutinesEnabled} from './feature-flags.js';
import {V3RoutineService} from './routine-service.js';
import {pullV3Repository} from './sync-runtime.js';
import {V3_RECOVERY_TIMEOUT_MS,V3RecoveryError,runV3Recovery} from './recovery.js';

export const BOOTSTRAP_PENDING_MESSAGE='Datos locales no disponibles todavía. Conectate para recuperar tu información.';

// One pull per user and IndexedDB factory in this page. Other tabs share the
// sync engine's Web Lock/lease and keep the persistent marker pending if busy.
const inFlight=new WeakMap();

export async function bootstrapV3Repository(repository,{
  online=()=>globalThis.navigator?.onLine!==false,
  pullOnly=options=>pullV3Repository(repository,options),
  routinesEnabled=()=>isV3RoutinesEnabled(),
  seedDefaults=()=>new V3RoutineService({repository,featureEnabled:true}).seedDefaults(),
  recoveryTimeoutMs=V3_RECOVERY_TIMEOUT_MS,onRecoveryTrace
}={}){
  const initial=await repository.getBootstrapState();
  if(initial.state!=='pending')return {status:initial.state};
  if(!online())return {status:'pending',reason:'offline'};

  const factory=repository.indexedDBFactory??repository.database;
  let flights=inFlight.get(factory);
  if(!flights){flights=new Map();inFlight.set(factory,flights);}
  if(flights.has(repository.userId))return flights.get(repository.userId);
  const task=(async()=>{
    if((await repository.getBootstrapState()).state!=='pending')return {status:'hydrated'};
    let result;
    try{
      result=await runV3Recovery(async recovery=>{
        const pulled=await pullOnly({recovery,signal:recovery.signal});recovery.throwIfAborted();return pulled;
      },{timeoutMs:recoveryTimeoutMs,onTrace:onRecoveryTrace});
    }catch(error){
      // markBootstrapHydrated is the commit point: if it landed just before the
      // abort, the recovery did finish and must not be reported as pending.
      if((await repository.getBootstrapState()).state!=='hydrated')throw error;
      result={recoveredAfterAbort:true};
    }
    if(result?.skipped)return {status:'pending',reason:result.skipped};
    if((await repository.getBootstrapState()).state!=='hydrated')throw new V3RecoveryError('RECOVERY_RECONCILE',{stage:'hydrate',message:'No se pudo recuperar la información. Podés reintentar.'});
    if(routinesEnabled())await seedDefaults();
    return {status:'hydrated',result};
  })();
  flights.set(repository.userId,task);
  try{return await task;}finally{flights.delete(repository.userId);}
}
