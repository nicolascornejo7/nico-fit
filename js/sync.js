import {dedupeBy,workoutKey,nowIso} from './store.js';
export class SyncService{
  constructor({getData,setData,onState}){this.getData=getData;this.setData=setData;this.onState=onState;this.client=null;this.user=null;this.busy=false;}
  state(kind,text){this.onState?.(kind,text);}
  async init(){
    if(!window.supabase?.createClient) throw new Error('No se pudo cargar Supabase.');
    const r=await fetch('/api/config',{cache:'no-store'}); if(!r.ok) throw new Error('No se pudo leer la configuración de Supabase.');
    const cfg=await r.json();
    this.client=window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data}=await this.client.auth.getSession(); this.user=data.session?.user||null;
    this.client.auth.onAuthStateChange(async(_event,session)=>{this.user=session?.user||null;this.onAuth?.(this.user);if(this.user)await this.syncAll();});
    return this.user;
  }
  async signIn(email,password){const {error}=await this.client.auth.signInWithPassword({email,password});if(error)throw error;}
  async signUp(email,password){const {data,error}=await this.client.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}});if(error)throw error;return data;}
  async signOut(){await this.client?.auth.signOut();this.user=null;}
  async safeSelect(table,order='date'){
    const res=await this.client.from(table).select('*').order(order,{ascending:false});
    if(res.error && (res.error.code==='42P01'||String(res.error.message).includes('does not exist'))) return [];
    if(res.error) throw res.error; return res.data||[];
  }
  remoteToLocal(r){return {
    readiness:r.readiness.map(x=>({date:x.date,sleep:x.sleep,energy:x.energy,fatigue:x.fatigue,pain:x.pain,painArea:x.pain_area||'',updatedAt:x.updated_at})),
    workouts:r.workouts.map(x=>({date:x.date,day:x.day,exercise:x.exercise,sets:x.sets||[],updatedAt:x.updated_at})),
    matches:r.matches.map(x=>({date:x.date,energy:x.energy,legs:x.legs,performance:x.performance,notes:x.notes||'',updatedAt:x.updated_at})),
    football:r.football.map(x=>({date:x.date,type:x.session_type,duration:+x.duration_minutes,rpe:+x.rpe,minutes:+(x.minutes_played||0),notes:x.notes||'',updatedAt:x.updated_at})),
    sessions:r.sessions.map(x=>({date:x.date,day:x.day,label:x.label,startedAt:x.started_at,endedAt:x.ended_at,duration:+(x.duration_minutes||0),rpe:+(x.rpe||0),notes:x.notes||'',updatedAt:x.updated_at}))
  };}
  async pull(){
    const [readiness,workouts,matches,football,sessions]=await Promise.all([
      this.safeSelect('readiness'),this.safeSelect('workouts'),this.safeSelect('match_reviews'),this.safeSelect('football_sessions'),this.safeSelect('workout_sessions')
    ]);return this.remoteToLocal({readiness,workouts,matches,football,sessions});
  }
  merge(a,b){return {
    readiness:dedupeBy([...a.readiness,...b.readiness],x=>x.date),workouts:dedupeBy([...a.workouts,...b.workouts],workoutKey),matches:dedupeBy([...a.matches,...b.matches],x=>x.date),
    football:dedupeBy([...a.football,...b.football],x=>`${x.date}::${x.type}`),sessions:dedupeBy([...a.sessions,...b.sessions],x=>`${x.date}::${x.label}`)
  };}
  async upsert(table,rows,onConflict){if(!rows.length)return;const {error}=await this.client.from(table).upsert(rows,{onConflict});if(error && !String(error.message).includes('does not exist'))throw error;}
  async push(data){const uid=this.user.id;
    await Promise.all([
      this.upsert('readiness',dedupeBy(data.readiness,x=>x.date).map(x=>({user_id:uid,date:x.date,sleep:+x.sleep,energy:+x.energy,fatigue:+x.fatigue,pain:+x.pain,pain_area:x.painArea||'',updated_at:x.updatedAt||nowIso()})),'user_id,date'),
      this.upsert('workouts',dedupeBy(data.workouts,workoutKey).map(x=>({user_id:uid,date:x.date,day:x.day,exercise:x.exercise,sets:x.sets||[],updated_at:x.updatedAt||nowIso()})),'user_id,date,exercise'),
      this.upsert('match_reviews',dedupeBy(data.matches,x=>x.date).map(x=>({user_id:uid,date:x.date,energy:+x.energy,legs:+x.legs,performance:+x.performance,notes:x.notes||'',updated_at:x.updatedAt||nowIso()})),'user_id,date'),
      this.upsert('football_sessions',dedupeBy(data.football,x=>`${x.date}::${x.type}`).map(x=>({user_id:uid,date:x.date,session_type:x.type,duration_minutes:+x.duration,rpe:+x.rpe,minutes_played:+(x.minutes||0),notes:x.notes||'',updated_at:x.updatedAt||nowIso()})),'user_id,date,session_type'),
      this.upsert('workout_sessions',dedupeBy(data.sessions,x=>`${x.date}::${x.label}`).map(x=>({user_id:uid,date:x.date,day:x.day,label:x.label,started_at:x.startedAt||null,ended_at:x.endedAt||null,duration_minutes:+(x.duration||0),rpe:+(x.rpe||0),notes:x.notes||'',updated_at:x.updatedAt||nowIso()})),'user_id,date,label')
    ]);
  }
  async syncAll(){if(!this.client||!this.user||!navigator.onLine||this.busy)return;this.busy=true;this.state('pending','Sincronizando…');try{const remote=await this.pull();const merged=this.merge(this.getData(),remote);this.setData(merged);await this.push(merged);const final=await this.pull();this.setData(final);this.state('synced','Sincronizado');}catch(e){console.error(e);this.state('pending','Pendiente');throw e;}finally{this.busy=false;}}
  async syncRecord(table,payload,onConflict){if(!this.user||!navigator.onLine)return;const {error}=await this.client.from(table).upsert({...payload,user_id:this.user.id},{onConflict});if(error)throw error;}
  async resetRemote(){if(!this.user||!navigator.onLine)return;for(const table of ['readiness','workouts','match_reviews','football_sessions','workout_sessions']){const {error}=await this.client.from(table).delete().eq('user_id',this.user.id);if(error && !String(error.message).includes('does not exist'))throw error;}}
}
