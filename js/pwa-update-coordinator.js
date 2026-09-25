import {collectPwaUpdateSafety} from './pwa-update-safety.js';
import {appBuildId,pwaVersionSnapshot} from './pwa-version.js';
import {setUpdateGateMode} from './pwa-update-gate.js';

function request(worker,type,{Channel=globalThis.MessageChannel,timeoutMs=15000}={}){
  if(!worker||!Channel)return Promise.resolve(null);
  return new Promise(resolve=>{
    const channel=new Channel();let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);channel.port1.close();resolve(value);};
    const timer=setTimeout(()=>finish(null),timeoutMs);
    channel.port1.onmessage=event=>finish(event.data);
    try{worker.postMessage({type},[channel.port2]);}catch{finish(null);}
  });
}

function waitForActivation(worker,timeoutMs=15000){
  if(worker?.state==='activated')return Promise.resolve(true);
  return new Promise(resolve=>{
    const finish=value=>{clearTimeout(timer);worker?.removeEventListener?.('statechange',changed);resolve(value);};
    const changed=()=>{if(worker.state==='activated')finish(true);if(worker.state==='redundant')finish(false);};
    const timer=setTimeout(()=>finish(false),timeoutMs);
    worker?.addEventListener?.('statechange',changed);
  });
}

export class PwaUpdateCoordinator{
  constructor({registration,serviceWorker=globalThis.navigator?.serviceWorker,documentLike=globalThis.document,windowLike=globalThis.window,readSafety=()=>collectPwaUpdateSafety(),onState=()=>{},reload=()=>globalThis.location?.reload(),Channel=globalThis.MessageChannel,pollMs=3000}={}){
    if(!registration||!serviceWorker)throw new Error('Service worker no disponible.');
    Object.assign(this,{registration,serviceWorker,documentLike,windowLike,readSafety,onState,reload,Channel,pollMs});
    this.buildId=appBuildId(documentLike);this.deferred=false;this.stale=false;this.prepared=false;this.error=null;this.poll=null;
    this.handleMessage=event=>this.onMessage(event);
    this.handleUpdateFound=()=>{const installing=this.registration.installing;if(installing){installing.addEventListener('statechange',this.handleInstalling);this.installing=installing;}this.refresh().catch(()=>{});};
    this.handleInstalling=()=>this.refresh().catch(()=>{});
    this.handleFocus=()=>this.refresh().catch(()=>{});
    this.handleSafetyChanged=()=>this.refresh().catch(()=>{});
  }

  async start(){
    this.serviceWorker.addEventListener('message',this.handleMessage);
    this.registration.addEventListener?.('updatefound',this.handleUpdateFound);
    this.windowLike?.addEventListener?.('storage',this.handleFocus);
    this.windowLike?.addEventListener?.('focus',this.handleFocus);
    this.documentLike?.addEventListener?.('visibilitychange',this.handleFocus);
    this.documentLike?.addEventListener?.('nico-fit:pwa-safety-changed',this.handleSafetyChanged);
    this.poll=setInterval(()=>this.refresh().catch(()=>{}),this.pollMs);
    await this.refresh();
    if(this.serviceWorker.controller)request(this.serviceWorker.controller,'NICO_FIT_CLEANUP',{Channel:this.Channel,timeoutMs:3500}).catch(()=>{});
    if(globalThis.navigator?.onLine!==false)this.registration.update?.().catch(()=>{});
    return this.state;
  }

  async safety(){try{return await this.readSafety();}catch{return {safe:false,reasons:['No se pudo comprobar el estado local.']};}}

  async refresh(){
    const [safety,version]=await Promise.all([this.safety(),pwaVersionSnapshot({documentLike:this.documentLike,navigatorLike:{serviceWorker:this.serviceWorker},registration:this.registration,Channel:this.Channel})]);
    const pending=!!this.registration.waiting,stale=this.stale||version.mismatch;
    if(this.deferred&&this.previousSafe===false&&safety.safe)this.deferred=false;
    if(this.previousWaitingBuild&&version.waitingBuildId&&this.previousWaitingBuild!==version.waitingBuildId)this.deferred=false;
    this.previousSafe=safety.safe;this.previousWaitingBuild=version.waitingBuildId;
    const reasons=[...safety.reasons];
    if(version.mismatch)reasons.push('La página y el service worker son de versiones distintas. Cerrá otras pestañas y recargá cuando sea seguro.');
    if(this.error)reasons.push(this.error);
    this.state={pending,stale,deferred:this.deferred,prepared:this.prepared,canUpdate:(pending||stale)&&safety.safe&&(!version.mismatch||stale&&!pending)&&!this.prepared,reasons,version,safety};
    this.onState(this.state);return this.state;
  }

  defer(){this.deferred=true;this.state={...this.state,deferred:true};this.onState(this.state);}

  async apply(){
    const state=await this.refresh();
    if(!state.canUpdate)return {applied:false,reason:state.reasons[0]||'La actualización no está lista.'};
    if(!this.registration.waiting){this.reload();return {applied:true,reloaded:true};}
    this.error=null;
    const waiting=this.registration.waiting;
    const answer=await request(waiting,'NICO_FIT_ACTIVATE_IF_SAFE',{Channel:this.Channel,timeoutMs:20000});
    if(!answer?.accepted){this.prepared=false;setUpdateGateMode(this.stale?'stale':'normal');this.error=answer?.reason||'No se pudo verificar a todas las pestañas.';await this.refresh();return {applied:false,reason:this.error};}
    this.prepared=true;setUpdateGateMode('transition');
    const activated=await waitForActivation(waiting);
    if(!activated){this.prepared=false;setUpdateGateMode(this.stale?'stale':'normal');this.error='La nueva versión no terminó de activarse. Reintentá.';await this.refresh();return {applied:false,reason:this.error};}
    this.reload();return {applied:true,reloaded:true};
  }

  async onMessage(event){
    const type=event.data?.type,port=event.ports?.[0];
    if(type==='NICO_FIT_BUILD_QUERY'){port?.postMessage({buildId:this.buildId});return;}
    if(type==='NICO_FIT_PREPARE_UPDATE'){
      setUpdateGateMode('transition');
      const [safety,version]=await Promise.all([this.safety(),pwaVersionSnapshot({documentLike:this.documentLike,navigatorLike:{serviceWorker:this.serviceWorker},registration:this.registration,Channel:this.Channel})]);
      const ready=safety.safe&&!version.mismatch;
      if(!ready)setUpdateGateMode(this.stale?'stale':'normal');
      else this.prepared=true;
      port?.postMessage({ready,buildId:this.buildId});
      await this.refresh();return;
    }
    if(type==='NICO_FIT_RELEASE_UPDATE'){
      this.prepared=false;setUpdateGateMode(this.stale?'stale':'normal');await this.refresh();return;
    }
    if(type==='NICO_FIT_UPDATE_ACTIVATED'){
      this.prepared=false;
      this.stale=event.data?.buildId!==this.buildId;
      setUpdateGateMode(this.stale?'stale':'normal');await this.refresh();
    }
  }

  destroy(){
    clearInterval(this.poll);this.installing?.removeEventListener?.('statechange',this.handleInstalling);
    this.serviceWorker.removeEventListener?.('message',this.handleMessage);
    this.registration.removeEventListener?.('updatefound',this.handleUpdateFound);
    this.windowLike?.removeEventListener?.('storage',this.handleFocus);
    this.windowLike?.removeEventListener?.('focus',this.handleFocus);
    this.documentLike?.removeEventListener?.('visibilitychange',this.handleFocus);
    this.documentLike?.removeEventListener?.('nico-fit:pwa-safety-changed',this.handleSafetyChanged);
  }
}
