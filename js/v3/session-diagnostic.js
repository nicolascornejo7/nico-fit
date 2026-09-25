const clone=value=>structuredClone(value);

export function buildV3SessionDiagnostic({sessions=[],trainingState=null,uiState=null,buildId='unknown',now=()=>new Date()}={}){
  const checkpointId=trainingState?.activeSessionId??null,uiActiveId=uiState?.activeSessionId??null;
  const rows=clone(sessions).sort((a,b)=>String(b.started_at??'').localeCompare(String(a.started_at??''))).map(session=>{
    const discarded=!!session.deleted_at,matchesCheckpoint=!discarded&&session.id===checkpointId;
    const uiConsidersActive=!discarded&&session.status==='draft'&&session.id===uiActiveId;
    let timerReason='not_running';
    if(discarded)timerReason='soft_deleted_tombstone_not_active';
    else if(uiConsidersActive)timerReason='ui_active_draft_elapsed_from_started_at';
    else if(session.status==='completed')timerReason='completed_uses_persisted_duration';
    else if(session.status==='draft'&&matchesCheckpoint)timerReason='checkpoint_draft_not_loaded_in_ui';
    else if(session.status==='draft')timerReason='orphan_draft_requires_explicit_recovery';
    return {id:session.id,status:session.status??null,started_at:session.started_at??null,ended_at:session.ended_at??null,duration_seconds:session.duration_seconds??null,updated_at:session.updated_at??null,deleted_at:session.deleted_at??null,matches_training_state:matchesCheckpoint,ui_considers_active:uiConsidersActive,timer_running:uiConsidersActive,timer_reason:timerReason};
  });
  return {schemaVersion:1,build:String(buildId),exportedAt:new Date(now()).toISOString(),training_state:{activeSessionId:checkpointId,checkpoint_exists:!!trainingState,draft_entry_count:Object.keys(trainingState?.drafts??{}).length},counts:{total:rows.length,draft:rows.filter(row=>!row.deleted_at&&row.status==='draft').length,completed:rows.filter(row=>!row.deleted_at&&row.status==='completed').length,discarded:rows.filter(row=>row.deleted_at).length},sessions:rows};
}
