let control=null;
export function installRolloutControl(value){control=value;return ()=>{if(control===value)control=null;};}
export function rolloutSnapshot(){return control?.snapshot()||null;}
export function rolloutFlag(name){const state=rolloutSnapshot();return state?!!state.flags[name]:null;}
export function rolloutBlocksNewWork(){return !!rolloutSnapshot()?.updateRequired;}
// Maintenance pauses only remote operations. Local V3 training remains usable
// while the minimum-client guard and explicit local feature flags still apply.
export function rolloutAllowsLocalTraining(){
  const state=rolloutSnapshot();
  return !!state&&!state.updateRequired&&state.flags.v3_enabled&&state.flags.v3_storage_enabled&&state.flags.v3_training_enabled;
}
export async function rolloutAllowsRemote(){if(!control)return true;await control.refreshIfDue();return !!control.snapshot().remoteWritesAllowed;}
export async function refreshV3Rollout(){if(!control)return null;return control.refresh({force:true});}
export async function rolloutAllowsLegacyRemote(){if(!control)return true;await control.refreshIfDue();const state=control.snapshot();return !state.updateRequired&&!state.maintenanceMode;}
