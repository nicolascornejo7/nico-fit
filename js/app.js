import {plan,localDateKey,daysUntilSaturday} from './plan.js';
import {loadLocalData,saveLocalData,clearLocalData,nowIso,emptyData,workoutKey} from './store.js';
import {SyncService} from './sync.js';
import {lineChart} from './charts.js';
import {ActiveSessionStore,commitPendingSession,elapsedSeconds,remainingRestSeconds} from './active-session.js';

let storageOwner='guest',data=loadLocalData(storageOwner),lastRenderedDate=localDateKey();
let sessionTick=null,restTick=null,restoreExercisePosition=true;
const $=id=>document.getElementById(id);
const activeSession=new ActiveSessionStore({owner:storageOwner});
const sync=new SyncService({getData:()=>data,setData:next=>{captureActiveDrafts();data=next;persistAndRender(false);},onState:setSyncBadge});
sync.onAuth=user=>switchStorageOwner(user);

function currentContext(now=new Date()){const dayIndex=now.getDay();return {now,dayIndex,dateKey:localDateKey(now),plan:plan[dayIndex]};}
function workoutContext(){const state=activeSession.state;if(!state)return currentContext();return {now:new Date(),dayIndex:state.dayIndex,dateKey:state.sessionDate,plan:plan[state.dayIndex],active:state};}
function persist(){saveLocalData(data,storageOwner);}
function persistAndRender(capture=true){if(capture)captureActiveDrafts();persist();renderAll(false);}
function switchStorageOwner(user){
  captureActiveDrafts();storageOwner=user?.id||'guest';data=loadLocalData(storageOwner);activeSession.setOwner(storageOwner);restoreExercisePosition=true;persistAndRender(false);
  setSyncBadge(user?'pending':'local',user?(navigator.onLine?'Pendiente de sincronizar':'Sin conexión'):'Solo local');
}
function setSyncBadge(state,text){$('syncBadge').className=`sync-badge ${state}`;$('syncBadge').textContent=text;}
function readinessScore(r){if(!r)return null;const freshness=6-(+r.fatigue||3);return Math.round(((+r.sleep + +r.energy + freshness)/15)*100-Math.max(0,(+r.pain||0)-2)*3);}
function readinessLevel(score){if(score==null)return ['neutral','Sin registrar'];if(score>=78)return ['good',`${score}% · Bueno`];if(score>=60)return ['mid',`${score}% · Intermedio`];return ['low',`${score}% · Bajo`];}
function latestReadiness(date=currentContext().dateKey){return data.readiness.find(x=>x.date===date);}
function latestPreviousWorkout(name,date){return [...data.workouts].filter(x=>x.exercise===name&&x.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0]||null;}
function volumeOfSets(sets=[]){return sets.filter(x=>x.done).reduce((sum,x)=>sum+(Number(x.kg)||0)*(Number(x.reps)||0),0);}
function daysText(n){return n===0?'Partido hoy':n===1?'Partido mañana':`Faltan ${n} días para el partido`;}
function guidance(ctx=currentContext()){
  const r=latestReadiness(ctx.dateKey),score=readinessScore(r),toSat=daysUntilSaturday(ctx.now);
  if(r?.pain>=5)return 'Hay dolor relevante: evitá forzar la zona molesta. Si persiste o empeora, conviene evaluarlo con un profesional.';
  if(toSat===1)return 'Prepartido: mantené todo rápido y liviano. Terminá sintiéndote mejor que al empezar.';
  if(score!=null&&score<60)return 'Readiness bajo: reducí 20–30% el volumen, conservá técnica y evitá llegar al fallo.';
  if(score!=null&&score<78)return 'Estado intermedio: mantené 2–3 RIR en piernas y priorizá calidad sobre volumen.';
  return ctx.plan.type==='Gimnasio'?'Buen estado: podés seguir el plan normal dejando 1–3 RIR.':'Priorizá la sesión del día y registrá la carga para ajustar el resto de la semana.';
}

function renderDashboard(){
  const ctx=currentContext(),r=latestReadiness(ctx.dateKey),score=readinessScore(r),[cls,label]=readinessLevel(score),sat=daysUntilSaturday(ctx.now),hasActive=!!activeSession.state;
  $('dashboardCard').innerHTML=`<div class="dashboard-top"><div><p class="eyebrow">${daysText(sat).toUpperCase()}</p><h2>Hoy · ${ctx.plan.name}</h2><p class="dashboard-sub">${ctx.plan.label}</p></div><div class="big-score ${cls}">${score??'—'}<span>${score==null?'readiness':'/100'}</span></div></div><div class="recommendation"><strong>Recomendación</strong><p>${guidance(ctx)}</p></div>${(ctx.plan.type==='Gimnasio'||hasActive)?`<button class="primary wide" id="goWorkoutBtn">${hasActive?'Continuar entrenamiento':'Comenzar entrenamiento'}</button>`:''}`;
  $('goWorkoutBtn')?.addEventListener('click',()=>switchView('workoutView'));$('readinessMini').className=`score-pill ${cls}`;$('readinessMini').textContent=label;$('readinessAdvice').textContent=guidance(ctx);
}
function renderWeek(){const ctx=currentContext(),order=[1,2,3,4,5,6,0];$('weekGrid').innerHTML=order.map(d=>`<div class="day ${d===ctx.dayIndex?'active':''}"><strong>${plan[d].name.slice(0,3)}</strong><span>${plan[d].label}</span></div>`).join('');}
function suggestion(ex,ctx){
  const prev=latestPreviousWorkout(ex.name,ctx.dateKey);if(!prev)return {text:'Primera referencia: empezá conservador y dejá 2–3 RIR.',kg:''};const working=prev.sets.filter(s=>Number(s.kg)>0&&Number(s.reps)>0);if(!working.length)return {text:`Última vez: ${prev.date}.`,kg:''};
  const kg=Math.max(...working.map(s=>Number(s.kg))),reps=Math.min(...working.map(s=>Number(s.reps))),avgRir=working.reduce((a,s)=>a+(Number(s.rir)||0),0)/working.length,score=readinessScore(latestReadiness(ctx.dateKey));let next=kg,msg='Repetí la carga y buscá mejorar reps/técnica.';
  if(ex.step&&reps>=ex.max&&avgRir>=1.5&&(!score||score>=70)){next=kg+ex.step;msg=`Progresión sugerida: ${next} kg. La última vez completaste el rango con margen.`;}else if(score!=null&&score<60)msg=`Readiness bajo: mantené ${kg} kg o bajá 5–10% y reducí una serie.`;else if(daysUntilSaturday(ctx.now)<=1)msg=`Prepartido: no progreses carga. Usá ${kg} kg o menos y buscá velocidad.`;
  return {text:`Última vez ${prev.date}: ${working.map(s=>`${s.kg}×${s.reps}`).join(' · ')}. ${msg}`,kg:next};
}
function initialDraft(ex,ctx){const active=ctx.active?.exercises.find(x=>x.name===ex.name);if(active)return active;const saved=data.workouts.find(w=>w.date===ctx.dateKey&&w.exercise===ex.name);return {name:ex.name,sets:Array.from({length:ex.sets},(_,index)=>saved?.sets?.[index]||{})};}
function renderWorkout(){
  const ctx=workoutContext(),state=activeSession.state;$('workoutTitle').textContent=state?.label||ctx.plan.label;$('workoutTag').textContent=state?.intensity||ctx.plan.intensity;$('workoutGuidance').textContent=guidance(ctx);
  $('startSessionBtn').classList.toggle('hidden',ctx.plan.type!=='Gimnasio'||!!state);$('finishSessionBtn').classList.toggle('hidden',!state||state.phase!=='active');
  if(ctx.plan.type!=='Gimnasio'){$('exerciseList').innerHTML=`<section class="card"><p class="muted">Hoy no hay rutina de gimnasio. Usá Inicio para registrar la carga de ${ctx.plan.type.toLowerCase()}.</p></section>`;return;}
  $('exerciseList').innerHTML=ctx.plan.exercises.map((ex,i)=>{const sug=suggestion(ex,ctx),draft=initialDraft(ex,ctx);return `<section class="card exercise ${state?.currentExercise===i?'current-exercise':''}" data-ex="${i}"><div class="exercise-title"><div><h3>${ex.name}</h3><p>${ex.rx} · descanso ${Math.round(ex.rest/60*10)/10} min</p></div><span class="tag">${i+1}/${ctx.plan.exercises.length}</span></div><div class="previous-box">${sug.text}</div><div class="set-head"><span>Serie</span><span>kg</span><span>reps</span><span>RIR</span><span></span></div>${Array.from({length:ex.sets},(_,s)=>{const saved=draft.sets?.[s]||{};return `<div class="set-row"><span>S${s+1}</span><input inputmode="decimal" type="number" step="0.5" placeholder="${sug.kg||'kg'}" data-f="kg" value="${saved.kg??''}"><input inputmode="numeric" type="number" placeholder="${ex.min}" data-f="reps" value="${saved.reps??''}"><input inputmode="numeric" type="number" min="0" max="5" placeholder="2" data-f="rir" value="${saved.rir??''}"><button class="set-done ${saved.done?'checked':''}" data-set="${s}" aria-label="Completar serie">${saved.done?'✓':'○'}</button></div>`;}).join('')}<button class="ghost wide save-ex" data-i="${i}">Guardar ejercicio</button></section>`;}).join('');
  bindWorkoutDrafts();if(state&&restoreExercisePosition){restoreExercisePosition=false;requestAnimationFrame(()=>document.querySelector(`[data-ex="${state.currentExercise}"]`)?.scrollIntoView({block:'center'}));}
}
function readDraftsFromDom(ctx=workoutContext()){
  if(ctx.plan.type!=='Gimnasio'||!document.querySelector('.exercise'))return null;
  return ctx.plan.exercises.map((ex,i)=>{const box=document.querySelector(`[data-ex="${i}"]`);if(!box)return initialDraft(ex,ctx);const sets=[...box.querySelectorAll('.set-row')].map(row=>{const inputs=row.querySelectorAll('input');return {kg:inputs[0].value,reps:inputs[1].value,rir:inputs[2].value,done:row.querySelector('.set-done').classList.contains('checked')};});return {name:ex.name,sets};});
}
function captureActiveDrafts(currentExercise=activeSession.state?.currentExercise){if(!activeSession.state||activeSession.state.phase!=='active')return;const drafts=readDraftsFromDom();if(drafts)activeSession.replaceDrafts(drafts,currentExercise);}
function bindWorkoutDrafts(){
  document.querySelectorAll('.exercise').forEach(box=>{const index=+box.dataset.ex;box.addEventListener('focusin',()=>{if(activeSession.state)activeSession.setCurrentExercise(index);});box.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>captureActiveDrafts(index)));});
  document.querySelectorAll('.set-done').forEach(btn=>btn.onclick=()=>completeSet(btn));document.querySelectorAll('.save-ex').forEach(btn=>btn.onclick=()=>saveExercise(+btn.dataset.i));
}
function workoutRecord(index){const ctx=workoutContext(),drafts=readDraftsFromDom(ctx)||activeSession.state?.exercises||[],ex=ctx.plan.exercises[index],draft=drafts[index];return {date:ctx.dateKey,day:ctx.plan.name,exercise:ex.name,sets:draft?.sets||[],updatedAt:nowIso()};}
async function saveExercise(index){captureActiveDrafts(index);const record=workoutRecord(index);data.workouts=data.workouts.filter(x=>workoutKey(x)!==workoutKey(record));data.workouts.push(record);persist();renderProgress();try{await sync.syncRecord();}catch{}}
function completeSet(btn){btn.classList.toggle('checked');btn.textContent=btn.classList.contains('checked')?'✓':'○';const index=+btn.closest('.exercise').dataset.ex;captureActiveDrafts(index);saveExercise(index);if(btn.classList.contains('checked')&&activeSession.state)startRest(workoutContext().plan.exercises[index].rest);}

function startSession(){if(activeSession.state)return;const ctx=currentContext();if(ctx.plan.type!=='Gimnasio')return;const drafts=readDraftsFromDom(ctx)||ctx.plan.exercises.map(ex=>initialDraft(ex,ctx));activeSession.start({sessionDate:ctx.dateKey,dayIndex:ctx.dayIndex,day:ctx.plan.name,label:ctx.plan.label,intensity:ctx.plan.intensity,exercises:drafts});restoreExercisePosition=false;renderAll(false);}
function drawSessionTimer(){const state=activeSession.state;if(!state){$('sessionTimer').textContent='00:00';return;}const seconds=state.phase==='summary'&&state.summary?(state.summary.durationSeconds??Math.round(state.summary.duration*60)):elapsedSeconds(state.startedAt);$('sessionTimer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function startRest(seconds){activeSession.startRest(seconds);drawRest();startTimerIntervals();}
function drawRest(){
  const state=activeSession.state,rest=state?.rest,remaining=remainingRestSeconds(rest);
  if(!rest||remaining<=0){if(rest)activeSession.reconcileTime();clearInterval(restTick);restTick=null;$('restStatus').textContent=activeSession.state?.restFinishedAt?'El descanso terminó.':'';$('restOverlay').classList.add('hidden');return;}
  $('restOverlay').classList.remove('hidden');$('restStatus').textContent='';$('restTime').textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
}
function stopRest(){activeSession.stopRest();$('restOverlay').classList.add('hidden');}
function startTimerIntervals(){clearInterval(sessionTick);clearInterval(restTick);drawSessionTimer();drawRest();if(activeSession.state?.phase==='active')sessionTick=setInterval(drawSessionTimer,1000);if(activeSession.state?.rest)restTick=setInterval(drawRest,500);}
function finishSession(){
  const state=activeSession.state;if(!state||state.phase!=='active')return;captureActiveDrafts();clearInterval(sessionTick);clearInterval(restTick);const endedAt=nowIso(),durationSeconds=elapsedSeconds(state.startedAt),duration=Math.max(1,Math.round(durationSeconds/60)),exercises=activeSession.state.exercises,volume=exercises.reduce((sum,ex)=>sum+volumeOfSets(ex.sets),0);
  activeSession.prepareSummary({date:state.sessionDate,day:state.day,label:state.label,startedAt:state.startedAt,endedAt,duration,durationSeconds,volume,rpe:7,notes:''});renderAll(false);
}
function renderSessionSummary(){
  const state=activeSession.state,summary=state?.summary,visible=state?.phase==='summary'&&!!summary;$('sessionSummary').classList.toggle('hidden',!visible);if(!visible)return;
  $('summaryMetrics').innerHTML=`<div><strong>${summary.duration}</strong><span>min</span></div><div><strong>${state.exercises.length}</strong><span>ejercicios</span></div><div><strong>${Math.round(summary.volume).toLocaleString('es-AR')}</strong><span>kg volumen</span></div>`;$('sessionRpe').value=summary.rpe??7;$('sessionNotes').value=summary.notes||'';$('summarySaveStatus').textContent=state.saveMessage||'';$('saveSessionSummary').disabled=state.saveStatus==='saving';
}
async function saveSessionSummary(){
  const state=activeSession.state;if(!state?.summary)return;activeSession.updateSummary({rpe:+$('sessionRpe').value,notes:$('sessionNotes').value});
  const result=await commitPendingSession({store:activeSession,requireRemote:!!sync.user,syncRemote:()=>sync.syncRecord(),persistLocal:snapshot=>{
    const records=snapshot.exercises.map(ex=>({date:snapshot.sessionDate,day:snapshot.day,exercise:ex.name,sets:ex.sets,updatedAt:nowIso()}));for(const record of records){data.workouts=data.workouts.filter(x=>workoutKey(x)!==workoutKey(record));data.workouts.push(record);}const record={...snapshot.summary,updatedAt:nowIso()};data.sessions=data.sessions.filter(x=>!(x.date===record.date&&x.label===record.label));data.sessions.push(record);persist();
  }});
  if(result.saved){renderAll(false);switchView('progressView');}else renderSessionSummary();
}

function renderFootball(){const ctx=currentContext(),show=[1,3,6].includes(ctx.dayIndex);$('footballQuickCard').classList.toggle('hidden',!show);if(!show)return;const type=ctx.dayIndex===6?'Partido':ctx.dayIndex===3?'Amistoso':'Entrenamiento equipo';$('footballTitle').textContent=type;const rec=data.football.find(x=>x.date===ctx.dateKey&&x.type===type);if(rec){$('footballDuration').value=rec.duration;$('footballRpe').value=rec.rpe;$('footballMinutes').value=rec.minutes||'';}updateFootballLoad();}
function updateFootballLoad(){const d=+$('footballDuration').value||0,r=+$('footballRpe').value||0;$('footballLoadPreview').textContent=`Carga estimada: ${d&&r?d*r:'—'} AU`;}
async function saveFootball(){const ctx=currentContext(),type=ctx.dayIndex===6?'Partido':ctx.dayIndex===3?'Amistoso':'Entrenamiento equipo',rec={date:ctx.dateKey,type,duration:+$('footballDuration').value,rpe:+$('footballRpe').value,minutes:+$('footballMinutes').value||0,notes:'',updatedAt:nowIso()};if(!rec.duration||!rec.rpe)return alert('Completá duración e intensidad RPE.');data.football=data.football.filter(x=>!(x.date===rec.date&&x.type===rec.type));data.football.push(rec);persistAndRender();try{await sync.syncRecord();}catch{}}
async function saveReadiness(){const date=currentContext().dateKey,rec={date,sleep:+$('sleep').value,energy:+$('energy').value,fatigue:6-(+$('freshness').value),pain:+$('pain').value,painArea:$('painArea').value,updatedAt:nowIso()};data.readiness=data.readiness.filter(x=>x.date!==date);data.readiness.push(rec);persistAndRender();try{await sync.syncRecord();}catch{}}
async function saveMatch(){const date=currentContext().dateKey,rec={date,energy:+$('matchEnergy').value,legs:+$('legs').value,performance:+$('performance').value,notes:$('matchNotes').value,updatedAt:nowIso()};data.matches=data.matches.filter(x=>x.date!==date);data.matches.push(rec);persistAndRender();try{await sync.syncRecord();}catch{}alert('Partido guardado');}
function hydrateToday(){const date=currentContext().dateKey,r=latestReadiness(date);if(r){$('sleep').value=r.sleep;$('energy').value=r.energy;$('freshness').value=6-r.fatigue;$('pain').value=r.pain;$('painArea').value=r.painArea||'';}['sleep','energy','freshness','pain'].forEach(id=>$(id+'Val').textContent=$(id).value);const m=data.matches.find(x=>x.date===date);if(m){$('matchEnergy').value=m.energy;$('legs').value=m.legs;$('performance').value=m.performance;$('matchNotes').value=m.notes||'';}['matchEnergy','legs','performance'].forEach(id=>$(id+'Val').textContent=$(id).value);}

function renderProgress(){
  $('workoutCount').textContent=new Set(data.workouts.map(x=>x.date)).size;const since=new Date();since.setDate(since.getDate()-6);const sinceKey=localDateKey(since);$('footballLoad7').textContent=Math.round(data.football.filter(x=>x.date>=sinceKey).reduce((a,x)=>a+(+x.duration*+x.rpe),0));const scores=data.readiness.map(readinessScore).filter(x=>x!=null);$('avgReadiness').textContent=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):'—';
  lineChart($('readinessChart'),[...data.readiness].sort((a,b)=>a.date.localeCompare(b.date)).slice(-8).map(x=>({label:x.date.slice(5),value:readinessScore(x)})),{min:0,max:100});lineChart($('matchChart'),[...data.matches].sort((a,b)=>a.date.localeCompare(b.date)).slice(-8).map(x=>({label:x.date.slice(5),value:+x.legs})),{min:1,max:5});
  const names=[...new Set(data.workouts.map(x=>x.exercise))].sort(),select=$('exerciseSelect'),current=select.value;select.innerHTML=names.length?names.map(n=>`<option>${n}</option>`).join(''):'<option>Sin datos</option>';if(names.includes(current))select.value=current;renderStrength();const items=[...data.sessions.map(s=>({date:s.date,title:s.label,detail:`${s.duration} min · RPE ${s.rpe||'—'}`})),...data.matches.map(m=>({date:m.date,title:'Partido',detail:`Piernas ${m.legs}/5 · Rendimiento ${m.performance}/5`})),...data.football.map(f=>({date:f.date,title:f.type,detail:`${f.duration} min · RPE ${f.rpe} · carga ${f.duration*f.rpe}`}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12);$('history').innerHTML=items.length?items.map(x=>`<div class="history-item"><strong>${x.title}</strong><span>${x.date} · ${x.detail}</span></div>`).join(''):'<p class="muted">Todavía no hay registros suficientes.</p>';
}
function renderStrength(){const name=$('exerciseSelect').value,points=[...data.workouts].filter(x=>x.exercise===name).sort((a,b)=>a.date.localeCompare(b.date)).slice(-10).map(w=>({label:w.date.slice(5),value:Math.max(0,...w.sets.map(s=>Number(s.kg)||0))})),max=Math.max(20,...points.map(x=>x.value));lineChart($('strengthChart'),points,{min:0,max:Math.ceil(max/10)*10,suffix:'kg'});}
function renderMatch(){$('matchSection').classList.toggle('hidden',currentContext().dayIndex!==6);}
function renderAuth(){const signed=!!sync.user;$('signedOutBox').classList.toggle('hidden',signed);$('signedInBox').classList.toggle('hidden',!signed);if(signed){$('userEmail').textContent=sync.user.email||'usuario';$('authStatus').textContent=navigator.onLine?sync.lastState.text:'Sin conexión';}else setSyncBadge('local','Solo local');}
function setAuthMessage(msg,error=false){$('authMessage').textContent=msg;$('authMessage').className=error?'advice error-text':'advice';}
function switchView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));$(id).classList.add('active-view');document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===id));if(id==='progressView')setTimeout(renderProgress,0);window.scrollTo({top:0,behavior:'smooth'});}
function renderAll(capture=true){if(capture)captureActiveDrafts();lastRenderedDate=currentContext().dateKey;hydrateToday();renderDashboard();renderWeek();renderWorkout();renderFootball();renderMatch();renderProgress();renderAuth();renderSessionSummary();startTimerIntervals();}
async function resetAll(){const scope=sync.user?'este dispositivo Y tu cuenta sincronizada':'este dispositivo';if(!confirm(`¿Borrar todos los registros de ${scope}?`))return;activeSession.clear();if(sync.user){try{await sync.deleteAll();}catch(error){alert('El borrado quedó pendiente de sincronizar: '+error.message);}location.reload();return;}data=emptyData();clearLocalData(storageOwner);location.reload();}

['sleep','energy','freshness','pain','matchEnergy','legs','performance'].forEach(id=>$(id).addEventListener('input',()=>{$(id+'Val').textContent=$(id).value;if(['sleep','energy','freshness','pain'].includes(id))renderDashboard();}));['footballDuration','footballRpe'].forEach(id=>$(id).addEventListener('input',updateFootballLoad));
$('sessionRpe').addEventListener('input',()=>activeSession.updateSummary({rpe:+$('sessionRpe').value}));$('sessionNotes').addEventListener('input',()=>activeSession.updateSummary({notes:$('sessionNotes').value}));
$('saveReadiness').onclick=saveReadiness;$('saveMatch').onclick=saveMatch;$('saveFootball').onclick=saveFootball;$('startSessionBtn').onclick=startSession;$('finishSessionBtn').onclick=finishSession;$('saveSessionSummary').onclick=saveSessionSummary;$('addRestBtn').onclick=()=>{activeSession.extendRest(30);drawRest();};$('skipRestBtn').onclick=stopRest;$('resetBtn').onclick=resetAll;$('exerciseSelect').onchange=renderStrength;
$('profileBtn').onclick=()=>{$('authSection').classList.toggle('hidden');};$('openAuthSettings').onclick=()=>{$('authSection').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});};$('closeAuthBtn').onclick=()=>$('authSection').classList.add('hidden');document.querySelectorAll('.nav-btn').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$('loginBtn').onclick=async()=>{try{setAuthMessage('Iniciando sesión…');await sync.signIn($('email').value.trim(),$('password').value);setAuthMessage('Sesión iniciada.');}catch(error){setAuthMessage(error.message,true);}};$('signupBtn').onclick=async()=>{try{const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<6)return setAuthMessage('Email válido y contraseña de al menos 6 caracteres.',true);const result=await sync.signUp(email,password);setAuthMessage(result.session?'Cuenta creada.':'Cuenta creada. Revisá tu email para confirmarla.');}catch(error){setAuthMessage(error.message,true);}};
$('logoutBtn').onclick=async()=>{await sync.signOut();renderAuth();};$('syncNowBtn').onclick=async()=>{try{await sync.syncAll();renderAll();}catch(error){setAuthMessage(error.message,true);}};

renderAll(false);
try{const user=await sync.init();renderAuth();if(user){await sync.syncAll();renderAll();}}catch(error){console.warn(error);setAuthMessage('Supabase no está disponible. La app sigue funcionando en modo local.',true);renderAuth();}
window.addEventListener('online',()=>{renderAuth();sync.syncAll().then(()=>renderAll()).catch(()=>{});});window.addEventListener('offline',renderAuth);document.addEventListener('visibilitychange',()=>{if(!document.hidden){activeSession.reconcileTime();renderAll();}});setInterval(()=>{if(localDateKey()!==lastRenderedDate)renderAll();},60000);
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
