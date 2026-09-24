import {isV3LocalStorageEnabled,isV3SyncEnabled} from './feature-flags.js';
import {refreshV3Rollout} from './rollout-state.js';
import {fetchPublicConfig} from './public-config.js';
import {ensureSupabaseSdk} from './auth-reconnect.js';
import {SupabaseV3Adapter} from './supabase-v3-adapter.js';
import {V3SyncEngine} from './sync-engine.js';

const STAGING_URL='https://tmydirzzlmlmtjgwqcgh.supabase.co';

export async function syncV3Repository(repository,{online=()=>globalThis.navigator?.onLine!==false,storageEnabled=()=>isV3LocalStorageEnabled(),syncEnabled=()=>isV3SyncEnabled(),refreshRollout=refreshV3Rollout,fetchConfig=()=>fetchPublicConfig(),loadSdk=()=>ensureSupabaseSdk(),Adapter=SupabaseV3Adapter,Engine=V3SyncEngine}={}){
  if(!repository)throw new Error('Falta el repositorio local V3.');
  if(!online())return {skipped:'offline'};
  if(!storageEnabled()||!syncEnabled())return {skipped:'disabled'};
  const rollout=await refreshRollout();
  if(!rollout||rollout.source!=='remote'||!rollout.remoteWritesAllowed)return {skipped:'rollout_blocked'};
  const config=await fetchConfig();
  if(config.url!==STAGING_URL)throw new Error('El sync V3 sólo puede usar nico-fit-v3-staging.');
  const sdk=await loadSdk();
  const client=sdk.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data,error}=await client.auth.getUser();
  if(error||!data?.user?.id)throw Object.assign(new Error('La sesión Auth no es válida para sincronizar.'),{status:401});
  if(data.user.id!==repository.userId)throw Object.assign(new Error('La sesión Auth no coincide con los datos locales V3.'),{status:401});
  const engine=new Engine({repository,remote:new Adapter({client}),featureEnabled:true,online});
  return engine.syncOnce();
}
