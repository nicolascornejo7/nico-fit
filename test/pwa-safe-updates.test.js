import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {collectPwaUpdateSafety} from '../js/pwa-update-safety.js';
import {trackPwaFormDrafts,restorePwaFormDrafts,clearPwaFormDrafts,hasPwaFormDrafts} from '../js/pwa-form-drafts.js';
import {PwaUpdateCoordinator} from '../js/pwa-update-coordinator.js';
import {setUpdateGateMode,mayStartNewWork} from '../js/pwa-update-gate.js';
import {SyncService} from '../js/sync.js';

const storage=()=>{const rows=new Map();return {get length(){return rows.size;},key:index=>[...rows.keys()][index]??null,getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,String(value)),removeItem:key=>rows.delete(key)};};
const local=(settings={})=>collectPwaUpdateSafety({storage:settings.storage||storage(),indexedDB:settings.indexedDB||new IDBFactory(),userId:settings.userId,critical:settings.critical,dirty:settings.dirty});

test('a clean page can update; an active V2 session and pending summary cannot',async()=>{
  const memory=storage();assert.equal((await local({storage:memory})).safe,true);
  memory.setItem('gymFutbolActiveSessionV2:user-a',JSON.stringify({phase:'active'}));
  assert.match((await local({storage:memory})).reasons.join(),/sesión V2 activa/);
  memory.setItem('gymFutbolActiveSessionV2:user-a',JSON.stringify({phase:'summary',saveStatus:'pending'}));
  assert.match((await local({storage:memory})).reasons.join(),/finalización V2 pendiente/);
  memory.removeItem('gymFutbolActiveSessionV2:user-a');assert.equal((await local({storage:memory})).safe,true);
});

test('reload, corrupt state and critical or dirty work fail closed',async()=>{
  const memory=storage();memory.setItem('gymFutbolActiveSessionV2:user-a','bad-json');
  assert.equal((await local({storage:memory})).safe,false);
  memory.removeItem('gymFutbolActiveSessionV2:user-a');
  assert.equal((await local({critical:true})).safe,false);
  assert.equal((await local({dirty:true})).safe,false);
});

test('V3 draft session persists after repository close and blocks update until completed',async()=>{
  const indexedDB=new IDBFactory(),userId='safe-update-user';
  let repo=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  const session=await repo.create('workout_sessions',{session_date:'2026-09-20',label:'Entreno',status:'draft'});repo.close();
  assert.match((await local({indexedDB,userId})).reasons.join(),/sesión V3 activa/);
  repo=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  await repo.update('workout_sessions',session.id,{status:'completed'});repo.close();
  assert.equal((await local({indexedDB,userId})).safe,true);
});

test('in-flight sync and a live lease block update across reloads; abandoned lease expires',async()=>{
  const indexedDB=new IDBFactory(),userId='sync-user';
  let repo=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  await repo.create('workout_sessions',{session_date:'2026-09-20',label:'Terminada',status:'completed'});
  await repo.claimPendingOperations(1);
  await repo.acquireLease('v3-sync','instance-a',{now:Date.now(),ttlMs:30000});repo.close();
  const blocked=await local({indexedDB,userId});assert.equal(blocked.safe,false);
  assert.match(blocked.reasons.join(),/sincronizándose/);
  assert.match(blocked.reasons.join(),/operación V3 crítica/);
  repo=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  await repo.recoverInterruptedOperations();await repo.releaseLease('v3-sync','instance-a');repo.close();
  assert.equal((await local({indexedDB,userId})).safe,true);
});

test('dirty form drafts survive a render and clear only after explicit save',()=>{
  const listeners=new Map(),field={id:'sleep',value:'3'},doc={addEventListener:(name,fn)=>listeners.set(name,fn),getElementById:id=>id==='sleep'?field:null};
  trackPwaFormDrafts(doc);listeners.get('input')({target:field});field.value='5';restorePwaFormDrafts(doc);
  assert.equal(field.value,'3');assert.equal(hasPwaFormDrafts(),true);
  clearPwaFormDrafts(['sleep']);assert.equal(hasPwaFormDrafts(),false);
});

test('defer hides prompt and a safety transition reoffers the waiting update',async()=>{
  let safe=false;const worker={postMessage(_message,[port]){port.postMessage({buildId:'nico-fit-v18'});}};
  const registration={waiting:worker,addEventListener(){},update:async()=>{}};
  const sw={controller:worker,addEventListener(){},removeEventListener(){}};
  const doc={querySelector:()=>({content:'nico-fit-v18'}),addEventListener(){},removeEventListener(){}};
  const coordinator=new PwaUpdateCoordinator({registration,serviceWorker:sw,documentLike:doc,windowLike:null,readSafety:async()=>({safe,reasons:safe?[]:['Sesión activa']}),Channel:MessageChannel});
  await coordinator.refresh();assert.equal(coordinator.state.canUpdate,false);
  coordinator.defer();assert.equal(coordinator.state.deferred,true);
  safe=true;await coordinator.refresh();assert.equal(coordinator.state.deferred,false);assert.equal(coordinator.state.canUpdate,true);
});

test('finishing an active session permits explicit activation and one reload',async()=>{
  const memory=storage();memory.setItem('gymFutbolActiveSessionV2:guest',JSON.stringify({phase:'active'}));
  const worker=new EventTarget();worker.state='installed';worker.postMessage=(message,[port])=>{
    if(message.type==='NICO_FIT_GET_VERSION')port.postMessage({buildId:'nico-fit-v18'});
    if(message.type==='NICO_FIT_ACTIVATE_IF_SAFE'){port.postMessage({accepted:true});worker.state='activated';worker.dispatchEvent(new Event('statechange'));}
  };
  const registration={waiting:worker,addEventListener(){},update:async()=>{}};
  const sw={controller:worker,addEventListener(){},removeEventListener(){}};
  const doc={querySelector:()=>({content:'nico-fit-v18'}),addEventListener(){},removeEventListener(){}};
  let reloads=0;
  const coordinator=new PwaUpdateCoordinator({registration,serviceWorker:sw,documentLike:doc,windowLike:null,readSafety:()=>local({storage:memory}),reload:()=>{reloads++;},Channel:MessageChannel});
  assert.equal((await coordinator.refresh()).canUpdate,false);
  memory.removeItem('gymFutbolActiveSessionV2:guest');
  assert.equal((await coordinator.refresh()).canUpdate,true);
  assert.equal((await coordinator.apply()).applied,true);
  assert.equal(reloads,1);
  setUpdateGateMode('normal');
});

test('a prepared or stale tab refuses new work until the transition completes',()=>{
  setUpdateGateMode('transition');assert.equal(mayStartNewWork(),false);
  setUpdateGateMode('stale');assert.equal(mayStartNewWork(),false);
  setUpdateGateMode('normal');assert.equal(mayStartNewWork(),true);
});

test('an old V2 tab cannot start a new background sync during activation',async()=>{
  const sync=new SyncService({getData:()=>({}),setData:()=>{},onState:()=>{}});
  sync.client={};sync.user={id:'user-a'};
  setUpdateGateMode('transition');
  try{assert.equal(await sync.syncAll(),false);assert.equal(sync.busy,false);}
  finally{setUpdateGateMode('normal');}
});

test('worker precaches full version, avoids automatic takeover and cleans only Nico Fit caches',async()=>{
  const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const inventory=await readFile(new URL('../local-device-inventory.html',import.meta.url),'utf8');
  assert.match(sw,/const BUILD_ID='nico-fit-v18'/);
  assert.match(index,/nico-fit-build" content="nico-fit-v18"/);
  assert.match(inventory,/nico-fit-build" content="nico-fit-v18"/);
  assert.doesNotMatch(sw,/clients\.claim\(/);
  assert.match(sw,/await self\.skipWaiting\(\)/);
  assert.match(sw,/Number\(name\.slice\(CACHE_PREFIX\.length\)\)<BUILD_NUMBER/);
  assert.match(sw,/NICO_FIT_PREPARE_UPDATE/);
});

test('waiting worker cache survives cleanup by the active worker',async()=>{
  const old={self:globalThis.self,caches:globalThis.caches,fetch:globalThis.fetch};
  const events=new Map(),buckets=new Map();
  const cacheStorage={
    keys:async()=>[...buckets.keys()],has:async name=>buckets.has(name),delete:async name=>buckets.delete(name),
    open:async name=>{if(!buckets.has(name))buckets.set(name,new Map());const bucket=buckets.get(name);return {put:async(request,response)=>bucket.set(request.url,response),match:async url=>bucket.get(String(url))||null};}
  };
  try{
    globalThis.caches=cacheStorage;
    globalThis.fetch=async()=>new Response('asset',{status:200});
    globalThis.self={registration:{scope:'http://127.0.0.1:8199/'},location:{origin:'http://127.0.0.1:8199'},clients:{matchAll:async()=>[],get:async()=>null},addEventListener:(name,handler)=>events.set(name,handler)};
    await import(`../sw.js?cache-test=${Date.now()}`);
    let install;events.get('install')({waitUntil:promise=>{install=promise;}});await install;
    assert.ok(buckets.get('nico-fit-v18').has('http://127.0.0.1:8199/index.html'));
    await cacheStorage.open('nico-fit-v19');await cacheStorage.open('unrelated-cache');await cacheStorage.open('nico-fit-v17');
    let cleanup;let result;events.get('message')({data:{type:'NICO_FIT_CLEANUP'},ports:[{postMessage:value=>{result=value;}}],waitUntil:promise=>{cleanup=promise;}});await cleanup;
    assert.equal(result.cleaned,true);
    assert.deepEqual((await cacheStorage.keys()).sort(),['nico-fit-v18','nico-fit-v19','unrelated-cache']);
    let fetched;events.get('fetch')({request:{url:'http://127.0.0.1:8199/',method:'GET',mode:'navigate'},clientId:'',respondWith:promise=>{fetched=promise;}});
    assert.equal((await fetched).status,200);
  }finally{globalThis.self=old.self;globalThis.caches=old.caches;globalThis.fetch=old.fetch;}
});

test('offline shell includes update UI and all referenced assets are present',async()=>{
  const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  for(const name of ['pwa-update-entry.js','pwa-form-drafts.js','pwa-update-coordinator.js','pwa-update-safety.js','pwa-version.js'])assert.ok(sw.includes(name));
  const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(index,/js\/pwa-update-entry\.js/);
});
