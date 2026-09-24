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
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {buildPwaUpdateDiagnostic} from '../js/pwa-update-diagnostic.js';

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
  const session=await repo.create('workout_sessions',{session_date:'2026-09-20',label:'Entreno',status:'draft'});
  await repo.commitLocalChanges([],{trainingState:{activeSessionId:session.id}});repo.close();
  const active=await local({indexedDB,userId});assert.match(active.reasons.join(),/sesión V3 activa/);assert.equal(active.blockers.activeSessionCount,1);assert.equal(active.blockers.activeDraftCount,1);
  repo=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  await repo.update('workout_sessions',session.id,{status:'completed'});repo.close();
  const completed=await local({indexedDB,userId});assert.equal(completed.safe,true);assert.equal(completed.blockers.activeSessionCount,0);assert.equal(completed.blockers.activeDraftCount,0);assert.equal(completed.observations.staleTrainingStateCount,1);
});

test('safety snapshot distinguishes blockers and observes pending writes without mutation',async()=>{
  const indexedDB=new IDBFactory(),userId='diagnostic-user';
  const repo=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  const session=await repo.create('workout_sessions',{session_date:'2026-09-24',label:'Diagnóstico',status:'draft'});
  await repo.commitLocalChanges([],{trainingState:{activeSessionId:session.id}});
  const before=await repo.listOperations(),safety=await local({indexedDB,userId,critical:true});
  assert.equal(safety.blockers.activeSessionCount,1);assert.equal(safety.blockers.activeDraftCount,1);assert.equal(safety.blockers.criticalOperation,true);
  assert.equal(safety.observations.pendingLocalWriteCount,1);assert.deepEqual(await repo.listOperations(),before);
  const state={pending:true,stale:false,deferred:true,prepared:false,canUpdate:false,safety,version:{appBuildId:'nico-fit-v37',activeBuildId:'nico-fit-v37',waitingBuildId:'nico-fit-v38',mismatch:false}};
  const diagnostic=buildPwaUpdateDiagnostic(state,{buildId:'nico-fit-v37',now:()=>new Date('2026-09-24T12:00:00Z')});
  assert.equal(diagnostic.safety.blockers.activeSessionCount,1);assert.equal(diagnostic.safety.blockers.activeDraftCount,1);assert.equal(diagnostic.safety.blockers.criticalOperation,true);assert.equal(diagnostic.canUpdate,false);
  assert.doesNotMatch(JSON.stringify(diagnostic),/payload|token|cookie|email/i);
  assert.deepEqual(await repo.listOperations(),before);repo.close();
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
  assert.match(sw,/const BUILD_ID='nico-fit-v45'/);
  assert.match(index,/nico-fit-build" content="nico-fit-v45"/);
  assert.match(index,/PRUEBA v45/);
  assert.match(inventory,/nico-fit-build" content="nico-fit-v45"/);
  assert.doesNotMatch(sw,/clients\.claim\(/);
  assert.match(sw,/await self\.skipWaiting\(\)/);
  assert.match(sw,/Number\(name\.slice\(CACHE_PREFIX\.length\)\)<BUILD_NUMBER/);
  assert.match(sw,/NICO_FIT_PREPARE_UPDATE/);
});

test('finishing through the V3 engine clears active state without deleting the outbox',async()=>{
  const indexedDB=new IDBFactory(),userId='finished-v3-user';
  const repo=await V3LocalRepository.open({indexedDB,userId,featureEnabled:true});
  const engine=new V3TrainingEngine({repository:repo,featureEnabled:true,now:()=>new Date('2026-09-22T12:00:00Z')});
  await repo.create('workout_sessions',{session_date:'2026-09-19',label:'Histórica 1',status:'completed',started_at:'2026-09-19T11:00:00Z',ended_at:'2026-09-19T12:00:00Z'});
  await repo.create('workout_sessions',{session_date:'2026-09-20',label:'Histórica 2',status:'completed',started_at:'2026-09-20T11:00:00Z',ended_at:'2026-09-20T12:00:00Z'});
  await repo.create('workout_sessions',{session_date:'2026-09-21',label:'Draft huérfano',status:'draft',started_at:'2026-09-21T11:00:00Z'});
  const session=await repo.create('workout_sessions',{session_date:'2026-09-22',label:'Musculación libre',session_type:'free_workout',status:'draft',started_at:'2026-09-22T11:00:00Z'});
  await repo.commitLocalChanges([],{trainingState:{activeSessionId:session.id,currentExerciseId:null,view:'active',drafts:{},summaryDraft:{}}});
  await engine.recover();
  const [exercise]=await engine.catalog();
  const added=await engine.addExercise(exercise.id,{measurement_kind:exercise.measurement_kind});
  await engine.saveSet(added.id,{load_kg:20,reps:10,duration_seconds:null,rir:2,is_completed:true});
  assert.match((await local({indexedDB,userId})).reasons.join(),/sesión V3 activa/);
  await engine.finishSession({rpe:6});
  const queueBefore=(await repo.listOperations()).length;
  assert.equal(engine.getState(),null);
  const safety=await local({indexedDB,userId});
  assert.equal(safety.safe,true);assert.equal(safety.blockers.activeSessionCount,0);assert.equal(safety.blockers.activeDraftCount,0);
  assert.ok(safety.observations.pendingLocalWriteCount>0);assert.equal(safety.observations.orphanDraftSessionCount,1);
  assert.equal((await repo.listOperations()).length,queueBefore);
  assert.ok(queueBefore>0);
  const waiting={postMessage(_message,[port]){port.postMessage({buildId:'nico-fit-v39'});}},controller={postMessage(_message,[port]){port.postMessage({buildId:'nico-fit-v38'});}};
  const coordinator=new PwaUpdateCoordinator({registration:{waiting,addEventListener(){},update:async()=>{}},serviceWorker:{controller,addEventListener(){},removeEventListener(){}},documentLike:{querySelector:()=>({content:'nico-fit-v38'})},windowLike:null,readSafety:async()=>safety,Channel:MessageChannel});
  assert.equal((await coordinator.refresh()).canUpdate,true);
  repo.close();
});

test('safety scopes V3 blockers to the authenticated user database',async()=>{
  const indexedDB=new IDBFactory(),current='current-user',other='old-user';
  const currentRepo=await V3LocalRepository.open({indexedDB,userId:current,featureEnabled:true});
  await currentRepo.create('workout_sessions',{session_date:'2026-09-24',label:'Finalizada',status:'completed'});currentRepo.close();
  const otherRepo=await V3LocalRepository.open({indexedDB,userId:other,featureEnabled:true});
  const stale=await otherRepo.create('workout_sessions',{session_date:'2026-09-23',label:'Otra identidad',status:'draft'});
  await otherRepo.commitLocalChanges([],{trainingState:{activeSessionId:stale.id}});otherRepo.close();
  const safety=await local({indexedDB,userId:current});
  assert.equal(safety.safe,true);assert.equal(safety.blockers.activeSessionCount,0);assert.equal(safety.blockers.activeDraftCount,0);
});

test('a V3 safety-change event immediately reevaluates a deferred waiting update',async()=>{
  let safe=false,lastState=null,enable;
  const enabled=new Promise(resolve=>{enable=resolve;});
  const waiting={postMessage(_message,[port]){port.postMessage({buildId:'nico-fit-v39'});}};
  const controller={postMessage(_message,[port]){port.postMessage({buildId:'nico-fit-v38'});}};
  const registration={waiting,addEventListener(){},removeEventListener(){},update:async()=>{}};
  const serviceWorker={controller,addEventListener(){},removeEventListener(){}};
  const documentLike=new EventTarget();documentLike.querySelector=()=>({content:'nico-fit-v38'});
  const coordinator=new PwaUpdateCoordinator({registration,serviceWorker,documentLike,windowLike:null,readSafety:async()=>({safe,reasons:safe?[]:['Hay una sesión V3 activa.']}),onState:state=>{lastState=state;if(state.canUpdate)enable();},Channel:MessageChannel,pollMs:60000});
  await coordinator.start();coordinator.defer();assert.equal(lastState.deferred,true);
  safe=true;documentLike.dispatchEvent(new Event('nico-fit:pwa-safety-changed'));
  await Promise.race([enabled,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Safety event was not reevaluated.')),1000))]);
  assert.equal(lastState.canUpdate,true);assert.equal(lastState.deferred,false);
  assert.equal(registration.waiting,waiting);
  coordinator.destroy();
});

test('maintenance banner stays in normal layout before the app header',async()=>{
  const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
  const boot=await readFile(new URL('../js/v3/rollout-boot.js',import.meta.url),'utf8');
  assert.match(css,/\.rollout-banner\{position:relative/);
  assert.doesNotMatch(css,/\.rollout-banner\{position:fixed/);
  assert.match(boot,/appShell\.before\(banner\)/);
});

test('waiting worker cache survives cleanup by the active worker',async()=>{
  const old={self:globalThis.self,caches:globalThis.caches,fetch:globalThis.fetch};
  const events=new Map(),buckets=new Map();
  const cacheStorage={
    keys:async()=>[...buckets.keys()],has:async name=>buckets.has(name),delete:async name=>buckets.delete(name),
    open:async name=>{if(!buckets.has(name))buckets.set(name,new Map());const bucket=buckets.get(name);return {put:async(request,response)=>bucket.set(request.url||String(request),response),match:async url=>bucket.get(String(url))||null};}
  };
  try{
    globalThis.caches=cacheStorage;
    globalThis.fetch=async()=>new Response('asset',{status:200});
    globalThis.self={registration:{scope:'http://127.0.0.1:8199/'},location:{origin:'http://127.0.0.1:8199'},clients:{matchAll:async()=>[],get:async()=>({postMessage(){/* Page JS has not started yet. */}})},addEventListener:(name,handler)=>events.set(name,handler)};
    await import(`../sw.js?cache-test=${Date.now()}`);
    let install;events.get('install')({waitUntil:promise=>{install=promise;}});await install;
    assert.ok(buckets.get('nico-fit-v45').has('http://127.0.0.1:8199/index.html'));
    globalThis.fetch=async()=>{throw new Error('offline');};
    for(let reopen=0;reopen<2;reopen++){
      const clientId=`reopened-client-${reopen}`;
      // A worker restart loses JS memory, but not the versioned cache marker.
      await import(`../sw.js?offline-reopen=${Date.now()}-${reopen}`);
      for(const path of ['','styles.css','v3-training.css','manifest.json','icons/icon-192.png','js/app.js','js/v3/training-entry.js','js/v3/training-engine.js','js/v3/base-exercise-catalog.js','js/v3/exercise-family.js','js/v3/training-ui.js']){
        let response;events.get('fetch')({request:{url:`http://127.0.0.1:8199/${path}`,method:'GET',mode:path?'cors':'navigate'},clientId:path?clientId:'',resultingClientId:path?'':clientId,respondWith:promise=>{response=promise;}});
        assert.equal((await response).status,200,`offline reopen ${reopen+1} failed for ${path||'shell'}`);
      }
      let response;events.get('fetch')({request:{url:'http://127.0.0.1:8199/styles.css?standalone=1',method:'GET',mode:'cors'},clientId,respondWith:promise=>{response=promise;}});
      assert.equal((await response).status,200,'a query variant resolves to the same cached CSS');
    }
    await cacheStorage.open('nico-fit-v46');await cacheStorage.open('unrelated-cache');await cacheStorage.open('nico-fit-v24');
    let cleanup;let result;events.get('message')({data:{type:'NICO_FIT_CLEANUP'},ports:[{postMessage:value=>{result=value;}}],waitUntil:promise=>{cleanup=promise;}});await cleanup;
    assert.equal(result.cleaned,true);
    assert.deepEqual((await cacheStorage.keys()).sort(),['nico-fit-v45','nico-fit-v46','unrelated-cache']);
    let fetched;events.get('fetch')({request:{url:'http://127.0.0.1:8199/',method:'GET',mode:'navigate'},clientId:'',respondWith:promise=>{fetched=promise;}});
    assert.equal((await fetched).status,200);
  }finally{globalThis.self=old.self;globalThis.caches=old.caches;globalThis.fetch=old.fetch;}
});

test('offline shell includes update UI and all referenced assets are present',async()=>{
  const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  for(const name of ['pwa-update-entry.js','pwa-form-drafts.js','pwa-update-coordinator.js','pwa-update-diagnostic.js','pwa-update-safety.js','pwa-version.js'])assert.ok(sw.includes(name));
  const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(index,/js\/pwa-update-entry\.js/);
  const precache=sw.slice(sw.indexOf('const APP_ASSETS=['),sw.indexOf('];',sw.indexOf('const APP_ASSETS=[')));
  for(const match of index.matchAll(/<(?:link|script)\b[^>]*(?:href|src)=["']([^"']+)["']/g)){
    const path=match[1].replace(/^\.\//,'');
    if(path.startsWith('http')||path.startsWith('data:'))continue;
    assert.ok(precache.includes(`'./${path}'`),`HTML dependency ${path} is not precached`);
  }
  assert.ok(precache.includes("'./v3-training.css'"));
});

test('offline reopen can load every static dependency of the V3 training entry',async()=>{
  const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  const assets=new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map(match=>match[1]));
  const visited=new Set(),missing=new Set(),pending=['js/v3/training-entry.js'];
  while(pending.length){
    const path=pending.pop();if(visited.has(path))continue;visited.add(path);
    if(!assets.has(path))missing.add(path);
    const source=await readFile(new URL(`../${path}`,import.meta.url),'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+\.js)['"]/g)){
      const url=new URL(match[1],new URL(`../${path}`,import.meta.url));
      pending.push(`js/${decodeURIComponent(url.pathname.split('/js/')[1])}`);
    }
  }
  assert.deepEqual([...missing].sort(),[],`V3 modules missing from precache: ${[...missing].sort().join(', ')}`);
  assert.ok(visited.has('js/v3/base-exercise-catalog.js'));
});
