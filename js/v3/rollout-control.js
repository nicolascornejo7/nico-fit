import {resolveRollout,validateRolloutConfig} from './rollout-policy.js';
import {installRolloutControl} from './rollout-state.js';

export const ROLLOUT_CACHE_KEY='nicoFit.rollout.config.v1';
export const DEFAULT_TTL_MS=60000;
const iso=now=>new Date(now).toISOString();
const readCache=(storage,key,now,ttl)=>{try{const row=JSON.parse(storage?.getItem(key)||'null');const fetchedAt=Date.parse(row?.fetchedAt);if(!Number.isFinite(fetchedAt)||fetchedAt>now)return null;return {config:validateRolloutConfig(row.config),fetchedAt:row.fetchedAt,fresh:now-fetchedAt<=ttl};}catch{return null;}};

export async function fetchRolloutConfig({fetchImpl=globalThis.fetch,timeoutMs=5000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const cfg=await fetchImpl('/api/config',{cache:'no-store',signal:controller.signal});if(!cfg.ok)throw new Error('Config pública no disponible.');
    const {url,publishableKey}=await cfg.json();if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||typeof publishableKey!=='string'||!publishableKey)throw new Error('Endpoint de rollout inválido.');
    const response=await fetchImpl(`${url}/rest/v1/rollout_config?select=*&singleton_id=eq.true`,{cache:'no-store',signal:controller.signal,headers:{apikey:publishableKey,'Accept-Profile':'nico_fit_v3'}});
    if(!response.ok)throw new Error('No se pudo leer el rollout remoto.');
    const rows=await response.json();if(!Array.isArray(rows)||rows.length!==1)throw new Error('Config de rollout ausente.');
    return validateRolloutConfig(rows[0]);
  }finally{clearTimeout(timer);}
}

export class V3RolloutControl{
  constructor({fetchConfig=()=>fetchRolloutConfig(),storage=globalThis.localStorage,buildId='unknown',now=Date.now,ttlMs=DEFAULT_TTL_MS,windowLike=globalThis.window,Channel=globalThis.BroadcastChannel,onChange=()=>{}}={}){
    Object.assign(this,{fetchConfig,storage,buildId,now,ttlMs,windowLike,Channel,onChange});
    this.config=null;this.source='fallback';this.lastValidAt=null;this.fallbackMinimum=null;this.nextFetchAt=0;this.pending=null;this.timer=null;this.channel=null;this.uninstall=null;
    this.onStorage=event=>{if(event.key===ROLLOUT_CACHE_KEY)this.consumeCache();};
  }
  snapshot(){return resolveRollout(this.config,{buildId:this.buildId,source:this.source,lastValidAt:this.lastValidAt,fallbackMinimum:this.fallbackMinimum,now:this.now()});}
  emit(){const state=this.snapshot();this.onChange(state);return state;}
  consumeCache(){const cached=readCache(this.storage,ROLLOUT_CACHE_KEY,this.now(),this.ttlMs);if(!cached)return false;
    if(this.config&&cached.config.config_version<this.config.config_version)return false;
    this.fallbackMinimum=cached.config.minimum_client_version;
    if(!cached.fresh){this.config=null;this.lastValidAt=cached.fetchedAt;this.source='fallback';this.emit();return false;}
    if(this.lastValidAt&&Date.parse(cached.fetchedAt)<Date.parse(this.lastValidAt))return false;
    this.config=cached.config;this.lastValidAt=cached.fetchedAt;this.source='cache';this.emit();return true;}
  async refresh({force=false}={}){
    if(this.pending)return this.pending;
    if(!force&&this.now()<this.nextFetchAt)return this.snapshot();
    this.pending=(async()=>{
      try{const config=validateRolloutConfig(await this.fetchConfig());if(this.config&&config.config_version<this.config.config_version)throw new Error('Versión de rollout obsoleta.');this.config=config;this.fallbackMinimum=config.minimum_client_version;this.source='remote';this.lastValidAt=iso(this.now());this.nextFetchAt=this.now()+this.ttlMs;
        try{this.storage?.setItem(ROLLOUT_CACHE_KEY,JSON.stringify({config,fetchedAt:this.lastValidAt}));}catch{}
        this.channel?.postMessage({type:'rollout-updated'});
      }catch{this.nextFetchAt=this.now()+Math.min(this.ttlMs,10000);if(!this.consumeCache()){this.config=null;this.source='fallback';}}
      return this.emit();
    })();try{return await this.pending;}finally{this.pending=null;}
  }
  async refreshIfDue(){if(this.lastValidAt&&this.now()-Date.parse(this.lastValidAt)>this.ttlMs){this.config=null;this.source='fallback';this.emit();}return this.refresh();}
  async start(){this.uninstall=installRolloutControl(this);this.consumeCache();this.windowLike?.addEventListener?.('storage',this.onStorage);
    if(this.Channel){this.channel=new this.Channel('nico-fit-rollout');this.channel.onmessage=()=>this.consumeCache();}
    await this.refresh({force:true});this.timer=setInterval(()=>this.refresh({force:true}),this.ttlMs);return this.snapshot();}
  stop(){clearInterval(this.timer);this.channel?.close();this.windowLike?.removeEventListener?.('storage',this.onStorage);this.uninstall?.();}
}
