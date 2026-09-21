let mode='normal';
export function updateGateMode(){return mode;}
export function setUpdateGateMode(next){if(!['normal','transition','stale'].includes(next))throw new Error('Estado PWA inválido.');mode=next;}
export function mayStartNewWork(){return mode==='normal';}
