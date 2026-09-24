import {cachedPublicConfig,fetchPublicConfig} from './public-config.js';

const SDK_URL='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
let loadingSdk=null;

export async function ensureSupabaseSdk({windowLike=globalThis.window,documentLike=globalThis.document}={}){
  if(windowLike?.supabase?.createClient)return windowLike.supabase;
  if(!loadingSdk)loadingSdk=new Promise((resolve,reject)=>{
    const script=documentLike.createElement('script');script.src=SDK_URL;script.async=true;
    script.onload=()=>windowLike?.supabase?.createClient?resolve(windowLike.supabase):reject(new Error('No se pudo cargar Supabase Auth.'));
    script.onerror=()=>reject(new Error('No se pudo cargar Supabase Auth.'));
    documentLike.head.append(script);
  }).finally(()=>{loadingSdk=null;});
  return loadingSdk;
}

export async function reconnectV3Auth({sync,rollout,storage=globalThis.localStorage,fetchConfig=()=>fetchPublicConfig({storage}),loadSdk=()=>ensureSupabaseSdk()}={}){
  const state=await rollout.refresh({force:true});
  if(state.source!=='remote')return {status:'offline',user:null};
  let publicConfig;
  try{publicConfig=await fetchConfig();}catch{publicConfig=cachedPublicConfig(storage);}
  if(!publicConfig)return {status:'offline',user:null};
  const sdk=await loadSdk();
  return sync.reconnectAuth({config:publicConfig,createClient:sdk.createClient});
}
