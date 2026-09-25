export const PUBLIC_CONFIG_CACHE_KEY='nicoFit.v3.publicConfig.v1';

export function validatePublicConfig(value){
  if(!value||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value.url)||typeof value.publishableKey!=='string'||!value.publishableKey||/^(?:sb_secret_|service_role)/i.test(value.publishableKey))throw new Error('Configuración pública inválida.');
  return {url:value.url,publishableKey:value.publishableKey};
}

export function cachedPublicConfig(storage=globalThis.localStorage){
  try{return validatePublicConfig(JSON.parse(storage?.getItem(PUBLIC_CONFIG_CACHE_KEY)||'null'));}catch{return null;}
}

export async function fetchPublicConfig({fetchImpl=globalThis.fetch,storage=globalThis.localStorage,signal}={}){
  const response=await fetchImpl('/api/config',{cache:'no-store',signal});
  if(!response.ok)throw new Error('Config pública no disponible.');
  const config=validatePublicConfig(await response.json());
  try{storage?.setItem(PUBLIC_CONFIG_CACHE_KEY,JSON.stringify(config));}catch{}
  return config;
}
