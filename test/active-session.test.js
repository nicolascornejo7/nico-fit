import test from 'node:test';
import assert from 'node:assert/strict';
import {ActiveSessionStore,commitPendingSession,elapsedSeconds,remainingRestSeconds} from '../js/active-session.js';
import {emptyData} from '../js/store.js';
import {SyncService} from '../js/sync.js';
import {localDateKey} from '../js/plan.js';

function memoryStorage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function startedStore({now=Date.parse('2026-09-15T10:00:00.000Z'),storage=memoryStorage(),owner='user-a'}={}){
  let clock=now;const store=new ActiveSessionStore({storage,owner,now:()=>clock});
  store.start({sessionDate:'2026-09-15',dayIndex:2,day:'Martes',label:'Fuerza principal',intensity:'Alta',startedAt:clock,exercises:[{name:'Sentadilla',sets:[{kg:'80',reps:'6',rir:'2',done:true}]}]});
  return {store,storage,setNow:value=>{clock=value;}};
}

test('restores the complete active-session snapshot after reload',()=>{
  const {store,storage}=startedStore();store.setCurrentExercise(0);store.startRest(150);store.updateSummary({notes:'ignored'});
  const restored=new ActiveSessionStore({storage,owner:'user-a',now:()=>Date.parse('2026-09-15T10:00:30.000Z')});
  assert.equal(restored.state.startedAt,'2026-09-15T10:00:00.000Z');assert.equal(restored.state.currentExercise,0);
  assert.deepEqual(restored.state.exercises[0].sets[0],{kg:'80',reps:'6',rir:'2',done:true});assert.equal(restored.state.rest.durationSeconds,150);
});

test('active sessions use a separate local namespace for each user',()=>{
  const storage=memoryStorage();startedStore({storage,owner:'user-a'});
  assert.equal(new ActiveSessionStore({storage,owner:'user-b'}).state,null);
  assert.equal(new ActiveSessionStore({storage,owner:'user-a'}).state.sessionDate,'2026-09-15');
});

test('session and rest timers use wall-clock timestamps after suspension',()=>{
  const start=Date.parse('2026-09-15T10:00:00.000Z'),now=start+91_400;
  assert.equal(elapsedSeconds(new Date(start).toISOString(),now),91);
  assert.equal(remainingRestSeconds({endsAt:new Date(start+150_000).toISOString()},now),59);
});

test('an expired rest is reconciled when the app reopens',()=>{
  const start=Date.parse('2026-09-15T10:00:00.000Z'),fixture=startedStore({now:start});fixture.store.startRest(60);fixture.setNow(start+90_000);
  assert.equal(fixture.store.reconcileTime(),true);assert.equal(fixture.store.state.rest,null);assert.equal(fixture.store.state.restFinishedAt,'2026-09-15T10:01:00.000Z');
});

test('a data synchronization cannot overwrite an active editing draft',async()=>{
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});const fixture=startedStore();
  fixture.store.replaceDrafts([{name:'Sentadilla',sets:[{kg:'82.5',reps:'7',rir:'1',done:false}]}]);let data=emptyData();
  const sync=new SyncService({getData:()=>data,setData:value=>{data=value;}});sync.client={};sync.user={id:'user-a'};sync.pull=async()=>emptyData();sync.push=async()=>{};
  await sync.syncAll();const restored=new ActiveSessionStore({storage:fixture.storage,owner:'user-a'});
  assert.equal(restored.state.exercises[0].sets[0].kg,'82.5');assert.equal(restored.state.exercises[0].sets[0].reps,'7');
});

test('the captured session date stays fixed when the calendar day changes',()=>{
  const fixture=startedStore(),tomorrow=new Date('2026-09-16T10:00:00');
  assert.equal(fixture.store.state.sessionDate,'2026-09-15');assert.equal(localDateKey(tomorrow),'2026-09-16');
});

test('failed remote save keeps the summary pending and retry can clear it',async()=>{
  const fixture=startedStore();fixture.store.prepareSummary({date:'2026-09-15',duration:45,rpe:7,notes:'Completa'});let localWrites=0;
  const failed=await commitPendingSession({store:fixture.store,persistLocal:async()=>{localWrites++;},requireRemote:true,syncRemote:async()=>{throw new Error('Sin red');}});
  assert.equal(failed.saved,false);assert.equal(fixture.store.state.phase,'summary');assert.equal(fixture.store.state.saveStatus,'pending');assert.match(fixture.store.state.saveMessage,/Sin red/);
  const reloaded=new ActiveSessionStore({storage:fixture.storage,owner:'user-a'});assert.equal(reloaded.state.summary.notes,'Completa');assert.equal(reloaded.state.saveStatus,'pending');
  const retried=await commitPendingSession({store:fixture.store,persistLocal:async()=>{localWrites++;},requireRemote:true,syncRemote:async()=>true});
  assert.equal(retried.saved,true);assert.equal(fixture.store.state,null);assert.equal(localWrites,2);
});
