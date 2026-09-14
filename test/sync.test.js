import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData} from '../js/store.js';
import {SyncService} from '../js/sync.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const setOnline=value=>Object.defineProperty(globalThis,'navigator',{value:{onLine:value},configurable:true});

test('auth state callback defers Supabase synchronization',async()=>{
  let authCallback,syncCalls=0;
  const client={auth:{
    getSession:async()=>({data:{session:null}}),
    onAuthStateChange:callback=>{authCallback=callback;}
  }};
  global.window={supabase:{createClient:()=>client}};
  global.fetch=async()=>({ok:true,json:async()=>({url:'url',publishableKey:'key'})});
  const service=new SyncService({getData:emptyData,setData:()=>{}});
  service.syncAll=async()=>{syncCalls++;};
  await service.init();
  const returned=authCallback('SIGNED_IN',{user:{id:'user-a'}});
  assert.equal(returned,undefined);
  assert.equal(syncCalls,0);
  await tick();
  assert.equal(syncCalls,1);
});

test('synced state is emitted only after the server confirmation pull',async()=>{
  setOnline(true);
  let resolveConfirmation,pulls=0;
  const confirmation=new Promise(resolve=>{resolveConfirmation=resolve;});
  const states=[],service=new SyncService({getData:emptyData,setData:()=>{},onState:(kind,text)=>states.push([kind,text])});
  service.client={};service.user={id:'user-a'};
  service.pull=async()=>{pulls++;if(pulls===2)await confirmation;return emptyData();};
  service.push=async()=>{};
  const pending=service.syncRecord();
  await tick();
  assert.equal(states.at(-1)[0],'pending');
  resolveConfirmation();
  assert.equal(await pending,true);
  assert.deepEqual(states.at(-1),['synced','Sincronizado']);
});

test('server failure leaves the record pending',async()=>{
  setOnline(true);
  const states=[],service=new SyncService({getData:emptyData,setData:()=>{},onState:(kind,text)=>states.push([kind,text])});
  service.client={};service.user={id:'user-a'};service.pull=async()=>emptyData();service.push=async()=>{throw new Error('offline');};
  const originalError=console.error;console.error=()=>{};
  try{await assert.rejects(service.syncRecord(),/offline/);}finally{console.error=originalError;}
  assert.deepEqual(states.at(-1),['pending','Pendiente de sincronizar']);
});

test('merge applies remote tombstones before stale local rows can be pushed',()=>{
  const service=new SyncService({getData:emptyData,setData:()=>{}});
  const local={...emptyData(),workouts:[{date:'2026-09-13',exercise:'Remo',updatedAt:'2026-09-13T10:00:00.000Z'}]};
  const remote={...emptyData(),tombstones:[{entity:'workouts',recordKey:JSON.stringify(['2026-09-13','Remo']),deletedAt:'2026-09-13T11:00:00.000Z'}]};
  assert.deepEqual(service.merge(local,remote).workouts,[]);
});

test('deleteRecord persists a tombstone before attempting network sync',async()=>{
  setOnline(false);
  let data={...emptyData(),matches:[{date:'2026-09-13',updatedAt:'2026-09-13T10:00:00.000Z'}]};
  const service=new SyncService({getData:()=>data,setData:value=>{data=value;}});service.user={id:'user-a'};
  assert.equal(await service.deleteRecord('matches',data.matches[0]),false);
  assert.deepEqual(data.matches,[]);
  assert.deepEqual(data.tombstones.map(x=>[x.entity,x.recordKey]),[['matches','2026-09-13']]);
});

test('an in-flight push keeps the user id that started the sync',async()=>{
  let releaseUpsert,resolveStarted;const started=new Promise(resolve=>{resolveStarted=resolve;});
  const blocked=new Promise(resolve=>{releaseUpsert=resolve;}),service=new SyncService({getData:emptyData,setData:()=>{}});
  service.user={id:'user-a'};service.upsert=async()=>{resolveStarted();await blocked;};
  let purgeUser;service.purge=async(_tombstones,userId)=>{purgeUser=userId;};
  const input={...emptyData(),tombstones:[{entity:'matches',recordKey:'2026-09-13',deletedAt:'2026-09-13T11:00:00.000Z'}]};
  const pushing=service.push(input,'user-a');await started;service.user={id:'user-b'};releaseUpsert();await pushing;
  assert.equal(purgeUser,'user-a');
});
