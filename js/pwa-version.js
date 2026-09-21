export function appBuildId(documentLike=globalThis.document){return documentLike?.querySelector?.('meta[name="nico-fit-build"]')?.content||'unknown';}

export function queryWorkerBuild(worker,{Channel=globalThis.MessageChannel,timeoutMs=1200}={}){
  if(!worker||!Channel)return Promise.resolve(null);
  return new Promise(resolve=>{
    const channel=new Channel();let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);channel.port1.close();resolve(typeof value?.buildId==='string'?value.buildId:null);};
    const timer=setTimeout(()=>finish(null),timeoutMs);
    channel.port1.onmessage=event=>finish(event.data);
    try{worker.postMessage({type:'NICO_FIT_GET_VERSION'},[channel.port2]);}catch{finish(null);}
  });
}

export async function pwaVersionSnapshot({documentLike=globalThis.document,navigatorLike=globalThis.navigator,registration=null,Channel=globalThis.MessageChannel}={}){
  const appBuild=appBuildId(documentLike),serviceWorker=navigatorLike?.serviceWorker;
  let current=registration;
  if(!current)try{current=await serviceWorker?.getRegistration?.();}catch{}
  const activeBuild=await queryWorkerBuild(serviceWorker?.controller,{Channel});
  const waitingBuild=await queryWorkerBuild(current?.waiting,{Channel});
  return {appBuildId:appBuild,activeBuildId:activeBuild,waitingBuildId:waitingBuild,controlled:!!serviceWorker?.controller,mismatch:!!activeBuild&&activeBuild!==appBuild};
}
