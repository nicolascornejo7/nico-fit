const plan = {
  1:{name:'Lunes',type:'Fútbol',label:'Entrenamiento con el equipo',intensity:'Media/Alta',exercises:[]},
  2:{name:'Martes',type:'Gimnasio',label:'Fuerza principal',intensity:'Alta',exercises:[
    ['Sentadilla o prensa','3–4 × 5–8'],['Peso muerto rumano','3 × 6–8'],['Press banca','3 × 6–10'],['Dominadas o jalón','3 × 6–10'],['Zancada búlgara','3 × 8 por pierna'],['Elevación de gemelos','3 × 10–15'],['Plancha / Pallof press','3 × 30–45 s']
  ]},
  3:{name:'Miércoles',type:'Fútbol',label:'Práctica amistosa F11',intensity:'Alta',exercises:[]},
  4:{name:'Jueves',type:'Gimnasio',label:'Tren superior + prevención',intensity:'Media',exercises:[
    ['Press inclinado con mancuernas','3 × 8–12'],['Remo','3 × 8–12'],['Press militar','3 × 8–10'],['Dominadas / jalón','3 × 8–12'],['Curl femoral','2–3 × 8–12'],['Copenhagen plank','2–3 × 20–30 s por lado'],['Nordic curl','2 × 4–6'],['Core','2–3 series']
  ]},
  5:{name:'Viernes',type:'Gimnasio',label:'Activación prepartido',intensity:'Baja',exercises:[
    ['Movilidad tobillo/cadera/aductores','5–8 min'],['Sentadilla ligera','2 × 5'],['Peso muerto rumano ligero','2 × 6'],['Saltos verticales','3 × 3'],['Press banca ligero','2–3 × 5'],['Remo','2 × 8'],['Gemelos','2 × 10'],['Core','2 series']
  ]},
  6:{name:'Sábado',type:'Partido',label:'Partido Fútbol 11',intensity:'Máxima',exercises:[]},
  0:{name:'Domingo',type:'Descanso',label:'Descanso',intensity:'—',exercises:[]}
};

const storeKey = 'gymFutbolAppV1';
let data = loadLocalData();
let supabaseClient = null;
let currentUser = null;
let syncInProgress = false;

const today = new Date();
const day = today.getDay();
const todayPlan = plan[day];
const dateKey = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');

function loadLocalData(){
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey) || '{}');
    return {
      readiness: Array.isArray(parsed.readiness) ? parsed.readiness : [],
      workouts: Array.isArray(parsed.workouts) ? parsed.workouts : [],
      matches: Array.isArray(parsed.matches) ? parsed.matches : []
    };
  } catch {
    return {readiness:[], workouts:[], matches:[]};
  }
}

function nowIso(){ return new Date().toISOString(); }
function saveLocal(){ localStorage.setItem(storeKey, JSON.stringify(data)); renderStats(); }
function keyWorkout(x){ return `${x.date}::${x.exercise}`; }
function normalizeUpdated(x){ return x.updatedAt || x.updated_at || ''; }

function dedupeBy(items, keyFn){
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const existing = map.get(key);
    if (!existing || normalizeUpdated(item) >= normalizeUpdated(existing)) map.set(key, item);
  }
  return [...map.values()];
}

function setSyncBadge(state, text){
  const el = document.getElementById('syncBadge');
  el.className = `sync-badge ${state}`;
  el.textContent = text;
}

function setAuthMessage(message, isError=false){
  const el = document.getElementById('authMessage');
  el.textContent = message || '';
  el.className = isError ? 'advice error-text' : 'advice';
}

function renderAuth(){
  const signedOut = document.getElementById('signedOutBox');
  const signedIn = document.getElementById('signedInBox');
  const logoutBtn = document.getElementById('logoutBtn');
  const authStatus = document.getElementById('authStatus');
  if (currentUser) {
    signedOut.classList.add('hidden');
    signedIn.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    document.getElementById('userEmail').textContent = currentUser.email || 'usuario';
    authStatus.textContent = navigator.onLine ? 'Sincronización activa' : 'Sin conexión';
    setSyncBadge(navigator.onLine ? 'synced' : 'pending', navigator.onLine ? 'Sincronizado' : 'Pendiente');
  } else {
    signedOut.classList.remove('hidden');
    signedIn.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    authStatus.textContent = supabaseClient ? 'Sin sesión' : 'Modo local';
    setSyncBadge('local', 'Solo local');
  }
}

async function initSupabase(){
  try {
    if (!window.supabase?.createClient) throw new Error('No se pudo cargar la librería de Supabase.');
    const response = await fetch('/api/config', {cache:'no-store'});
    if (!response.ok) throw new Error('No se pudo leer la configuración de Supabase en Vercel.');
    const config = await response.json();
    supabaseClient = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const {data: sessionData} = await supabaseClient.auth.getSession();
    currentUser = sessionData.session?.user || null;
    renderAuth();
    if (currentUser) await syncAll();
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session?.user || null;
      renderAuth();
      if (currentUser) await syncAll();
    });
  } catch (err) {
    console.warn(err);
    document.getElementById('authStatus').textContent = 'Modo local';
    setAuthMessage('Supabase no está disponible. La app sigue guardando en este dispositivo.', true);
    renderAuth();
  }
}

async function signIn(){
  if (!supabaseClient) return setAuthMessage('Supabase todavía no está disponible.', true);
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) return setAuthMessage('Ingresá email y contraseña.', true);
  setAuthMessage('Iniciando sesión…');
  const {error} = await supabaseClient.auth.signInWithPassword({email, password});
  if (error) return setAuthMessage(error.message, true);
  setAuthMessage('Sesión iniciada. Sincronizando…');
}

async function signUp(){
  if (!supabaseClient) return setAuthMessage('Supabase todavía no está disponible.', true);
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || password.length < 6) return setAuthMessage('Usá un email válido y una contraseña de al menos 6 caracteres.', true);
  setAuthMessage('Creando cuenta…');
  const {data: result, error} = await supabaseClient.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin }
  });
  if (error) return setAuthMessage(error.message, true);
  if (!result.session) setAuthMessage('Cuenta creada. Revisá tu email para confirmar la cuenta y luego iniciá sesión.');
  else setAuthMessage('Cuenta creada. Sincronizando…');
}

async function logout(){
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  renderAuth();
}

function remoteToLocal(remote){
  return {
    readiness: (remote.readiness || []).map(r => ({date:r.date,sleep:r.sleep,energy:r.energy,fatigue:r.fatigue,pain:r.pain,updatedAt:r.updated_at})),
    workouts: (remote.workouts || []).map(w => ({date:w.date,day:w.day,exercise:w.exercise,sets:w.sets || [],updatedAt:w.updated_at})),
    matches: (remote.matches || []).map(m => ({date:m.date,energy:m.energy,legs:m.legs,performance:m.performance,notes:m.notes || '',updatedAt:m.updated_at}))
  };
}

async function pullRemote(){
  const [r,w,m] = await Promise.all([
    supabaseClient.from('readiness').select('*').order('date',{ascending:false}),
    supabaseClient.from('workouts').select('*').order('date',{ascending:false}),
    supabaseClient.from('match_reviews').select('*').order('date',{ascending:false})
  ]);
  const error = r.error || w.error || m.error;
  if (error) throw error;
  return remoteToLocal({readiness:r.data, workouts:w.data, matches:m.data});
}

async function pushAllLocal(){
  if (!currentUser) return;
  const user_id = currentUser.id;
  const readinessRows = dedupeBy(data.readiness, x=>x.date).map(x=>({
    user_id,date:x.date,sleep:+x.sleep,energy:+x.energy,fatigue:+x.fatigue,pain:+x.pain,updated_at:x.updatedAt || nowIso()
  }));
  const workoutRows = dedupeBy(data.workouts, keyWorkout).map(x=>({
    user_id,date:x.date,day:x.day,exercise:x.exercise,sets:x.sets || [],updated_at:x.updatedAt || nowIso()
  }));
  const matchRows = dedupeBy(data.matches, x=>x.date).map(x=>({
    user_id,date:x.date,energy:+x.energy,legs:+x.legs,performance:+x.performance,notes:x.notes || '',updated_at:x.updatedAt || nowIso()
  }));
  const tasks = [];
  if (readinessRows.length) tasks.push(supabaseClient.from('readiness').upsert(readinessRows,{onConflict:'user_id,date'}));
  if (workoutRows.length) tasks.push(supabaseClient.from('workouts').upsert(workoutRows,{onConflict:'user_id,date,exercise'}));
  if (matchRows.length) tasks.push(supabaseClient.from('match_reviews').upsert(matchRows,{onConflict:'user_id,date'}));
  const results = await Promise.all(tasks);
  const error = results.find(x=>x.error)?.error;
  if (error) throw error;
}

function mergeLocalAndRemote(remote){
  data.readiness = dedupeBy([...data.readiness, ...remote.readiness], x=>x.date);
  data.workouts = dedupeBy([...data.workouts, ...remote.workouts], keyWorkout);
  data.matches = dedupeBy([...data.matches, ...remote.matches], x=>x.date);
  saveLocal();
}

async function syncAll(){
  if (!supabaseClient || !currentUser || !navigator.onLine || syncInProgress) return;
  syncInProgress = true;
  setSyncBadge('pending','Sincronizando…');
  try {
    const remote = await pullRemote();
    mergeLocalAndRemote(remote);
    await pushAllLocal();
    const finalRemote = await pullRemote();
    data = finalRemote;
    saveLocal();
    hydrateTodayInputs();
    setSyncBadge('synced','Sincronizado');
    document.getElementById('authStatus').textContent = 'Sincronización activa';
  } catch (err) {
    console.error('Error de sincronización:', err);
    setSyncBadge('pending','Pendiente');
    document.getElementById('authStatus').textContent = 'Error al sincronizar';
    setAuthMessage(`No se pudo sincronizar: ${err.message}`, true);
  } finally {
    syncInProgress = false;
  }
}

async function upsertReadiness(rec){
  if (!supabaseClient || !currentUser || !navigator.onLine) return;
  const {error} = await supabaseClient.from('readiness').upsert({
    user_id:currentUser.id,date:rec.date,sleep:rec.sleep,energy:rec.energy,fatigue:rec.fatigue,pain:rec.pain,updated_at:rec.updatedAt
  },{onConflict:'user_id,date'});
  if (error) throw error;
}
async function upsertWorkout(rec){
  if (!supabaseClient || !currentUser || !navigator.onLine) return;
  const {error} = await supabaseClient.from('workouts').upsert({
    user_id:currentUser.id,date:rec.date,day:rec.day,exercise:rec.exercise,sets:rec.sets,updated_at:rec.updatedAt
  },{onConflict:'user_id,date,exercise'});
  if (error) throw error;
}
async function upsertMatch(rec){
  if (!supabaseClient || !currentUser || !navigator.onLine) return;
  const {error} = await supabaseClient.from('match_reviews').upsert({
    user_id:currentUser.id,date:rec.date,energy:rec.energy,legs:rec.legs,performance:rec.performance,notes:rec.notes,updated_at:rec.updatedAt
  },{onConflict:'user_id,date'});
  if (error) throw error;
}

function renderToday(){
  document.getElementById('todayCard').innerHTML=`<p class="eyebrow">HOY · ${todayPlan.name.toUpperCase()}</p><h2 style="margin:6px 0">${todayPlan.label}</h2><p class="muted">${todayPlan.type} · Intensidad ${todayPlan.intensity}</p>`;
}
function renderWeek(){
  const order=[1,2,3,4,5,6,0];
  document.getElementById('weekGrid').innerHTML=order.map(d=>`<div class="day ${d===day?'active':''}"><strong>${plan[d].name}</strong><span>${plan[d].label}</span></div>`).join('');
}
function renderWorkout(){
  const list=document.getElementById('exerciseList');
  document.getElementById('workoutTitle').textContent=todayPlan.type==='Gimnasio'?todayPlan.label:'Entrenamiento de hoy';
  document.getElementById('workoutTag').textContent=todayPlan.intensity;
  if(todayPlan.type!=='Gimnasio'){
    list.innerHTML=`<p class="muted">Hoy no hay rutina de gimnasio cargada. Registrá tu estado y priorizá la sesión de ${todayPlan.type.toLowerCase()}.</p>`;
    return;
  }
  list.innerHTML=todayPlan.exercises.map((e,i)=>`<div class="exercise" data-ex="${i}"><h3>${e[0]}</h3><div class="prescription">Objetivo: ${e[1]} · Dejando 1–3 repeticiones en reserva.</div>${[1,2,3].map(s=>`<div class="set-row"><span>S${s}</span><input type="number" step="0.5" placeholder="kg" data-f="kg"><input type="number" placeholder="reps" data-f="reps"><input type="number" min="0" max="5" placeholder="RIR" data-f="rir"><button type="button" onclick="this.textContent='✓'">✓</button></div>`).join('')}<button class="ghost exercise-done" onclick="finishExercise(${i})">Guardar ejercicio</button></div>`).join('');
  hydrateWorkoutInputs();
}

function hydrateWorkoutInputs(){
  if(todayPlan.type!=='Gimnasio') return;
  todayPlan.exercises.forEach((e,i)=>{
    const rec = dedupeBy(data.workouts.filter(w=>w.date===dateKey && w.exercise===e[0]), keyWorkout).at(-1);
    if(!rec) return;
    const box=document.querySelector(`[data-ex="${i}"]`);
    if(!box) return;
    [...box.querySelectorAll('.set-row')].forEach((row,idx)=>{
      const set=rec.sets?.[idx]; if(!set) return;
      const inputs=row.querySelectorAll('input');
      inputs[0].value=set.kg ?? ''; inputs[1].value=set.reps ?? ''; inputs[2].value=set.rir ?? '';
    });
    box.classList.add('done');
  });
}

window.finishExercise=async function(i){
  const box=document.querySelector(`[data-ex="${i}"]`);
  const rows=[...box.querySelectorAll('.set-row')].map(r=>{
    const ins=r.querySelectorAll('input');
    return {kg:ins[0].value,reps:ins[1].value,rir:ins[2].value};
  });
  const rec={date:dateKey,day:todayPlan.name,exercise:todayPlan.exercises[i][0],sets:rows,updatedAt:nowIso()};
  data.workouts=data.workouts.filter(x=>keyWorkout(x)!==keyWorkout(rec));
  data.workouts.push(rec);
  box.classList.add('done');
  saveLocal();
  try { await upsertWorkout(rec); if(currentUser) setSyncBadge('synced','Sincronizado'); }
  catch { setSyncBadge('pending','Pendiente'); }
};

function bindRange(id){
  const el=document.getElementById(id),v=document.getElementById(id+'Val');
  if(el&&v) el.addEventListener('input',()=>v.textContent=el.value);
}
['sleep','energy','fatigue','pain','matchEnergy','legs','performance'].forEach(bindRange);

document.getElementById('saveReadiness').onclick=async()=>{
  const rec={date:dateKey,sleep:+sleep.value,energy:+energy.value,fatigue:+fatigue.value,pain:+pain.value,updatedAt:nowIso()};
  data.readiness=data.readiness.filter(x=>x.date!==dateKey); data.readiness.push(rec);
  const score=(rec.sleep+rec.energy+(6-rec.fatigue))/3;
  let msg='Estado adecuado: mantené el plan previsto.';
  if(rec.pain>=5) msg='Hay dolor relevante: evitá forzar la zona y considerá una evaluación profesional si persiste.';
  else if(score<2.5) msg='Fatiga alta: hoy conviene reducir aproximadamente 20–30% el volumen o priorizar recuperación.';
  else if(score<3.3) msg='Estado intermedio: mantené intensidad moderada y evitá llegar al fallo.';
  document.getElementById('readinessAdvice').textContent=msg;
  saveLocal();
  try { await upsertReadiness(rec); if(currentUser) setSyncBadge('synced','Sincronizado'); }
  catch { setSyncBadge('pending','Pendiente'); }
};

if(day===6) document.getElementById('matchSection').classList.remove('hidden');
document.getElementById('saveMatch').onclick=async()=>{
  const rec={date:dateKey,energy:+matchEnergy.value,legs:+legs.value,performance:+performance.value,notes:matchNotes.value,updatedAt:nowIso()};
  data.matches=data.matches.filter(x=>x.date!==dateKey); data.matches.push(rec); saveLocal();
  try { await upsertMatch(rec); if(currentUser) setSyncBadge('synced','Sincronizado'); }
  catch { setSyncBadge('pending','Pendiente'); }
  alert('Partido guardado');
};

function hydrateTodayInputs(){
  const r=data.readiness.find(x=>x.date===dateKey);
  if(r){
    for(const [id,val] of [['sleep',r.sleep],['energy',r.energy],['fatigue',r.fatigue],['pain',r.pain]]){
      document.getElementById(id).value=val; document.getElementById(id+'Val').textContent=val;
    }
  }
  const m=data.matches.find(x=>x.date===dateKey);
  if(m){
    for(const [id,val] of [['matchEnergy',m.energy],['legs',m.legs],['performance',m.performance]]){
      document.getElementById(id).value=val; document.getElementById(id+'Val').textContent=val;
    }
    document.getElementById('matchNotes').value=m.notes || '';
  }
  hydrateWorkoutInputs();
}

async function resetAll(){
  const scope = currentUser ? 'este dispositivo Y tu cuenta sincronizada' : 'este dispositivo';
  if(!confirm(`¿Borrar todos los registros de ${scope}? Esta acción no se puede deshacer.`)) return;
  if(currentUser && supabaseClient && navigator.onLine){
    const results = await Promise.all([
      supabaseClient.from('readiness').delete().eq('user_id',currentUser.id),
      supabaseClient.from('workouts').delete().eq('user_id',currentUser.id),
      supabaseClient.from('match_reviews').delete().eq('user_id',currentUser.id)
    ]);
    const error=results.find(x=>x.error)?.error;
    if(error){ alert(`No se pudo borrar en Supabase: ${error.message}`); return; }
  }
  data={readiness:[],workouts:[],matches:[]};
  localStorage.removeItem(storeKey);
  location.reload();
}

document.getElementById('resetBtn').onclick=resetAll;
document.getElementById('loginBtn').onclick=signIn;
document.getElementById('signupBtn').onclick=signUp;
document.getElementById('logoutBtn').onclick=logout;
document.getElementById('syncNowBtn').onclick=syncAll;
document.getElementById('password').addEventListener('keydown',e=>{if(e.key==='Enter') signIn();});

function renderStats(){
  document.getElementById('workoutCount').textContent=data.workouts.length;
  document.getElementById('matchCount').textContent=data.matches.length;
  const avg=data.readiness.length?(data.readiness.reduce((a,r)=>a+(r.sleep+r.energy+(6-r.fatigue))/3,0)/data.readiness.length).toFixed(1):'—';
  document.getElementById('avgReadiness').textContent=avg;
  const items=[...data.matches.map(m=>({date:m.date,title:'Partido',detail:`Piernas ${m.legs}/5 · Rendimiento ${m.performance}/5`})),...data.workouts.map(w=>({date:w.date,title:w.exercise,detail:w.day}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  document.getElementById('history').innerHTML=items.length?items.map(x=>`<div class="history-item"><strong>${x.title}</strong><span>${x.date} · ${x.detail}</span></div>`).join(''):'<p class="muted">Todavía no hay registros.</p>';
}

window.addEventListener('online',()=>{renderAuth();syncAll();});
window.addEventListener('offline',()=>renderAuth());

renderToday(); renderWeek(); renderWorkout(); renderStats(); hydrateTodayInputs(); renderAuth(); initSupabase();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker no disponible:', err));
  });
}
