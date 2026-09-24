import test from 'node:test';
import assert from 'node:assert/strict';
import {buildV3SessionDiagnostic} from '../js/v3/session-diagnostic.js';

test('session diagnostic distinguishes completed, active and orphan drafts without mutating input',()=>{
  const sessions=[
    {id:'completed',status:'completed',started_at:'2026-09-24T10:00:00Z',ended_at:'2026-09-24T11:00:00Z',duration_seconds:3600,updated_at:'2026-09-24T11:00:00Z'},
    {id:'active',status:'draft',started_at:'2026-09-24T12:00:00Z',ended_at:null,duration_seconds:null,updated_at:'2026-09-24T12:00:00Z'},
    {id:'orphan',status:'draft',started_at:'2026-09-23T12:00:00Z',ended_at:null,duration_seconds:null,updated_at:'2026-09-23T12:00:00Z'}
  ],before=structuredClone(sessions),trainingState={activeSessionId:'active',drafts:{'set:new':{reps:'8'}}};
  const result=buildV3SessionDiagnostic({sessions,trainingState,uiState:{activeSessionId:'active'},buildId:'nico-fit-v41',now:()=>new Date('2026-09-24T15:00:00Z')});
  assert.deepEqual(sessions,before);assert.deepEqual(result.counts,{total:3,draft:2,completed:1,discarded:0});assert.equal(result.training_state.activeSessionId,'active');assert.equal(result.training_state.draft_entry_count,1);
  assert.equal(result.sessions.find(row=>row.id==='active').timer_reason,'ui_active_draft_elapsed_from_started_at');assert.equal(result.sessions.find(row=>row.id==='orphan').timer_reason,'orphan_draft_requires_explicit_recovery');assert.equal(result.sessions.find(row=>row.id==='completed').timer_running,false);
  assert.doesNotMatch(JSON.stringify(result),/notes|email|token|payload|password/i);
});

test('session diagnostic reports an empty checkpoint without side effects',()=>{
  const result=buildV3SessionDiagnostic({sessions:[],buildId:'nico-fit-v41'});
  assert.equal(result.training_state.checkpoint_exists,false);assert.deepEqual(result.counts,{total:0,draft:0,completed:0,discarded:0});assert.deepEqual(result.sessions,[]);
});

test('a soft-deleted draft is reported as discarded and never active',()=>{
  const result=buildV3SessionDiagnostic({sessions:[{id:'discarded',status:'draft',deleted_at:'2026-09-24T12:00:00Z'}],trainingState:{activeSessionId:'discarded'}});
  assert.deepEqual(result.counts,{total:1,draft:0,completed:0,discarded:1});assert.equal(result.sessions[0].timer_running,false);assert.equal(result.sessions[0].timer_reason,'soft_deleted_tombstone_not_active');assert.equal(result.sessions[0].matches_training_state,false);
});
