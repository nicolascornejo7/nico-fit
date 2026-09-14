export const V3_LOCAL_STORAGE_FLAG='nicoFit.v3.localStorage.enabled';

export function isV3LocalStorageEnabled(storage=globalThis.localStorage){
  try{return storage?.getItem(V3_LOCAL_STORAGE_FLAG)==='true';}catch{return false;}
}

export function setV3LocalStorageEnabled(enabled,storage=globalThis.localStorage){
  if(!storage)throw new Error('Feature flag storage is unavailable.');
  if(enabled)storage.setItem(V3_LOCAL_STORAGE_FLAG,'true');
  else storage.removeItem(V3_LOCAL_STORAGE_FLAG);
  return !!enabled;
}
