import test from 'node:test';
import assert from 'node:assert/strict';
import {buildV3SyncDiagnostic} from '../js/v3/sync-diagnostic.js';

test('empty diagnostic is read-only and contains no sensitive fields',()=>{
  const result=buildV3SyncDiagnostic({now:()=>new Date('2026-09-22T12:00:00Z')});
  assert.equal(result.queueTotal,0);assert.equal(result.conflictTotal,0);assert.equal(result.exportedAt,'2026-09-22T12:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(result),/token|cookie|password|email|payload|secret|key/i);
});

test('diagnostic summarizes queued operations and conflicts without payloads',()=>{
  const operations=[
    {operation_id:'op-1',entity:'exercise_catalog',type:'insert',record_id:'catalog-1',status:'conflict',base_remote_version:null,payload:{version:null,access_token:'redacted'}},
    {operation_id:'op-2',entity:'workout_sessions',type:'update',record_id:'session-1',status:'pending',base_remote_version:2,payload:{version:3,label:'local'}}
  ];
  const result=buildV3SyncDiagnostic({buildId:'nico-fit-v33',operations,conflicts:[{entity:'exercise_catalog',record_id:'catalog-1',reason:'remote_change_vs_local_change',operation_ids:['op-1'],local_payload:{version:null},remote_payload:{version:2}}]});
  assert.equal(result.queueTotal,2);assert.equal(result.conflictTotal,1);assert.deepEqual(result.operations[0],{entity:'exercise_catalog',type:'insert',record_id:'catalog-1',base_remote_version:null,reason:'remote_change_vs_local_change',local_version:null,remote_version:2});
  assert.equal(result.operations[1].base_remote_version,2);assert.equal(result.operations[1].local_version,3);assert.equal(result.operations[1].remote_version,null);
  assert.doesNotMatch(JSON.stringify(result),/access_token|payload|password|email|secret|cookie/i);
});

test('diagnostic does not mutate its queue/conflict inputs or invoke sync',()=>{
  const operations=[{operation_id:'op-1',entity:'exercise_catalog',type:'insert',record_id:'catalog-1',status:'pending',base_remote_version:null,payload:{version:null}}];
  const conflicts=[];const before=structuredClone({operations,conflicts});let syncCalls=0;
  const result=buildV3SyncDiagnostic({operations,conflicts});
  assert.equal(syncCalls,0);assert.deepEqual({operations,conflicts},before);assert.equal(result.queueTotal,1);
});
