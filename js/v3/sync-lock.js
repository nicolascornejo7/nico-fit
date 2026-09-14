const uuid=cryptoImpl=>cryptoImpl.randomUUID();

export async function withV3SyncLock({repository,userId,locks=globalThis.navigator?.locks,cryptoImpl=globalThis.crypto,ttlMs=30000,task}){
  if(typeof task!=='function')throw new Error('Sync lock requires a task.');
  const name=`nico-fit-v3-sync:${userId}`;
  if(locks?.request){
    return locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>lock?task():{skipped:'locked'});
  }
  const ownerToken=uuid(cryptoImpl),acquired=await repository.acquireLease(name,ownerToken,{ttlMs});
  if(!acquired)return {skipped:'locked'};
  const interval=setInterval(()=>repository.renewLease(name,ownerToken,{ttlMs}).catch(()=>{}),Math.max(1000,Math.floor(ttlMs/3)));
  try{return await task();}
  finally{clearInterval(interval);await repository.releaseLease(name,ownerToken);}
}

