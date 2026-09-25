// Bump this ID together with the nico-fit-build meta tags for every release.
const BUILD_ID='nico-fit-v47';
const CACHE_NAME=BUILD_ID;
const CACHE_PREFIX='nico-fit-v';
const BUILD_NUMBER=Number(BUILD_ID.slice(CACHE_PREFIX.length));
const APP_ASSETS=[
  './','./index.html','./styles.css','./manifest.json','./icons/icon-192.png','./icons/icon-512.png','./icons/nico-fit-logo-square.png',
  './local-device-inventory.html','./local-device-inventory.css','./v3-training.css',
  './js/app.js','./js/active-session.js','./js/charts.js','./js/exercise-identity.js',
  './js/local-device-inventory-page.js','./js/local-device-inventory.js','./js/metrics.js',
  './js/plan.js','./js/progression.js','./js/pwa-update-entry.js','./js/pwa-update-coordinator.js','./js/pwa-update-diagnostic.js',
  './js/pwa-update-gate.js','./js/pwa-update-safety.js','./js/pwa-form-drafts.js','./js/pwa-version.js',
  './js/v3/rollout-policy.js','./js/v3/rollout-state.js','./js/v3/rollout-control.js','./js/v3/rollout-boot.js',
  './js/safe-dom.js','./js/store.js','./js/sync.js','./js/validation.js',
  './js/v3/audit-service.js','./js/v3/auth-reconnect.js','./js/v3/base-exercise-catalog.js','./js/v3/client-storage.js','./js/v3/client-sync.js','./js/v3/sync-runtime.js',
  './js/v3/coach-context.js','./js/v3/coach-presentation.js','./js/v3/coach-rules.js',
  './js/v3/coach-service.js','./js/v3/coach-signals.js','./js/v3/conflict-entry.js',
  './js/v3/conflict-service.js','./js/v3/conflict-ui.js','./js/v3/diagnostic-model.js',
  './js/v3/exercise-family.js','./js/v3/feature-flags.js','./js/v3/import-v2-routines.js','./js/v3/import-v2-signals.js',
  './js/v3/import-v2.js','./js/v3/indexed-db.js','./js/v3/observability-entry.js',
  './js/v3/observability-runtime.js','./js/v3/observability-service.js','./js/v3/observability-ui.js',
  './js/v3/offline-auth.js','./js/v3/public-config.js',
  './js/v3/repository.js','./js/v3/routine-presentation.js','./js/v3/routine-service.js',
  './js/v3/routine-validation.js','./js/v3/routines.js','./js/v3/signals-repository.js',
  './js/v3/signals-validation.js','./js/v3/supabase-audit-adapter.js','./js/v3/supabase-v3-adapter.js',
  './js/v3/session-diagnostic.js','./js/v3/sync-diagnostic.js','./js/v3/sync-engine.js','./js/v3/sync-lock.js','./js/v3/sync-protocol.js',
  './js/v3/training-engine.js','./js/v3/training-entry.js','./js/v3/training-metrics.js',
  './js/v3/training-progression.js','./js/v3/training-ui.js','./js/v3/training-validation.js'
];
const assetUrls=new Set(APP_ASSETS.map(path=>new URL(path,self.registration.scope).href));
const shellUrl=new URL('./index.html',self.registration.scope).href;
const inventoryUrl=new URL('./local-device-inventory.html',self.registration.scope).href;
const clientBuildKey=id=>new URL(`./__client_build__/${encodeURIComponent(id)}`,self.registration.scope).href;
const reply=(port,value)=>{try{port?.postMessage(value);}catch{}};
let activationRequested=false;

async function askClient(client,type,timeoutMs=3000){
  return new Promise(resolve=>{
    const channel=new MessageChannel();let finished=false;
    const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);channel.port1.close();resolve(value);};
    const timer=setTimeout(()=>finish(null),timeoutMs);
    channel.port1.onmessage=event=>finish(event.data);
    try{client.postMessage({type,buildId:BUILD_ID},[channel.port2]);}catch{finish(null);}
  });
}

async function scopedClients(){
  const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  return all.filter(client=>client.url.startsWith(self.registration.scope));
}

async function cleanOldCaches(){
  const clients=await scopedClients();
  if(clients.length){
    const versions=await Promise.all(clients.map(client=>askClient(client,'NICO_FIT_BUILD_QUERY')));
    if(versions.some(version=>version?.buildId!==BUILD_ID))return false;
  }
  const names=await caches.keys();
  // A live worker must never delete the cache being populated by a newer waiting worker.
  await Promise.all(names.filter(name=>/^nico-fit-v\d+$/.test(name)&&Number(name.slice(CACHE_PREFIX.length))<BUILD_NUMBER).map(name=>caches.delete(name)));
  return true;
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try{
      for(const path of APP_ASSETS){
        const request=new Request(new URL(path,self.registration.scope),{cache:'reload'});
        const response=await fetch(request);
        if(!response.ok)throw new Error(`No se pudo preparar ${path}.`);
        await cache.put(request,response);
      }
    }catch(error){await caches.delete(CACHE_NAME);throw error;}
    // No skipWaiting: an installed update remains waiting until an explicit safe decision.
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    // Existing pages may receive this controller after skipWaiting; they remain read-only
    // until reloaded, and static requests are served from their own build cache below.
    const clients=await scopedClients();
    for(const client of clients)client.postMessage({type:'NICO_FIT_UPDATE_ACTIVATED',buildId:BUILD_ID});
    if(!clients.length)await cleanOldCaches();
  })());
});

self.addEventListener('message',event=>{
  const port=event.ports?.[0],type=event.data?.type;
  if(type==='NICO_FIT_GET_VERSION'){reply(port,{buildId:BUILD_ID,cacheName:CACHE_NAME});return;}
  if(type==='NICO_FIT_CLEANUP'){event.waitUntil(cleanOldCaches().then(cleaned=>reply(port,{cleaned})));return;}
  if(type!=='NICO_FIT_ACTIVATE_IF_SAFE'||!port)return;
  if(activationRequested){reply(port,{accepted:false,reason:'Otra pestaña ya está preparando la actualización.'});return;}
  activationRequested=true;
  event.waitUntil((async()=>{
    const clients=await scopedClients();
    const checks=await Promise.all(clients.map(client=>askClient(client,'NICO_FIT_PREPARE_UPDATE')));
    const builds=new Set(checks.map(check=>check?.buildId).filter(Boolean));
    const blocked=checks.some(check=>!check?.ready)||builds.size!==1;
    if(blocked){
      for(const client of clients)client.postMessage({type:'NICO_FIT_RELEASE_UPDATE'});
      reply(port,{accepted:false,reason:'Hay una sesión, un borrador, una operación en curso o una pestaña antigua. Cerrá o actualizá las otras pestañas y reintentá.'});
      activationRequested=false;
      return;
    }
    reply(port,{accepted:true,buildId:BUILD_ID});
    await self.skipWaiting();
  })().catch(async()=>{
    activationRequested=false;
    for(const client of await scopedClients())client.postMessage({type:'NICO_FIT_RELEASE_UPDATE'});
    reply(port,{accepted:false,reason:'No se pudo verificar el estado de todas las pestañas.'});
  }));
});

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  const normalized=new URL(url.pathname,self.location.origin).href;
  const staticPath=/\.(?:js|css|html|json|png|svg|webp|ico)$/i.test(url.pathname);
  const asset=request.mode==='navigate'?(normalized===inventoryUrl?inventoryUrl:shellUrl):(assetUrls.has(normalized)||staticPath)?normalized:null;
  if(!asset)return;
  event.respondWith((async()=>{
    let cacheName=CACHE_NAME;
    if(request.mode==='navigate'){
      // The navigation establishes the build before CSS and modules start loading.
      // Store it in CacheStorage: Safari may restart the worker between requests.
      const newClientId=event.resultingClientId;
      if(newClientId)await (await caches.open(CACHE_NAME)).put(clientBuildKey(newClientId),new Response(BUILD_ID));
    }else if(event.clientId){
      const marker=clientBuildKey(event.clientId);
      for(const name of (await caches.keys()).filter(name=>/^nico-fit-v\d+$/.test(name))){
        if(await (await caches.open(name)).match(marker)){cacheName=name;break;}
      }
      if(cacheName===CACHE_NAME&&!await (await caches.open(CACHE_NAME)).match(marker)){
        // Pre-update tabs lack a marker. Query them rather than mixing builds.
        const client=await self.clients.get(event.clientId);
        const build=client&&(await askClient(client,'NICO_FIT_BUILD_QUERY',600))?.buildId;
        if(build&&/^nico-fit-v\d+$/.test(build)&&await caches.has(build))cacheName=build;
        else if(client)return new Response('No se pudo determinar la versión de esta pestaña. Recargá para actualizar.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
      }
    }
    const response=await (await caches.open(cacheName)).match(asset);
    return response||new Response('La versión local está incompleta. Reconectá y actualizá.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
  })());
});
