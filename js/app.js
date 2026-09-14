import {plan,localDateKey,daysUntilSaturday} from './plan.js';
import {loadLocalData,saveLocalData,clearLocalData,nowIso,emptyData,workoutKey,dedupeBy} from './store.js';
import {SyncService} from './sync.js';
import {lineChart} from './charts.js';

let storageOwner='guest',data=loadLocalData(storageOwner);
const today=new Date(), day=today.getDay(), todayPlan=plan[day], dateKey=localDateKey(today);
let sessionStart=null,sessionTick=null,restTick=null,restRemaining=0,pendingSummary=null;
const $=id=>document.getElementById(id);
const sync=new SyncService({getData:()=>data,setData:d=>{data=d;persistAndRender();},onState:setSyncBadge});
sync.onAuth=user=>switchStorageOwner(user);

function persist(){saveLocalData(data,storageOwner)}
function persistAndRender(){persist();renderAll();}
function switchStorageOwner(user){
  storageOwner=user?.id||'guest';data=loadLocalData(storageOwner);persistAndRender();
  setSyncBadge(user?'pending':'local',user?(navigator.onLine?'Pendiente de sincronizar':'Sin conexión'):'Solo local');
}
function setSyncBadge(state,text){$('syncBadge').className=`sync-badge ${state}`;$('syncBadge').textContent=text;}
function readinessScore(r){if(!r)return null;const freshness=6-(+r.fatigue||3);return Math.round(((+r.sleep + +r.energy + freshness)/15)*100 - Math.max(0,(+r.pain||0)-2)*3);}
function readinessLevel(score){if(score==null)return ['neutral','Sin registrar'];if(score>=78)return ['good',`${score}% · Bueno`];if(score>=60)return ['mid',`${score}% · Intermedio`];return ['low',`${score}% · Bajo`];}
function latestReadiness(){return data.readiness.find(x=>x.date===dateKey)}
function latestPreviousWorkout(name){return [...data.workouts].filter(x=>x.exercise===name&&x.date<dateKey).sort((a,b)=>b.date.localeCompare(a.date))[0]||null;}
function volumeOfSets(sets=[]){return sets.reduce((s,x)=>s+(Number(x.kg)||0)*(Number(x.reps)||0),0)}
function todayWorkoutRecords(){return data.workouts.filter(x=>x.date===dateKey)}
function daysText(n){return n===0?'Partido hoy':n===1?'Partido mañana':`Faltan ${n} días para el partido`;}
function guidance(){const r=latestReadiness(),score=readinessScore(r),toSat=daysUntilSaturday(today);if(r?.pain>=5)return 'Hay dolor relevante: evitá forzar la zona molesta. Si persiste o empeora, conviene evaluarlo con un profesional.';if(toSat===1)return 'Prepartido: mantené todo rápido y liviano. Terminá sintiéndote mejor que al empezar.';if(score!=null&&score<60)return 'Readiness bajo: reducí 20–30% el volumen, conservá técnica y evitá llegar al fallo.';if(score!=null&&score<78)return 'Estado intermedio: mantené 2–3 RIR en piernas y priorizá calidad sobre volumen.';return todayPlan.type==='Gimnasio'?'Buen estado: podés seguir el plan normal dejando 1–3 RIR.':'Priorizá la sesión del día y registrá la carga para ajustar el resto de la semana.';}

function renderDashboard(){const r=latestReadiness(),score=readinessScore(r),[cls,label]=readinessLevel(score),sat=daysUntilSaturday(today);$('dashboardCard').innerHTML=`
  <div class="dashboard-top"><div><p class="eyebrow">${daysText(sat).toUpperCase()}</p><h2>Hoy · ${todayPlan.name}</h2><p class="dashboard-sub">${todayPlan.label}</p></div><div class="big-score ${cls}">${score??'—'}<span>${score==null?'readiness':'/100'}</span></div></div>
  <div class="recommendation"><strong>Recomendación</strong><p>${guidance()}</p></div>
  ${todayPlan.type==='Gimnasio'?'<button class="primary wide" id="goWorkoutBtn">Comenzar entrenamiento</button>':''}`;
  $('goWorkoutBtn')?.addEventListener('click',()=>switchView('workoutView'));
  $('readinessMini').className=`score-pill ${cls}`;$('readinessMini').textContent=label;
  $('readinessAdvice').textContent=guidance();
}
function renderWeek(){const order=[1,2,3,4,5,6,0];$('weekGrid').innerHTML=order.map(d=>`<div class="day ${d===day?'active':''}"><strong>${plan[d].name.slice(0,3)}</strong><span>${plan[d].label}</span></div>`).join('');}
function suggestion(ex){const prev=latestPreviousWorkout(ex.name);if(!prev)return {text:'Primera referencia: empezá conservador y dejá 2–3 RIR.',kg:''};const working=prev.sets.filter(s=>Number(s.kg)>0&&Number(s.reps)>0);if(!working.length)return {text:`Última vez: ${prev.date}.`,kg:''};const kg=Math.max(...working.map(s=>Number(s.kg)));const reps=Math.min(...working.map(s=>Number(s.reps)));const avgRir=working.reduce((a,s)=>a+(Number(s.rir)||0),0)/working.length;const score=readinessScore(latestReadiness());let next=kg,msg='Repetí la carga y buscá mejorar reps/técnica.';if(ex.step&&reps>=ex.max&&avgRir>=1.5&&(!score||score>=70)){next=kg+ex.step;msg=`Progresión sugerida: ${next} kg. La última vez completaste el rango con margen.`;}else if(score!=null&&score<60){msg=`Readiness bajo: mantené ${kg} kg o bajá 5–10% y reducí una serie.`;}else if(daysUntilSaturday(today)<=1){msg=`Prepartido: no progreses carga. Usá ${kg} kg o menos y buscá velocidad.`;}return {text:`Última vez ${prev.date}: ${working.map(s=>`${s.kg}×${s.reps}`).join(' · ')}. ${msg}`,kg:next};}
function renderWorkout(){
  $('workoutTitle').textContent=todayPlan.label;$('workoutTag').textContent=todayPlan.intensity;$('workoutGuidance').textContent=guidance();
  if(todayPlan.type!=='Gimnasio'){$('exerciseList').innerHTML=`<section class="card"><p class="muted">Hoy no hay rutina de gimnasio. Usá Inicio para registrar la carga de ${todayPlan.type.toLowerCase()}.</p></section>`;$('startSessionBtn').classList.add('hidden');return;}
  $('startSessionBtn').classList.remove('hidden');
  $('exerciseList').innerHTML=todayPlan.exercises.map((ex,i)=>{const sug=suggestion(ex);const old=data.workouts.find(w=>w.date===dateKey&&w.exercise===ex.name);return `<section class="card exercise" data-ex="${i}">
    <div class="exercise-title"><div><h3>${ex.name}</h3><p>${ex.rx} · descanso ${Math.round(ex.rest/60*10)/10} min</p></div><span class="tag">${i+1}/${todayPlan.exercises.length}</span></div>
    <div class="previous-box">${sug.text}</div>
    <div class="set-head"><span>Serie</span><span>kg</span><span>reps</span><span>RIR</span><span></span></div>
    ${Array.from({length:ex.sets},(_,s)=>{const saved=old?.sets?.[s]||{};return `<div class="set-row"><span>S${s+1}</span><input inputmode="decimal" type="number" step="0.5" placeholder="${sug.kg||'kg'}" data-f="kg" value="${saved.kg??''}"><input inputmode="numeric" type="number" placeholder="${ex.min}" data-f="reps" value="${saved.reps??''}"><input inputmode="numeric" type="number" min="0" max="5" placeholder="2" data-f="rir" value="${saved.rir??''}"><button class="set-done ${saved.done?'checked':''}" data-set="${s}" aria-label="Completar serie">${saved.done?'✓':'○'}</button></div>`}).join('')}
    <button class="ghost wide save-ex" data-i="${i}">Guardar ejercicio</button></section>`}).join('');
  document.querySelectorAll('.set-done').forEach(btn=>btn.onclick=()=>completeSet(btn));document.querySelectorAll('.save-ex').forEach(btn=>btn.onclick=()=>saveExercise(+btn.dataset.i));
}
function readExercise(i){const ex=todayPlan.exercises[i],box=document.querySelector(`[data-ex="${i}"]`);const sets=[...box.querySelectorAll('.set-row')].map(r=>{const ins=r.querySelectorAll('input');return {kg:ins[0].value,reps:ins[1].value,rir:ins[2].value,done:r.querySelector('.set-done').classList.contains('checked')}});return {date:dateKey,day:todayPlan.name,exercise:ex.name,sets,updatedAt:nowIso()};}
async function saveExercise(i){const rec=readExercise(i);data.workouts=data.workouts.filter(x=>workoutKey(x)!==workoutKey(rec));data.workouts.push(rec);persist();renderProgress();try{await sync.syncRecord()}catch{}}
function completeSet(btn){btn.classList.toggle('checked');btn.textContent=btn.classList.contains('checked')?'✓':'○';const i=+btn.closest('.exercise').dataset.ex;saveExercise(i);if(btn.classList.contains('checked'))startRest(todayPlan.exercises[i].rest);}
function startRest(seconds){clearInterval(restTick);restRemaining=seconds;$('restOverlay').classList.remove('hidden');drawRest();restTick=setInterval(()=>{restRemaining--;drawRest();if(restRemaining<=0)stopRest();},1000);}
function drawRest(){const m=Math.floor(restRemaining/60),s=restRemaining%60;$('restTime').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
function stopRest(){clearInterval(restTick);$('restOverlay').classList.add('hidden');}

function startSession(){sessionStart=Date.now();$('startSessionBtn').classList.add('hidden');$('finishSessionBtn').classList.remove('hidden');clearInterval(sessionTick);sessionTick=setInterval(drawSessionTimer,1000);drawSessionTimer();}
function drawSessionTimer(){const sec=Math.floor((Date.now()-(sessionStart||Date.now()))/1000);$('sessionTimer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function finishSession(){if(!sessionStart)return;clearInterval(sessionTick);todayPlan.exercises.forEach((_,i)=>saveExercise(i));const end=Date.now(),duration=Math.max(1,Math.round((end-sessionStart)/60000));const recs=todayWorkoutRecords();const volume=recs.reduce((a,w)=>a+volumeOfSets(w.sets),0);pendingSummary={date:dateKey,day:todayPlan.name,label:todayPlan.label,startedAt:new Date(sessionStart).toISOString(),endedAt:new Date(end).toISOString(),duration,volume};$('summaryMetrics').innerHTML=`<div><strong>${duration}</strong><span>min</span></div><div><strong>${recs.length}</strong><span>ejercicios</span></div><div><strong>${Math.round(volume).toLocaleString('es-AR')}</strong><span>kg volumen</span></div>`;$('sessionSummary').classList.remove('hidden');}
async function saveSessionSummary(){if(!pendingSummary)return;const rec={...pendingSummary,rpe:+$('sessionRpe').value,notes:$('sessionNotes').value,updatedAt:nowIso()};data.sessions=data.sessions.filter(x=>!(x.date===rec.date&&x.label===rec.label));data.sessions.push(rec);persistAndRender();try{await sync.syncRecord()}catch{}sessionStart=null;pendingSummary=null;$('sessionSummary').classList.add('hidden');$('finishSessionBtn').classList.add('hidden');$('startSessionBtn').classList.remove('hidden');switchView('progressView');}

function renderFootball(){const show=[1,3,6].includes(day);$('footballQuickCard').classList.toggle('hidden',!show);if(!show)return;const type=day===6?'Partido':day===3?'Amistoso':'Entrenamiento equipo';$('footballTitle').textContent=type;const rec=data.football.find(x=>x.date===dateKey&&x.type===type);if(rec){$('footballDuration').value=rec.duration;$('footballRpe').value=rec.rpe;$('footballMinutes').value=rec.minutes||'';}updateFootballLoad();}
function updateFootballLoad(){const d=+$('footballDuration').value||0,r=+$('footballRpe').value||0;$('footballLoadPreview').textContent=`Carga estimada: ${d&&r?d*r:'—'} AU`;}
async function saveFootball(){const type=day===6?'Partido':day===3?'Amistoso':'Entrenamiento equipo';const rec={date:dateKey,type,duration:+$('footballDuration').value,rpe:+$('footballRpe').value,minutes:+$('footballMinutes').value||0,notes:'',updatedAt:nowIso()};if(!rec.duration||!rec.rpe)return alert('Completá duración e intensidad RPE.');data.football=data.football.filter(x=>!(x.date===rec.date&&x.type===rec.type));data.football.push(rec);persistAndRender();try{await sync.syncRecord()}catch{}}

async function saveReadiness(){const rec={date:dateKey,sleep:+$('sleep').value,energy:+$('energy').value,fatigue:6-(+$('freshness').value),pain:+$('pain').value,painArea:$('painArea').value,updatedAt:nowIso()};data.readiness=data.readiness.filter(x=>x.date!==dateKey);data.readiness.push(rec);persistAndRender();try{await sync.syncRecord()}catch{}}
async function saveMatch(){const rec={date:dateKey,energy:+$('matchEnergy').value,legs:+$('legs').value,performance:+$('performance').value,notes:$('matchNotes').value,updatedAt:nowIso()};data.matches=data.matches.filter(x=>x.date!==dateKey);data.matches.push(rec);persistAndRender();try{await sync.syncRecord()}catch{}alert('Partido guardado');}
function hydrateToday(){const r=latestReadiness();if(r){$('sleep').value=r.sleep;$('energy').value=r.energy;$('freshness').value=6-r.fatigue;$('pain').value=r.pain;$('painArea').value=r.painArea||'';}['sleep','energy','freshness','pain'].forEach(id=>$(id+'Val').textContent=$(id).value);const m=data.matches.find(x=>x.date===dateKey);if(m){$('matchEnergy').value=m.energy;$('legs').value=m.legs;$('performance').value=m.performance;$('matchNotes').value=m.notes||'';}['matchEnergy','legs','performance'].forEach(id=>$(id+'Val').textContent=$(id).value);}

function renderProgress(){const sessionDates=new Set(data.workouts.map(x=>x.date));$('workoutCount').textContent=sessionDates.size;const since=new Date();since.setDate(since.getDate()-6);const sinceKey=localDateKey(since);const load=data.football.filter(x=>x.date>=sinceKey).reduce((a,x)=>a+(+x.duration*+x.rpe),0);$('footballLoad7').textContent=Math.round(load);const scores=data.readiness.map(readinessScore).filter(x=>x!=null);$('avgReadiness').textContent=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):'—';
  const rd=[...data.readiness].sort((a,b)=>a.date.localeCompare(b.date)).slice(-8).map(x=>({label:x.date.slice(5),value:readinessScore(x)}));lineChart($('readinessChart'),rd,{min:0,max:100});
  const md=[...data.matches].sort((a,b)=>a.date.localeCompare(b.date)).slice(-8).map(x=>({label:x.date.slice(5),value:+x.legs}));lineChart($('matchChart'),md,{min:1,max:5});
  const names=[...new Set(data.workouts.map(x=>x.exercise))].sort();const sel=$('exerciseSelect'),current=sel.value;sel.innerHTML=names.length?names.map(n=>`<option>${n}</option>`).join(''):'<option>Sin datos</option>';if(names.includes(current))sel.value=current;renderStrength();
  const items=[...data.sessions.map(s=>({date:s.date,title:s.label,detail:`${s.duration} min · RPE ${s.rpe||'—'}`})),...data.matches.map(m=>({date:m.date,title:'Partido',detail:`Piernas ${m.legs}/5 · Rendimiento ${m.performance}/5`})),...data.football.map(f=>({date:f.date,title:f.type,detail:`${f.duration} min · RPE ${f.rpe} · carga ${f.duration*f.rpe}`}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12);$('history').innerHTML=items.length?items.map(x=>`<div class="history-item"><strong>${x.title}</strong><span>${x.date} · ${x.detail}</span></div>`).join(''):'<p class="muted">Todavía no hay registros suficientes.</p>';
}
function renderStrength(){const name=$('exerciseSelect').value;const pts=[...data.workouts].filter(x=>x.exercise===name).sort((a,b)=>a.date.localeCompare(b.date)).slice(-10).map(w=>({label:w.date.slice(5),value:Math.max(0,...w.sets.map(s=>Number(s.kg)||0))}));const max=Math.max(20,...pts.map(x=>x.value));lineChart($('strengthChart'),pts,{min:0,max:Math.ceil(max/10)*10,suffix:'kg'});}
function renderMatch(){ $('matchSection').classList.toggle('hidden',day!==6); }

function renderAuth(){const signed=!!sync.user;$('signedOutBox').classList.toggle('hidden',signed);$('signedInBox').classList.toggle('hidden',!signed);if(signed){$('userEmail').textContent=sync.user.email||'usuario';$('authStatus').textContent=navigator.onLine?sync.lastState.text:'Sin conexión';}else setSyncBadge('local','Solo local');}
function setAuthMessage(msg,err=false){$('authMessage').textContent=msg;$('authMessage').className=err?'advice error-text':'advice';}
function switchView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));$(id).classList.add('active-view');document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===id));if(id==='progressView')setTimeout(renderProgress,0);window.scrollTo({top:0,behavior:'smooth'});}
function renderAll(){hydrateToday();renderDashboard();renderWeek();renderWorkout();renderFootball();renderMatch();renderProgress();renderAuth();}

async function resetAll(){const scope=sync.user?'este dispositivo Y tu cuenta sincronizada':'este dispositivo';if(!confirm(`¿Borrar todos los registros de ${scope}?`))return;if(sync.user){try{await sync.deleteAll()}catch(e){alert('El borrado quedó pendiente de sincronizar: '+e.message)}location.reload();return;}data=emptyData();clearLocalData(storageOwner);location.reload();}

['sleep','energy','freshness','pain','matchEnergy','legs','performance'].forEach(id=>$(id).addEventListener('input',()=>{$(id+'Val').textContent=$(id).value;if(['sleep','energy','freshness','pain'].includes(id))renderDashboard();}));
['footballDuration','footballRpe'].forEach(id=>$(id).addEventListener('input',updateFootballLoad));
$('saveReadiness').onclick=saveReadiness;$('saveMatch').onclick=saveMatch;$('saveFootball').onclick=saveFootball;$('startSessionBtn').onclick=startSession;$('finishSessionBtn').onclick=finishSession;$('saveSessionSummary').onclick=saveSessionSummary;$('addRestBtn').onclick=()=>{restRemaining+=30;drawRest()};$('skipRestBtn').onclick=stopRest;$('resetBtn').onclick=resetAll;$('exerciseSelect').onchange=renderStrength;
$('profileBtn').onclick=()=>{$('authSection').classList.toggle('hidden')};$('openAuthSettings').onclick=()=>{$('authSection').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})};$('closeAuthBtn').onclick=()=>$('authSection').classList.add('hidden');
document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
$('loginBtn').onclick=async()=>{try{setAuthMessage('Iniciando sesión…');await sync.signIn($('email').value.trim(),$('password').value);setAuthMessage('Sesión iniciada.')}catch(e){setAuthMessage(e.message,true)}};
$('signupBtn').onclick=async()=>{try{const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<6)return setAuthMessage('Email válido y contraseña de al menos 6 caracteres.',true);const r=await sync.signUp(email,password);setAuthMessage(r.session?'Cuenta creada.':'Cuenta creada. Revisá tu email para confirmarla.')}catch(e){setAuthMessage(e.message,true)}};
$('logoutBtn').onclick=async()=>{await sync.signOut();renderAuth()};$('syncNowBtn').onclick=async()=>{try{await sync.syncAll();renderAll()}catch(e){setAuthMessage(e.message,true)}};

renderAll();
try{const user=await sync.init();renderAuth();if(user){await sync.syncAll();renderAll();}}catch(e){console.warn(e);setAuthMessage('Supabase no está disponible. La app sigue funcionando en modo local.',true);renderAuth();}
window.addEventListener('online',()=>{renderAuth();sync.syncAll().then(renderAll).catch(()=>{})});window.addEventListener('offline',renderAuth);
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
