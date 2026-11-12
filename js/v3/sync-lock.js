const uuid=cryptoImpl=>cryptoImpl.randomUUID();

// `signal` (recovery only) bounds how long the lock is held: on abort the lock
// callback settles, the lease is released and the late task is left to fail
// its own abort checks. Without a signal the protocol is unchanged.
function untilAborted(promise,signal){
  if(!signal)return promise;
  if(signal.aborted)return Promise.reject(signal.reason);
  let onAbort;const aborted=new Promise((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});});
  return Promise.race([promise,aborted]).finally(()=>signal.removeEventListener('abort',onAbort));
}

export async function withV3SyncLock({repository,userId,locks=globalThis.navigator?.locks,cryptoImpl=globalThis.crypto,ttlMs=30000,backend='lease',signal=null,task}){
  if(typeof task!=='function')throw new Error('Sync lock requires a task.');
  const name=`nico-fit-v3-sync:${userId}`;
  if(locks?.request){
    // The lease is shared with instances that cannot use Web Locks.
    return locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>lock?withV3SyncLock({repository,userId,locks:null,cryptoImpl,ttlMs,backend:'web-lock+lease',signal,task}):{skipped:'locked'});
  }
  const ownerToken=uuid(cryptoImpl),acquired=await repository.acquireLease(name,ownerToken,{ttlMs,backend});
  if(!acquired)return {skipped:'locked'};
  const interval=setInterval(()=>repository.renewLease(name,ownerToken,{ttlMs}).catch(()=>{}),Math.max(1000,Math.floor(ttlMs/3)));
  try{return await untilAborted(Promise.resolve().then(task),signal);}
  finally{clearInterval(interval);await repository.releaseLease(name,ownerToken);}
}

