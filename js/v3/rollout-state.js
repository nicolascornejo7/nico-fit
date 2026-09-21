let control=null;
export function installRolloutControl(value){control=value;return ()=>{if(control===value)control=null;};}
export function rolloutSnapshot(){return control?.snapshot()||null;}
export function rolloutFlag(name){const state=rolloutSnapshot();return state?!!state.flags[name]:null;}
export function rolloutBlocksNewWork(){return !!rolloutSnapshot()?.updateRequired;}
export async function rolloutAllowsRemote(){if(!control)return true;await control.refreshIfDue();return !!control.snapshot().remoteWritesAllowed;}
export async function rolloutAllowsLegacyRemote(){if(!control)return true;await control.refreshIfDue();const state=control.snapshot();return !state.updateRequired&&!state.maintenanceMode;}
