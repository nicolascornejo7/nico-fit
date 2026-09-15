import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
const assets=['/','/fixture','/styles.css','/v3-training.css','/manifest-conflicts-test.json','/icons/icon-192.png',...['plan','metrics','progression','exercise-identity','validation'].map(name=>'/js/'+name+'.js'),...(await readdir(new URL('../js/v3/',import.meta.url))).filter(name=>name.endsWith('.js')).map(name=>'/js/v3/'+name)];
const worker=`const name='nico-fit-conflict-manual-v2';self.addEventListener('install',event=>{event.waitUntil(caches.open(name).then(cache=>cache.addAll(${JSON.stringify(assets)})));self.skipWaiting();});self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(name).then(cache=>cache.put(event.request,copy));}return response;}).catch(()=>caches.match(event.request)));});`;
const harness=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validación manual V3 · entorno local</title><body style="background:#07111f;color:white;font:16px system-ui;margin:12px"><h1>Validación manual V3</h1><p>Datos sintéticos. Sin cliente Supabase ni acceso a producción.</p><button id="mobile">Vista móvil (390px)</button><button id="desktop">Vista escritorio</button><iframe title="Nico Fit V3 · fixture local" src="/fixture" style="display:block;width:100%;height:760px;border:1px solid #aaa;margin-top:10px"></iframe><script>mobile.onclick=()=>document.querySelector('iframe').style.width='390px';desktop.onclick=()=>document.querySelector('iframe').style.width='100%';</script></body></html>`;
const fixture=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nico Fit · conflictos sintéticos</title><link rel="manifest" href="/manifest-conflicts-test.json"><link rel="stylesheet" href="/styles.css"><body><main class="app-shell"><div class="top-actions"></div><h1>Prueba local de conflictos</h1><p id="setup" role="status">Preparando fixtures…</p><button id="reset">Recrear fixtures</button><button id="finish">Finalizar sesión activa de prueba</button><button id="hold">Tomar Web Lock y lease</button><button id="release">Liberar lock</button><button id="fallback">Probar otra instancia sin Web Locks</button><p id="locks" role="status"></p><p id="pwa" role="status"></p><p id="focus" role="status"></p></main><script type="module">
import {V3LocalRepository} from '/js/v3/repository.js';
import {V3TrainingEngine} from '/js/v3/training-engine.js';
import {V3ConflictService} from '/js/v3/conflict-service.js';
import {withV3SyncLock} from '/js/v3/sync-lock.js';
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// Explicit activation ONLY on this loopback test origin. App defaults are unchanged.
localStorage.setItem('nicoFit.v3.localStorage.enabled','true');localStorage.setItem('v3.conflicts.enabled','true');
document.addEventListener('nico-fit:auth-request',()=>document.dispatchEvent(new CustomEvent('nico-fit:auth',{detail:{userId}})));
const repository=await V3LocalRepository.open({userId,featureEnabled:true});
let releaseLock;
document.querySelector('#hold').onclick=()=>withV3SyncLock({repository,userId,task:async()=>{document.querySelector('#locks').textContent='Web Lock + lease tomados; otra pestaña debe quedar excluida.';await new Promise(resolve=>releaseLock=resolve);document.querySelector('#locks').textContent='Lock liberado.';}});
document.querySelector('#release').onclick=()=>releaseLock?.();
document.querySelector('#fallback').onclick=async()=>{const result=await withV3SyncLock({repository,userId,locks:null,task:async()=>({executed:true})});document.querySelector('#locks').textContent=result.skipped?'Otra instancia excluida: '+result.skipped:'Otra instancia pudo ejecutar después de liberar.';};
(navigator.serviceWorker.controller?Promise.resolve():navigator.serviceWorker.register('/v3-conflicts-test-sw.js')).then(()=>navigator.serviceWorker.ready).then(()=>{document.querySelector('#pwa').textContent='PWA local: service worker listo; archivos disponibles offline tras reload.';}).catch(error=>document.querySelector('#pwa').textContent=error.message);
const engine=new V3TrainingEngine({repository,featureEnabled:true});await engine.recover();
async function seed(){
 const football=await repository.create('football_sessions',{local_date:'2026-09-15',session_type:'training',duration_minutes:60,rpe:6,notes:'Fixture <img src=x onerror=alert(1)> permanece como texto'});
 const readiness=await repository.create('daily_readiness',{local_date:new Date().toISOString().slice(0,10),sleep:4,energy:4,freshness:4,pain:0});
 const snapshot=engine.getState()?await engine.snapshot():await engine.createSession({label:'Sesión activa de prueba',useRoutine:false});
 for(const [entity,row,patch] of [['football_sessions',football,{rpe:8}],['daily_readiness',readiness,{energy:2}],['workout_sessions',snapshot.session,{notes:'Nota remota'}]]){
  await repository.recordConflict({entity,recordId:row.id,operationIds:(await repository.unresolvedOperations(entity,row.id)).map(row=>row.operation_id),reason:'remote_change_vs_local_change',localPayload:row,remotePayload:{...row,...patch,user_id:userId,version:2}});
 }
}
if(!(await repository.listConflicts({status:null})).length)await seed();
document.querySelector('#reset').onclick=async()=>{repository.close();localStorage.clear();const {deleteUserDatabase}=await import('/js/v3/indexed-db.js');await deleteUserDatabase({userId});location.reload();};
document.querySelector('#finish').onclick=async()=>{await repository.commitLocalChanges([],{trainingState:null});document.querySelector('#setup').textContent='Estado activo limpiado explícitamente en fixture local.';};
await import('/js/v3/conflict-entry.js');
document.querySelector('#setup').textContent='Listo · 3 conflictos iniciales; sesión gym activa. No hay sync remoto.';
document.addEventListener('focusin',event=>{document.querySelector('#focus').textContent='Foco: '+event.target.tagName+' · '+(event.target.textContent||event.target.getAttribute('aria-label')||'').slice(0,70);});
document.addEventListener('keydown',event=>{if(event.key==='F6')document.querySelector('#focus').textContent=JSON.stringify({activeElement:document.activeElement?.textContent,dialogs:[...document.querySelectorAll('[role=dialog]')].map(node=>({role:node.getAttribute('role'),modal:node.getAttribute('aria-modal'),label:node.getAttribute('aria-label')})),live:[...document.querySelectorAll('[role=status]')].length});});
</script></body></html>`;
const server=createServer(async(request,response)=>{
 const path=new URL(request.url,'http://127.0.0.1').pathname;
 if(path==='/v3-conflicts-test-sw.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(worker);return;}
 if(path==='/manifest-conflicts-test.json'){response.writeHead(200,{'Content-Type':'application/manifest+json'}).end(JSON.stringify({name:'Nico Fit Conflict Manual',short_name:'Conflicts Test',start_url:'/fixture',display:'standalone',icons:[{src:'/icons/icon-192.png',sizes:'192x192',type:'image/png'}]}));return;}
 if(path==='/'||path==='/fixture'){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(path==='/'?harness:fixture);return;}
 if(!/^\/js\/v3\/[\w-]+\.js$/.test(path)&&!/^\/js\/(plan|metrics|progression|exercise-identity|validation)\.js$/.test(path)&&!['/styles.css','/v3-training.css','/icons/icon-192.png'].includes(path)){response.writeHead(404).end('Not found');return;}
 try{const body=await readFile(new URL('..'+path,import.meta.url));response.writeHead(200,{'Content-Type':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/javascript','Cache-Control':'no-store'}).end(body);}catch{response.writeHead(404).end('Not found');}
});
server.listen(41741,'127.0.0.1',()=>console.log('Synthetic conflict UI available at http://127.0.0.1:41741 (no Supabase client).'));
