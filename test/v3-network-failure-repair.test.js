import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3SyncEngine} from '../js/v3/sync-engine.js';
import {classifySyncError,isNetworkError,remotePayloadForOperation} from '../js/v3/sync-protocol.js';
import {SupabaseV3Adapter} from '../js/v3/supabase-v3-adapter.js';
import {failureReason} from '../js/v3/observability-service.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// supabase-js result for a dropped connection on iPhone Safari.
const DROPPED={error:{message:'TypeError: Load failed',details:'',hint:'',code:''},data:null,status:0,statusText:''};

class Remote{
  constructor(){this.rows=new Map();this.drop=false;this.mutations=0;}
  async authenticatedUserId(){return USER;}
  async fetchChanges(){return [];}
  async fetchById(_entity,id){return this.rows.has(id)?structuredClone(this.rows.get(id)):null;}
  async mutate(operation,userId){
    this.mutations++;
    if(this.drop)throw Object.assign(new Error(DROPPED.error.message),DROPPED.error,{status:0});
    if(this.rows.has(operation.record_id))throw Object.assign(new Error('duplicate key value violates unique constraint "workout_sessions_pkey"'),{code:'23505',status:409});
    const payload=remotePayloadForOperation(operation,userId),row={created_at:'2026-11-16T17:34:59.000Z',updated_at:'2026-11-16T17:34:59.000Z',deleted_at:null,...payload,version:1};
    this.rows.set(row.id,row);return structuredClone(row);
  }
}
const open=()=>V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
const session=repository=>repository.create('workout_sessions',{session_date:'2026-11-16',label:'Lunes sin equipo',session_type:'free_workout',status:'draft',started_at:'2026-11-16T17:00:00.000Z',ended_at:null,duration_seconds:null,rpe:null,notes:''});

test('a dropped connection reported by supabase-js is transient, not permanent',async()=>{
  assert.equal(classifySyncError(Object.assign(new Error('TypeError: Load failed'),{code:'',status:0})),'transient');
  assert.equal(classifySyncError(new Error('TypeError: Failed to fetch')),'transient');
  assert.equal(isNetworkError({message:'duplicate key value'}),false);
  assert.equal(classifySyncError({message:'new row violates check constraint',code:'23514',status:400}),'permanent');
  const query={insert:()=>({select:()=>({single:async()=>DROPPED})})};
  const adapter=new SupabaseV3Adapter({client:{schema:()=>({from:()=>query})}});
  const repository=await open();
  try{
    await session(repository);const [operation]=await repository.listOperations();
    await assert.rejects(adapter.mutate(operation,USER),error=>error.status===0&&classifySyncError(error)==='transient');
  }finally{repository.close();}
});

test('a new network drop leaves the operation retryable with backoff instead of blocked',async()=>{
  const repository=await open(),remote=new Remote();
  try{
    await session(repository);remote.drop=true;
    const engine=new V3SyncEngine({repository,remote,featureEnabled:true,locks:null,random:()=>0.5});
    await engine.syncOnce();
    const [operation]=await repository.listOperations();
    assert.equal(operation.status,'failed');assert.ok(operation.next_attempt_at,'scheduled for retry');
  }finally{repository.close();}
});

for(const alreadyOnServer of [false,true]){
  test(`an operation blocked by a pre-v79 network drop is resent (${alreadyOnServer?'server already had it':'server never got it'})`,async()=>{
    const repository=await open(),remote=new Remote();
    try{
      const row=await session(repository);const [operation]=await repository.listOperations();
      // Legacy state: permanent failure with no retry date.
      await repository.setOperationStatus(operation.operation_id,'failed',{error:'TypeError: Load failed',nextAttemptAt:null});
      if(alreadyOnServer)remote.rows.set(row.id,{created_at:'2026-11-16T17:34:59.000Z',updated_at:'2026-11-16T17:34:59.000Z',deleted_at:null,...remotePayloadForOperation(operation,USER),version:1});
      const result=await new V3SyncEngine({repository,remote,featureEnabled:true,locks:null}).syncOnce();
      assert.equal(result.requeued,1);
      const [after]=await repository.listOperations();
      assert.equal(after.status,'synced');assert.equal(remote.rows.size,1);
      assert.equal((await repository.operationalSnapshot()).counts.failed,0);
    }finally{repository.close();}
  });
}

test('other permanent failures stay blocked and diagnostics expose only a safe reason',async()=>{
  const repository=await open(),remote=new Remote();
  try{
    await session(repository);const [operation]=await repository.listOperations();
    await repository.setOperationStatus(operation.operation_id,'failed',{error:'invalid prescription SECRET_TOKEN',nextAttemptAt:null});
    const result=await new V3SyncEngine({repository,remote,featureEnabled:true,locks:null}).syncOnce();
    assert.equal(result.requeued,0);assert.equal((await repository.listOperations())[0].status,'failed');
  }finally{repository.close();}
  assert.equal(failureReason('TypeError: Load failed'),'network');
  assert.equal(failureReason('insert or update on table "routine_exercises" violates foreign key constraint "routine_exercises_exercise_catalog_id_fkey" token=abc'),'foreign_key');
  assert.equal(failureReason('new row for relation "x" violates check constraint "exercise_sets_rir_check" user@mail'),'check:exercise_sets_rir_check');
  assert.equal(failureReason('exercise must match complete version snapshot'),'exercise must match complete version snapshot');
  assert.equal(failureReason('SECRET_TOKEN something else'),'unknown');assert.equal(failureReason(null),null);
});
