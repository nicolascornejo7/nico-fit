export const V3_LOCAL_STORAGE_FLAG='nicoFit.v3.localStorage.enabled';
export const V3_SYNC_FLAG='nicoFit.v3.sync.enabled';
export const V3_TRAINING_FLAG='v3.training.enabled';
export const V3_COACH_FLAG='v3.coach.enabled';
export const V3_CONFLICT_UI_FLAG='v3.conflicts.enabled';
export const V3_OBSERVABILITY_FLAG='v3.observability.enabled';
export const V3_AUDIT_FLAG='v3.audit.enabled';
export const V3_ROUTINES_FLAG='v3.routines.enabled';
export const V3_ROUTINES_SYNC_FLAG='v3.routines.sync.enabled';
export function isV3RoutinesEnabled(storage=globalThis.localStorage){return enabled('v3_routines_enabled',V3_ROUTINES_FLAG,storage);}
export function isV3RoutinesSyncEnabled(storage=globalThis.localStorage){return remoteSyncEnabled('v3_routines_enabled',V3_ROUTINES_SYNC_FLAG,storage);}
export function isV3ObservabilityEnabled(storage=globalThis.localStorage){return enabled('v3_observability_enabled',V3_OBSERVABILITY_FLAG,storage);}
export function isV3AuditEnabled(storage=globalThis.localStorage){try{return storage?.getItem(V3_AUDIT_FLAG)==='true';}catch{return false;}}
export function isV3ConflictsEnabled(storage=globalThis.localStorage){return enabled('v3_conflicts_enabled',V3_CONFLICT_UI_FLAG,storage);}
export const V3_BRIDGE_FLAG='v3.signals.enabled';
export const V3_BRIDGE_SYNC_FLAG='v3.signals.sync.enabled';
export function isV3SignalsEnabled(storage=globalThis.localStorage){return enabled('v3_signals_enabled',V3_BRIDGE_FLAG,storage);}
export function isV3SignalsSyncEnabled(storage=globalThis.localStorage){return remoteSyncEnabled('v3_signals_enabled',V3_BRIDGE_SYNC_FLAG,storage);}
export function isV3CoachEnabled(storage=globalThis.localStorage){
  return enabled('v3_coach_enabled',V3_COACH_FLAG,storage);
}
export function setV3CoachEnabled(enabled,storage=globalThis.localStorage){
  if(!storage)throw new Error('Feature flag storage is unavailable.');
  if(enabled)storage.setItem(V3_COACH_FLAG,'true');else storage.removeItem(V3_COACH_FLAG);
  return !!enabled;
}

export function isV3TrainingEnabled(storage=globalThis.localStorage){
  return enabled('v3_training_enabled',V3_TRAINING_FLAG,storage);
}

export function setV3TrainingEnabled(enabled,storage=globalThis.localStorage){
  if(!storage)throw new Error('Feature flag storage is unavailable.');
  if(enabled)storage.setItem(V3_TRAINING_FLAG,'true');else storage.removeItem(V3_TRAINING_FLAG);
  return !!enabled;
}

export function isV3LocalStorageEnabled(storage=globalThis.localStorage){
  return enabled('v3_storage_enabled',V3_LOCAL_STORAGE_FLAG,storage);
}

export function setV3LocalStorageEnabled(enabled,storage=globalThis.localStorage){
  if(!storage)throw new Error('Feature flag storage is unavailable.');
  if(enabled)storage.setItem(V3_LOCAL_STORAGE_FLAG,'true');
  else storage.removeItem(V3_LOCAL_STORAGE_FLAG);
  return !!enabled;
}

export function isV3SyncEnabled(storage=globalThis.localStorage){
  return enabled('v3_sync_enabled',V3_SYNC_FLAG,storage);
}

export function setV3SyncEnabled(enabled,storage=globalThis.localStorage){
  if(!storage)throw new Error('Feature flag storage is unavailable.');
  if(enabled)storage.setItem(V3_SYNC_FLAG,'true');
  else storage.removeItem(V3_SYNC_FLAG);
  return !!enabled;
}
import {rolloutFlag,rolloutRemoteSyncFlag} from './rollout-state.js';
const localEnabled=(name,storage)=>{try{return storage?.getItem(name)==='true';}catch{return false;}};
const enabled=(remoteName,localName,storage)=>{const remote=rolloutFlag(remoteName);return remote!==null?remote:localEnabled(localName,storage);};
const remoteSyncEnabled=(remoteName,localName,storage)=>{const remote=rolloutRemoteSyncFlag(remoteName);return remote!==null?remote:localEnabled(localName,storage);};
