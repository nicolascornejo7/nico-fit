import {applyTombstones,dedupeBy,recordKeys,tombstoneKey,nowIso} from './store.js';
import {exerciseId} from './exercise-identity.js';
import {mayStartNewWork} from './pwa-update-gate.js';
import {rolloutAllowsLegacyRemote} from './v3/rollout-state.js';

const TABLES={readiness:'readiness',workouts:'workouts',matches:'match_reviews',football:'football_sessions',sessions:'workout_sessions'};
const PREVIEW_HOST='nico-ksdlbtnqm-cornejo1.vercel.app';
const PREVIEW_HOST_PATTERN=/^nico-[a-z0-9]+-cornejo1\.vercel\.app$/i;

export function authRedirectOrigin(locationLike=globalThis.window?.location){
  const origin=locationLike?.origin;
  const hostname=locationLike?.hostname?.toLowerCase();
  if(!origin||!hostname)throw new Error('No se pudo determinar el origen de autenticación.');
  if(hostname==='localhost'||hostname==='127.0.0.1'||hostname==='[::1]')return origin;
  if(hostname===PREVIEW_HOST||PREVIEW_HOST_PATTERN.test(hostname))return origin;
  throw new Error('Origen de autenticación no autorizado para este entorno.');
}

export class SyncService{
  constructor({getData,setData,onState}){
    this.getData=getData;this.setData=setData;this.onState=onState;this.client=null;this.user=null;
    this.busy=false;this.rerun=false;this.currentSync=null;this.lastState={kind:'local',text:'Solo local'};
  }
  state(kind,text){this.lastState={kind,text};this.onState?.(kind,text);}
  async init(){
    if(!window.supabase?.createClient)throw new Error('No se pudo cargar Supabase.');
    const r=await fetch('/api/config',{cache:'no-store'});if(!r.ok)throw new Error('No se pudo leer la configuración de Supabase.');
    const cfg=await r.json();
    this.client=window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data}=await this.client.auth.getSession();this.user=data.session?.user||null;this.onAuth?.(this.user);
    this.client.auth.onAuthStateChange((_event,session)=>{
      const expectedUser=session?.user||null;this.user=expectedUser;this.onAuth?.(expectedUser);
      // Supabase work must run after its auth callback releases the internal lock.
      if(expectedUser)setTimeout(()=>{if(this.user?.id===expectedUser.id)this.syncAll().catch(()=>{});},0);
    });
    return this.user;
  }
  async reconnectAuth({config,createClient}={}){
    if(!config?.url||!config?.publishableKey||typeof createClient!=='function')throw new Error('Auth no está configurado.');
    const client=this.client||createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    let session;
    try{
      const result=await client.auth.getSession();
      if(result.error)throw result.error;
      session=result.data?.session||null;
      if(session){
        const verified=await client.auth.getUser();
        if(verified.error)throw verified.error;
        if(!verified.data?.user?.id||verified.data.user.id!==session.user?.id)throw new Error('La identidad Auth no coincide con la sesión local.');
        if(!this.client){this.client=client;client.auth.onAuthStateChange((_event,next)=>{this.user=next?.user||null;this.onAuth?.(this.user);});}
        this.user=verified.data.user;this.onAuth?.(this.user);
        return {status:'authenticated',user:this.user};
      }
    }catch(error){
      if(![400,401,403].includes(Number(error?.status))&&!['AuthSessionMissingError','invalid_grant'].includes(error?.name)&&!['refresh_token_not_found','refresh_token_already_used'].includes(error?.code))throw error;
    }
    if(!this.client){this.client=client;client.auth.onAuthStateChange((_event,next)=>{this.user=next?.user||null;this.onAuth?.(this.user);});}
    this.user=null;this.onAuth?.(null);
    return {status:'login_required',user:null};
  }
  async signIn(email,password){if(!this.client?.auth)throw new Error('Sin conexión con Auth. Si ya iniciaste sesión, Entrenar V3 sigue disponible offline.');const {error}=await this.client.auth.signInWithPassword({email,password});if(error)throw error;}
  async signUp(email,password){if(!this.client?.auth)throw new Error('Sin conexión con Auth. Reintentá el registro cuando vuelva la red.');const {data,error}=await this.client.auth.signUp({email,password,options:{emailRedirectTo:authRedirectOrigin()}});if(error)throw error;return data;}
  async signOut(){await this.client?.auth.signOut();this.user=null;}
  async safeSelect(table,order='date'){
    const rows=[],pageSize=1000;
    for(let from=0;;from+=pageSize){
      const res=await this.client.from(table).select('*').order(order,{ascending:false}).range(from,from+pageSize-1);
      if(res.error&&(res.error.code==='42P01'||String(res.error.message).includes('does not exist')))return [];
      if(res.error)throw res.error;rows.push(...(res.data||[]));if((res.data||[]).length<pageSize)return rows;
    }
  }
  remoteToLocal(r){return {
    readiness:r.readiness.map(x=>({date:x.date,sleep:x.sleep,energy:x.energy,fatigue:x.fatigue,pain:x.pain,painArea:x.pain_area||'',updatedAt:x.updated_at})),
    workouts:r.workouts.map(x=>({date:x.date,day:x.day,exerciseId:exerciseId(x.exercise),exercise:x.exercise,sets:x.sets||[],updatedAt:x.updated_at})),
    matches:r.matches.map(x=>({date:x.date,energy:x.energy,legs:x.legs,performance:x.performance,notes:x.notes||'',updatedAt:x.updated_at})),
    football:r.football.map(x=>({date:x.date,type:x.session_type,duration:+x.duration_minutes,rpe:+x.rpe,minutes:+(x.minutes_played||0),notes:x.notes||'',updatedAt:x.updated_at})),
    sessions:r.sessions.map(x=>({date:x.date,day:x.day,label:x.label,startedAt:x.started_at,endedAt:x.ended_at,duration:+(x.duration_minutes||0),rpe:+(x.rpe||0),notes:x.notes||'',updatedAt:x.updated_at})),
    tombstones:r.tombstones.map(x=>({entity:x.entity,recordKey:x.record_key,deletedAt:x.deleted_at}))
  };}
  async pull(){
    const [readiness,workouts,matches,football,sessions,tombstones]=await Promise.all([
      this.safeSelect('readiness'),this.safeSelect('workouts'),this.safeSelect('match_reviews'),this.safeSelect('football_sessions'),this.safeSelect('workout_sessions'),this.safeSelect('sync_tombstones','deleted_at')
    ]);return this.remoteToLocal({readiness,workouts,matches,football,sessions,tombstones});
  }
  merge(a,b){return applyTombstones({
    readiness:dedupeBy([...a.readiness,...b.readiness],recordKeys.readiness),workouts:dedupeBy([...a.workouts,...b.workouts],recordKeys.workouts),
    matches:dedupeBy([...a.matches,...b.matches],recordKeys.matches),football:dedupeBy([...a.football,...b.football],recordKeys.football),
    sessions:dedupeBy([...a.sessions,...b.sessions],recordKeys.sessions),tombstones:dedupeBy([...(a.tombstones||[]),...(b.tombstones||[])],tombstoneKey)
  });}
  async upsert(table,rows,onConflict){if(!rows.length)return;const {error}=await this.client.from(table).upsert(rows,{onConflict});if(error)throw error;}
  async purge(tombstones,userId){
    const deleteAll=tombstones.filter(t=>t.entity==='*').sort((a,b)=>Date.parse(b.deletedAt)-Date.parse(a.deletedAt))[0];
    if(deleteAll){
      for(const table of Object.values(TABLES)){
        const {error}=await this.client.from(table).delete().eq('user_id',userId).lte('updated_at',deleteAll.deletedAt);if(error)throw error;
      }
    }
    for(const t of tombstones){
      const table=TABLES[t.entity];if(!table)continue;
      let query=this.client.from(table).delete().eq('user_id',userId);const key=t.recordKey.startsWith('[')?JSON.parse(t.recordKey):t.recordKey;
      if(t.entity==='readiness'||t.entity==='matches')query=query.eq('date',key);
      if(t.entity==='workouts')query=query.eq('date',key[0]).eq('exercise',key[1]);
      if(t.entity==='football')query=query.eq('date',key[0]).eq('session_type',key[1]);
      if(t.entity==='sessions')query=query.eq('date',key[0]).eq('label',key[1]);
      const {error}=await query;if(error)throw error;
    }
  }
  async push(input,uid=this.user.id){
    const data=applyTombstones(input);
    await this.upsert('sync_tombstones',data.tombstones.map(x=>({user_id:uid,entity:x.entity,record_key:x.recordKey,deleted_at:x.deletedAt})),'user_id,entity,record_key');
    await this.purge(data.tombstones,uid);
    await Promise.all([
      this.upsert('readiness',data.readiness.map(x=>({user_id:uid,date:x.date,sleep:+x.sleep,energy:+x.energy,fatigue:+x.fatigue,pain:+x.pain,pain_area:x.painArea||'',updated_at:x.updatedAt||nowIso()})),'user_id,date'),
      this.upsert('workouts',data.workouts.map(x=>({user_id:uid,date:x.date,day:x.day,exercise:x.exercise,sets:x.sets||[],updated_at:x.updatedAt||nowIso()})),'user_id,date,exercise'),
      this.upsert('match_reviews',data.matches.map(x=>({user_id:uid,date:x.date,energy:+x.energy,legs:+x.legs,performance:+x.performance,notes:x.notes||'',updated_at:x.updatedAt||nowIso()})),'user_id,date'),
      this.upsert('football_sessions',data.football.map(x=>({user_id:uid,date:x.date,session_type:x.type,duration_minutes:+x.duration,rpe:+x.rpe,minutes_played:+(x.minutes||0),notes:x.notes||'',updated_at:x.updatedAt||nowIso()})),'user_id,date,session_type'),
      this.upsert('workout_sessions',data.sessions.map(x=>({user_id:uid,date:x.date,day:x.day,label:x.label,started_at:x.startedAt||null,ended_at:x.endedAt||null,duration_minutes:+(x.duration||0),rpe:+(x.rpe||0),notes:x.notes||'',updated_at:x.updatedAt||nowIso()})),'user_id,date,label')
    ]);
  }
  async runSync(){
    const userId=this.user.id;this.busy=true;this.state('pending','Sincronizando…');
    try{
      do{
        this.rerun=false;if(!await rolloutAllowsLegacyRemote()){this.state('pending','Sincronización pausada por configuración remota');return false;}
        const remote=await this.pull();if(this.user?.id!==userId)return false;
        const merged=this.merge(this.getData(),remote);this.setData(merged);
        if(!await rolloutAllowsLegacyRemote()){this.state('pending','Sincronización pausada por configuración remota');return false;}
        await this.push(merged,userId);
        const confirmed=await this.pull();if(this.user?.id!==userId)return false;this.setData(this.merge(this.getData(),confirmed));
      }while(this.rerun);
      this.state('synced','Sincronizado');return true;
    }catch(e){console.error(e);this.state('pending','Pendiente de sincronizar');throw e;}
    finally{this.busy=false;this.currentSync=null;}
  }
  async syncAll(){
    if(!mayStartNewWork()){this.state('pending','Actualización requerida; sincronización pausada');return false;}
    if(!await rolloutAllowsLegacyRemote()){this.state('pending','Sincronización pausada por configuración remota');return false;}
    if(!this.client||!this.user||!navigator.onLine){this.state(this.user?'pending':'local',this.user?'Pendiente de sincronizar':'Solo local');return false;}
    if(this.busy){this.rerun=true;return this.currentSync;}this.currentSync=this.runSync();return this.currentSync;
  }
  async syncRecord(){return this.syncAll();}
  async deleteRecord(entity,item){
    const keyFn=recordKeys[entity];if(!keyFn)throw new Error(`Entidad no sincronizable: ${entity}`);
    const marker={entity,recordKey:keyFn(item),deletedAt:nowIso()},current=this.getData();
    this.setData(applyTombstones({...current,tombstones:[...(current.tombstones||[]),marker]}));return this.syncAll();
  }
  async deleteAll(){
    const deletedAt=nowIso(),marker={entity:'*',recordKey:deletedAt,deletedAt},current=this.getData();
    this.setData(applyTombstones({...current,tombstones:[...(current.tombstones||[]),marker]}));return this.syncAll();
  }
}
