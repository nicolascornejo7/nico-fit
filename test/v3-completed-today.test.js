import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {completedRoutineSessions,completedExerciseHint} from '../js/v3/completed-today.js';
import {defaultRoutineId} from '../js/v3/routine-service.js';
import {stableClientUuid} from '../js/v3/import-v2.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DATE='2026-09-29';

async function fixture(overrides={}){
  const routineId=await defaultRoutineId(USER,2),versionId=await stableClientUuid(`v3:routine-version:${routineId}:1`);
  return {id:crypto.randomUUID(),session_date:DATE,session_type:'routine',status:'completed',deleted_at:null,
    routine_id:routineId,routine_version:1,routine_version_id:versionId,
    routine_snapshot:{routine_id:routineId,routine_version:1,routine_version_id:versionId,exercises:[]},
    started_at:'2026-09-29T15:00:00Z',ended_at:'2026-09-29T16:00:00Z',...overrides};
}

test('today completion requires canonical routine identity and does not count free or discarded sessions',async()=>{
  const valid=await fixture(),free=await fixture({session_type:'free_workout'}),discarded=await fixture({deleted_at:'2026-09-29T17:00:00Z'}),wrongRoutine=await fixture({routine_id:crypto.randomUUID()}),wrongVersion=await fixture({routine_version_id:crypto.randomUUID()}),draft=await fixture({status:'draft'}),yesterday=await fixture({session_date:'2026-09-28'});
  const repository={userId:USER,listSessions:async({date,status})=>[valid,free,discarded,wrongRoutine,wrongVersion,draft,yesterday].filter(row=>row.session_date===date&&row.status===status&&!row.deleted_at)};
  assert.deepEqual((await completedRoutineSessions(repository,{date:DATE,dayIndex:2})).map(item=>item.id),[valid.id]);
  assert.deepEqual(await completedRoutineSessions(repository,{date:DATE,dayIndex:3}),[]);
  assert.deepEqual(await completedRoutineSessions(repository,{date:'2026-09-28',dayIndex:2}),[]);
});

test('multiple completed routine sessions stay accessible in deterministic latest-first order',async()=>{
  const earlier=await fixture({id:'a',ended_at:'2026-09-29T16:00:00Z'}),later=await fixture({id:'b',ended_at:'2026-09-29T19:00:00Z'});
  const repository={userId:USER,listSessions:async()=>[earlier,later]};
  assert.deepEqual((await completedRoutineSessions(repository,{date:DATE,dayIndex:2})).map(item=>item.id),['b','a']);
});

test('substitution hint uses the performed graph without confusing a reordered exercise',()=>{
  const original={position:0,exercise_catalog_id:'original',exercise_name_snapshot:'Press banca'};
  const replacement={position:0,exercise_catalog_id:'replacement',exercise_name_snapshot:'Press con mancuernas'};
  const snapshot={session:{routine_snapshot:{exercises:[original]}},exercises:[replacement]};
  assert.equal(completedExerciseHint(replacement,snapshot),'Sustituyó a Press banca');
  assert.equal(completedExerciseHint(original,{...snapshot,exercises:[original]}),null);
  assert.equal(completedExerciseHint(replacement,{...snapshot,exercises:[original,replacement]}),'Ejercicio incorporado en esta sesión');
});

test('today uses the user local date across a UTC midnight boundary',()=>{
  const source="import {localDateKey} from './js/plan.js'; const date=new Date('2026-09-30T02:30:00Z'); process.stdout.write(localDateKey(date)+'|'+date.getDay());";
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:new URL('..',import.meta.url),env:{...process.env,TZ:'America/Argentina/Buenos_Aires'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'2026-09-29|2');
});
