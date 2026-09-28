import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3SignalsUI} from '../js/v3/signals-ui.js';
import {V3TodayService} from '../js/v3/today-service.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';

const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tuesday=()=>new Date('2026-09-15T12:00:00');
const enableV3=()=>installRolloutControl({snapshot:()=>({source:'remote',updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_signals_enabled:true,v3_routines_enabled:true,v3_training_enabled:true,v3_sync_enabled:true,v3_coach_enabled:true}}),refreshIfDue:async()=>{}});
async function open(indexedDB=new IDBFactory()){enableV3();return {indexedDB,repository:await V3LocalRepository.open({indexedDB,userId,featureEnabled:true})};}

test('known check-in UI writes only daily_readiness V3 and survives reload offline',async()=>{
  const {indexedDB,repository}=await open();let syncCalls=0;
  const ui=new V3SignalsUI({repository,syncNow:async()=>{syncCalls++;return {skipped:'offline'};}});
  const input={local_date:'2026-09-15',sleep:5,energy:4,freshness:3,pain:2,pain_area:'Gemelo',notes:''};
  const {record}=await ui.saveReadiness(input);assert.equal(record.sync_status,'pending');assert.equal(syncCalls,1);assert.equal((await repository.listOperations()).length,1);repository.close();
  const reopened=(await open(indexedDB)).repository,stored=(await new V3SignalsUI({repository:reopened}).readiness(input.local_date));assert.equal(stored.freshness,3);assert.equal(stored.pain_area,'Gemelo');reopened.close();
});

test('today resolves Tuesday stable routine deterministically and preserves checkpoint',async()=>{
  const {indexedDB,repository}=await open(),today=new V3TodayService({repository,now:tuesday});
  const started=await today.startToday();assert.equal(started.session.session_type,'routine');assert.equal(started.session.routine_snapshot.day_index,2);assert.equal(started.session.routine_snapshot.name,'Fuerza principal');assert.equal(started.exercises.length,7);
  const activeId=started.session.id;assert.equal((await repository.getTrainingState()).activeSessionId,activeId);repository.close();
  const reopened=(await open(indexedDB)).repository,recovered=await new V3TodayService({repository:reopened,now:tuesday}).recover();assert.equal(recovered.session.id,activeId);reopened.close();
});

test('free workout remains routine-free and uses the same V3 graph',async()=>{
  const {repository}=await open(),today=new V3TodayService({repository,now:tuesday}),free=await today.startFree();assert.equal(free.session.session_type,'free_workout');assert.equal(free.session.routine_id,undefined);assert.equal((await repository.listOperations()).some(row=>row.entity==='workout_sessions'),true);repository.close();
});

test('product routes do not call legacy V2 write methods',async()=>{
  const [app,signals]=await Promise.all([readFile(new URL('../js/app.js',import.meta.url),'utf8'),readFile(new URL('../js/v3/signals-ui.js',import.meta.url),'utf8')]);
  const handlers=app.slice(app.indexOf("$('saveReadiness').onclick"),app.indexOf('renderAll(false);',app.indexOf("$('saveReadiness').onclick")));
  for(const marker of ['startSession;','finishSession;','saveSessionSummary;','sync.syncAll()','sync.syncRecord()','sync.deleteAll()'])assert.equal(handlers.includes(marker),false,marker);
  assert.equal(signals.includes("#save('daily_readiness'"),true);assert.equal(signals.includes('../sync.js'),false);
});
