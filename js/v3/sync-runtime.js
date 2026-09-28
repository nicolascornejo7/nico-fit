import {isV3LocalStorageEnabled,isV3SyncEnabled} from './feature-flags.js';
import {refreshV3Rollout} from './rollout-state.js';
import {fetchPublicConfig} from './public-config.js';
import {ensureSupabaseSdk} from './auth-reconnect.js';
import {SupabaseV3Adapter} from './supabase-v3-adapter.js';
import {V3SyncEngine} from './sync-engine.js';
import {assertAuthorizedV3Url} from './authorized-projects.js';
import {configureV3Observability} from './observability-runtime.js';

export function assertAuthorizedSyncUrl(value){
  try{return assertAuthorizedV3Url(value);}catch(error){throw new Error(error.message.replace('destino V3','destino de sync V3'));}
}

export async function prepareV3SyncRuntime(repository,{online=()=>globalThis.navigator?.onLine!==false,storageEnabled=()=>isV3LocalStorageEnabled(),syncEnabled=()=>isV3SyncEnabled(),refreshRollout=refreshV3Rollout,fetchConfig=()=>fetchPublicConfig(),loadSdk=()=>ensureSupabaseSdk(),Adapter=SupabaseV3Adapter,Engine=V3SyncEngine,register=configureV3Observability}={}){
  if(!repository)throw new Error('Falta el repositorio local V3.');
  if(!online())return {skipped:'offline'};
  if(!storageEnabled()||!syncEnabled())return {skipped:'disabled'};
  const rollout=await refreshRollout();
  if(!rollout||rollout.source!=='remote'||!rollout.remoteWritesAllowed)return {skipped:'rollout_blocked'};
  const config=await fetchConfig();
  const syncUrl=assertAuthorizedSyncUrl(config.url);
  const sdk=await loadSdk();
  const client=sdk.createClient(syncUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data,error}=await client.auth.getUser();
  if(error||!data?.user?.id)throw Object.assign(new Error('La sesión Auth no es válida para sincronizar.'),{status:401});
  if(data.user.id!==repository.userId)throw Object.assign(new Error('La sesión Auth no coincide con los datos locales V3.'),{status:401});
  const engine=new Engine({repository,remote:new Adapter({client}),featureEnabled:true,online});
  const unregister=engine?.remote?.client?register?.({userId:repository.userId,engine})??null:null;
  return {engine,client,unregister};
}

export async function syncV3Repository(repository,options={}){
  const runtime=await prepareV3SyncRuntime(repository,options);
  if(runtime.skipped)return runtime;
  return runtime.engine.syncOnce();
}
