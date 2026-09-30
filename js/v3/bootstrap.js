import {isV3RoutinesEnabled} from './feature-flags.js';
import {V3RoutineService} from './routine-service.js';
import {pullV3Repository} from './sync-runtime.js';

export const BOOTSTRAP_PENDING_MESSAGE='Datos locales no disponibles todavía. Conectate para recuperar tu información.';

// One pull per user and IndexedDB factory in this page. Other tabs share the
// sync engine's Web Lock/lease and keep the persistent marker pending if busy.
const inFlight=new WeakMap();

export async function bootstrapV3Repository(repository,{
  online=()=>globalThis.navigator?.onLine!==false,
  pullOnly=()=>pullV3Repository(repository),
  routinesEnabled=()=>isV3RoutinesEnabled(),
  seedDefaults=()=>new V3RoutineService({repository,featureEnabled:true}).seedDefaults()
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
    const result=await pullOnly();
    if(result?.skipped)return {status:'pending',reason:result.skipped};
    if((await repository.getBootstrapState()).state!=='hydrated')throw new Error('La primera recuperación V3 no quedó confirmada.');
    if(routinesEnabled())await seedDefaults();
    return {status:'hydrated',result};
  })();
  flights.set(repository.userId,task);
  try{return await task;}finally{flights.delete(repository.userId);}
}
