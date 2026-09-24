import {plan,localDateKey,daysUntilSaturday} from './plan.js';
import {loadLocalData,saveLocalData,clearLocalData,nowIso,emptyData,workoutKey} from './store.js';
import {SyncService} from './sync.js';
import {lineChart} from './charts.js';
import {ActiveSessionStore,commitPendingSession,elapsedSeconds,remainingRestSeconds} from './active-session.js';
import {exerciseId,sameExercise} from './exercise-identity.js';
import {completedGymSessionCount,sessionVolume,strengthPoints} from './metrics.js';
import {progressionSuggestion} from './progression.js';
import {appendTextElement,clearNode} from './safe-dom.js';
import {hasWorkoutInput,validateFootball,validateMatch,validateReadiness,validateSessionSummary,validateWorkout} from './validation.js';
import {mayStartNewWork} from './pwa-update-gate.js';
import {restorePwaFormDrafts,clearPwaFormDrafts} from './pwa-form-drafts.js';
import {rolloutReady} from './v3/rollout-boot.js';
import {rolloutControl} from './v3/rollout-boot.js';
import {reconnectV3Auth} from './v3/auth-reconnect.js';
import {rolloutSnapshot} from './v3/rollout-state.js';

await rolloutReady;

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
  if(storageOwner!==(user?.id||'guest'))clearPwaFormDrafts(['sleep','energy','freshness','pain','painArea','footballDuration','footballRpe','footballMinutes','matchEnergy','legs','performance','matchNotes']);
  captureActiveDrafts();storageOwner=user?.id||'guest';data=loadLocalData(storageOwner);activeSession.setOwner(storageOwner);restoreExercisePosition=true;persistAndRender(false);
  setSyncBadge(user?'pending':'local',user?(navigator.onLine?'Pendiente de sincronizar':'Sin conexión'):'Solo local');
  document.dispatchEvent(new CustomEvent('nico-fit:auth',{detail:{userId:user?.id||null}}));
}
document.addEventListener('nico-fit:auth-request',()=>document.dispatchEvent(new CustomEvent('nico-fit:auth',{detail:{userId:sync.user?.id||null}})));
document.addEventListener('nico-fit:pwa-safety-request',event=>{event.detail.critical ||= sync.busy;event.detail.userId=storageOwner;});
const allowNewWork=()=>{if(mayStartNewWork())return true;alert(rolloutSnapshot()?.updateRequired?'Actualización requerida. Tus datos locales quedan conservados; actualizá la app antes de continuar.':'Esta pestaña tiene una actualización pendiente. Terminá la sesión abierta o recargá cuando sea seguro.');return false;};
function setSyncBadge(state,text){$('syncBadge').className=`sync-badge ${state}`;$('syncBadge').textContent=text;}
function readinessScore(r){if(!r)return null;const freshness=6-(+r.fatigue||3);return Math.round(((+r.sleep + +r.energy + freshness)/15)*100-Math.max(0,(+r.pain||0)-2)*3);}
function readinessLevel(score){if(score==null)return ['neutral','Sin registrar'];if(score>=78)return ['good',`${score}% · Bueno`];if(score>=60)return ['mid',`${score}% · Intermedio`];return ['low',`${score}% · Bajo`];}
function latestReadiness(date=currentContext().dateKey){return data.readiness.find(x=>x.date===date);}
function latestPreviousWorkout(exercise,date){return [...data.workouts].filter(x=>sameExercise(x.exerciseId||x.exercise,exercise)&&x.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0]||null;}
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
function suggestion(ex,ctx){return progressionSuggestion({exercise:ex,previous:latestPreviousWorkout(ex,ctx.dateKey),readinessScore:readinessScore(latestReadiness(ctx.dateKey)),dayIndex:ctx.dayIndex,now:ctx.now});}
function initialDraft(ex,ctx){const active=ctx.active?.exercises.find(x=>sameExercise(x.exerciseId||x.name,ex));if(active)return active;const saved=data.workouts.find(w=>w.date===ctx.dateKey&&sameExercise(w.exerciseId||w.exercise,ex));return {exerciseId:ex.id,name:ex.name,sets:Array.from({length:ex.sets},(_,index)=>saved?.sets?.[index]||{})};}
function renderWorkout(){
  const ctx=workoutContext(),state=activeSession.state;$('workoutTitle').textContent=state?.label||ctx.plan.label;$('workoutTag').textContent=state?.intensity||ctx.plan.intensity;$('workoutGuidance').textContent=guidance(ctx);
  $('startSessionBtn').classList.toggle('hidden',ctx.plan.type!=='Gimnasio'||!!state);$('finishSessionBtn').classList.toggle('hidden',!state||state.phase!=='active');
  const list=clearNode($('exerciseList'));
  if(ctx.plan.type!=='Gimnasio'){const section=list.ownerDocument.createElement('section');section.className='card';appendTextElement(section,'p',`Hoy no hay rutina de gimnasio. Usá Inicio para registrar la carga de ${ctx.plan.type.toLowerCase()}.`,'muted');list.appendChild(section);return;}
  ctx.plan.exercises.forEach((ex,i)=>{
    const sug=suggestion(ex,ctx),draft=initialDraft(ex,ctx),section=list.ownerDocument.createElement('section');section.className=`card exercise ${state?.currentExercise===i?'current-exercise':''}`;section.dataset.ex=i;
    const title=list.ownerDocument.createElement('div');title.className='exercise-title';const titleText=list.ownerDocument.createElement('div');appendTextElement(titleText,'h3',ex.name);appendTextElement(titleText,'p',`${ex.rx} · descanso ${Math.round(ex.rest/60*10)/10} min`);title.append(titleText);appendTextElement(title,'span',`${i+1}/${ctx.plan.exercises.length}`,'tag');section.append(title);appendTextElement(section,'div',sug.text,'previous-box');
    const head=list.ownerDocument.createElement('div');head.className='set-head';['Serie','kg','reps','RIR',''].forEach(text=>appendTextElement(head,'span',text));section.append(head);
    Array.from({length:ex.sets},(_,setIndex)=>{const saved=draft.sets?.[setIndex]||{},row=list.ownerDocument.createElement('div');row.className='set-row';appendTextElement(row,'span',`S${setIndex+1}`);
      const fields=[{field:'kg',mode:'decimal',step:'0.5',placeholder:sug.kg||'kg',label:`Peso de ${ex.name}, serie ${setIndex+1}`},{field:'reps',mode:'numeric',placeholder:ex.min,label:`Repeticiones o segundos de ${ex.name}, serie ${setIndex+1}`},{field:'rir',mode:'numeric',min:'0',max:'5',placeholder:'2',label:`RIR de ${ex.name}, serie ${setIndex+1}`}];
      fields.forEach(config=>{const input=list.ownerDocument.createElement('input');input.type='number';input.inputMode=config.mode;input.dataset.f=config.field;input.value=saved[config.field]??'';input.placeholder=String(config.placeholder);input.setAttribute('aria-label',config.label);if(config.step)input.step=config.step;if(config.min)input.min=config.min;if(config.max)input.max=config.max;row.append(input);});
      const done=list.ownerDocument.createElement('button');done.type='button';done.className=`set-done ${saved.done?'checked':''}`;done.dataset.set=setIndex;done.setAttribute('aria-label',`${saved.done?'Desmarcar':'Completar'} serie ${setIndex+1} de ${ex.name}`);done.setAttribute('aria-pressed',String(!!saved.done));done.textContent=saved.done?'✓':'○';row.append(done);section.append(row);
    });
    const save=list.ownerDocument.createElement('button');save.type='button';save.className='ghost wide save-ex';save.dataset.i=i;save.textContent='Guardar ejercicio';section.append(save);list.append(section);
  });
  bindWorkoutDrafts();if(state&&restoreExercisePosition){restoreExercisePosition=false;requestAnimationFrame(()=>document.querySelector(`[data-ex="${state.currentExercise}"]`)?.scrollIntoView({block:'center'}));}
}
function readDraftsFromDom(ctx=workoutContext()){
  if(ctx.plan.type!=='Gimnasio'||!document.querySelector('.exercise'))return null;
  return ctx.plan.exercises.map((ex,i)=>{const box=document.querySelector(`[data-ex="${i}"]`);if(!box)return initialDraft(ex,ctx);const sets=[...box.querySelectorAll('.set-row')].map(row=>{const inputs=row.querySelectorAll('input');return {kg:inputs[0].value,reps:inputs[1].value,rir:inputs[2].value,done:row.querySelector('.set-done').classList.contains('checked')};});return {exerciseId:ex.id,name:ex.name,sets};});
}
function captureActiveDrafts(currentExercise=activeSession.state?.currentExercise){if(!activeSession.state||activeSession.state.phase!=='active')return;const drafts=readDraftsFromDom();if(drafts)activeSession.replaceDrafts(drafts,currentExercise);}
function bindWorkoutDrafts(){
  document.querySelectorAll('.exercise').forEach(box=>{const index=+box.dataset.ex;box.addEventListener('focusin',()=>{if(activeSession.state)activeSession.setCurrentExercise(index);});box.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>captureActiveDrafts(index)));});
  document.querySelectorAll('.set-done').forEach(btn=>btn.onclick=()=>completeSet(btn));document.querySelectorAll('.save-ex').forEach(btn=>btn.onclick=()=>saveExercise(+btn.dataset.i));
}
function workoutRecord(index){const ctx=workoutContext(),drafts=readDraftsFromDom(ctx)||activeSession.state?.exercises||[],ex=ctx.plan.exercises[index],draft=drafts[index];return {date:ctx.dateKey,day:ctx.plan.name,exerciseId:ex.id,exercise:ex.name,sets:draft?.sets||[],updatedAt:nowIso()};}
async function saveExercise(index,{quiet=false}={}){if(!allowNewWork())return false;captureActiveDrafts(index);const record=workoutRecord(index),validation=validateWorkout(record,record.sets);if(!validation.valid){if(!quiet)alert(validation.message);return false;}record.sets=validation.value.sets;data.workouts=data.workouts.filter(x=>workoutKey(x)!==workoutKey(record));data.workouts.push(record);persist();renderProgress();try{await sync.syncRecord();}catch{}return true;}
async function completeSet(btn){if(!allowNewWork())return;btn.classList.toggle('checked');const checked=btn.classList.contains('checked'),index=+btn.closest('.exercise').dataset.ex,exercise=workoutContext().plan.exercises[index];btn.textContent=checked?'✓':'○';btn.setAttribute('aria-pressed',String(checked));btn.setAttribute('aria-label',`${checked?'Desmarcar':'Completar'} serie ${Number(btn.dataset.set)+1} de ${exercise.name}`);captureActiveDrafts(index);const saved=await saveExercise(index);if(saved&&checked&&activeSession.state)startRest(exercise.rest);}

function startSession(){if(!allowNewWork()||activeSession.state)return;const ctx=currentContext();if(ctx.plan.type!=='Gimnasio')return;const drafts=readDraftsFromDom(ctx)||ctx.plan.exercises.map(ex=>initialDraft(ex,ctx));activeSession.start({sessionDate:ctx.dateKey,dayIndex:ctx.dayIndex,day:ctx.plan.name,label:ctx.plan.label,intensity:ctx.plan.intensity,exercises:drafts});restoreExercisePosition=false;renderAll(false);}
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
  const state=activeSession.state;if(!state||state.phase!=='active'||!allowNewWork())return;captureActiveDrafts();clearInterval(sessionTick);clearInterval(restTick);const endedAt=nowIso(),durationSeconds=elapsedSeconds(state.startedAt),duration=Math.max(1,Math.round(durationSeconds/60)),exercises=activeSession.state.exercises;
  activeSession.prepareSummary({date:state.sessionDate,day:state.day,label:state.label,startedAt:state.startedAt,endedAt,duration,durationSeconds,volume:sessionVolume(exercises),rpe:7,notes:''});renderAll(false);$('sessionRpe').focus();
}
function renderSessionSummary(){
  const state=activeSession.state,summary=state?.summary,visible=state?.phase==='summary'&&!!summary;$('sessionSummary').classList.toggle('hidden',!visible);if(!visible)return;
  const metrics=clearNode($('summaryMetrics'));[[summary.duration,'min'],[state.exercises.filter(ex=>ex.sets.some(hasWorkoutInput)).length,'ejercicios'],[Math.round(summary.volume).toLocaleString('es-AR'),'kg volumen']].forEach(([value,label])=>{const item=metrics.ownerDocument.createElement('div');appendTextElement(item,'strong',value);appendTextElement(item,'span',label);metrics.append(item);});$('sessionRpe').value=summary.rpe??7;$('sessionNotes').value=summary.notes||'';$('summarySaveStatus').textContent=state.saveMessage||'';$('saveSessionSummary').disabled=state.saveStatus==='saving';
}
async function saveSessionSummary(){
  const state=activeSession.state;if(!state?.summary||!allowNewWork())return;const summaryValidation=validateSessionSummary({...state.summary,rpe:+$('sessionRpe').value,notes:$('sessionNotes').value});if(!summaryValidation.valid){$('summarySaveStatus').textContent=summaryValidation.message;$('sessionRpe').focus();return;}for(const exercise of state.exercises.filter(ex=>ex.sets.some(hasWorkoutInput))){const validation=validateWorkout(exercise,exercise.sets);if(!validation.valid){$('summarySaveStatus').textContent=`${exercise.name}: ${validation.message}`;return;}}activeSession.updateSummary({rpe:+$('sessionRpe').value,notes:$('sessionNotes').value});
  const result=await commitPendingSession({store:activeSession,requireRemote:!!sync.user,syncRemote:()=>sync.syncRecord(),persistLocal:snapshot=>{
    const records=snapshot.exercises.filter(ex=>ex.sets.some(hasWorkoutInput)).map(ex=>({date:snapshot.sessionDate,day:snapshot.day,exerciseId:ex.exerciseId||exerciseId(ex.name),exercise:ex.name,sets:ex.sets,updatedAt:nowIso()})).map(record=>{const validation=validateWorkout(record,record.sets);return {...record,sets:validation.value.sets};});for(const record of records){data.workouts=data.workouts.filter(x=>workoutKey(x)!==workoutKey(record));data.workouts.push(record);}const record={...snapshot.summary,updatedAt:nowIso()};data.sessions=data.sessions.filter(x=>!(x.date===record.date&&x.label===record.label));data.sessions.push(record);persist();
  }});
  if(result.saved){renderAll(false);switchView('progressView');}else renderSessionSummary();
}

function renderFootball(){const ctx=currentContext(),show=[1,3,6].includes(ctx.dayIndex);$('footballQuickCard').classList.toggle('hidden',!show);if(!show)return;const type=ctx.dayIndex===6?'Partido':ctx.dayIndex===3?'Amistoso':'Entrenamiento equipo';$('footballTitle').textContent=type;const rec=data.football.find(x=>x.date===ctx.dateKey&&x.type===type);if(rec){$('footballDuration').value=rec.duration;$('footballRpe').value=rec.rpe;$('footballMinutes').value=rec.minutes||'';}updateFootballLoad();}
function updateFootballLoad(){const d=+$('footballDuration').value||0,r=+$('footballRpe').value||0;$('footballLoadPreview').textContent=`Carga estimada: ${d&&r?d*r:'—'} AU`;}
async function saveFootball(){if(!allowNewWork())return;const ctx=currentContext(),type=ctx.dayIndex===6?'Partido':ctx.dayIndex===3?'Amistoso':'Entrenamiento equipo',rec={date:ctx.dateKey,type,duration:+$('footballDuration').value,rpe:+$('footballRpe').value,minutes:$('footballMinutes').value===''?0:+$('footballMinutes').value,notes:'',updatedAt:nowIso()},validation=validateFootball(rec);if(!validation.valid)return alert(validation.message);data.football=data.football.filter(x=>!(x.date===rec.date&&x.type===rec.type));data.football.push(rec);persistAndRender();clearPwaFormDrafts(['footballDuration','footballRpe','footballMinutes']);try{await sync.syncRecord();}catch{}}
async function saveReadiness(){if(!allowNewWork())return;const date=currentContext().dateKey,rec={date,sleep:+$('sleep').value,energy:+$('energy').value,fatigue:6-(+$('freshness').value),pain:+$('pain').value,painArea:$('painArea').value,updatedAt:nowIso()},validation=validateReadiness(rec);if(!validation.valid)return alert(validation.message);data.readiness=data.readiness.filter(x=>x.date!==date);data.readiness.push(rec);persistAndRender();clearPwaFormDrafts(['sleep','energy','freshness','pain','painArea']);try{await sync.syncRecord();}catch{}}
async function saveMatch(){if(!allowNewWork())return;const date=currentContext().dateKey,rec={date,energy:+$('matchEnergy').value,legs:+$('legs').value,performance:+$('performance').value,notes:$('matchNotes').value,updatedAt:nowIso()},validation=validateMatch(rec);if(!validation.valid)return alert(validation.message);data.matches=data.matches.filter(x=>x.date!==date);data.matches.push(rec);persistAndRender();clearPwaFormDrafts(['matchEnergy','legs','performance','matchNotes']);try{await sync.syncRecord();}catch{}alert('Partido guardado');}
function hydrateToday(){const date=currentContext().dateKey,r=latestReadiness(date);if(r){$('sleep').value=r.sleep;$('energy').value=r.energy;$('freshness').value=6-r.fatigue;$('pain').value=r.pain;$('painArea').value=r.painArea||'';}['sleep','energy','freshness','pain'].forEach(id=>$(id+'Val').textContent=$(id).value);const m=data.matches.find(x=>x.date===date);if(m){$('matchEnergy').value=m.energy;$('legs').value=m.legs;$('performance').value=m.performance;$('matchNotes').value=m.notes||'';}['matchEnergy','legs','performance'].forEach(id=>$(id+'Val').textContent=$(id).value);}

function renderProgress(){
  $('workoutCount').textContent=completedGymSessionCount(data.sessions);const since=new Date();since.setDate(since.getDate()-6);const sinceKey=localDateKey(since);$('footballLoad7').textContent=Math.round(data.football.filter(x=>x.date>=sinceKey).reduce((a,x)=>a+(+x.duration*+x.rpe),0));const scores=data.readiness.map(readinessScore).filter(x=>x!=null);$('avgReadiness').textContent=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):'—';
  lineChart($('readinessChart'),[...data.readiness].sort((a,b)=>a.date.localeCompare(b.date)).slice(-8).map(x=>({label:x.date.slice(5),value:readinessScore(x)})),{min:0,max:100});lineChart($('matchChart'),[...data.matches].sort((a,b)=>a.date.localeCompare(b.date)).slice(-8).map(x=>({label:x.date.slice(5),value:+x.legs})),{min:1,max:5});
  const identities=new Map();data.workouts.forEach(workout=>{const id=exerciseId(workout.exerciseId||workout.exercise);if(id&&!identities.has(id))identities.set(id,workout.exercise);});const select=$('exerciseSelect'),current=select.value;clearNode(select);if(identities.size){[...identities].sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id,name])=>{const option=select.ownerDocument.createElement('option');option.value=id;option.textContent=name;select.append(option);});if(identities.has(current))select.value=current;}else appendTextElement(select,'option','Sin datos');renderStrength();
  const items=[...data.sessions.map(s=>({date:s.date,title:s.label,detail:`${s.duration} min · RPE ${s.rpe||'—'}`})),...data.matches.map(m=>({date:m.date,title:'Partido',detail:`Piernas ${m.legs}/5 · Rendimiento ${m.performance}/5`})),...data.football.map(f=>({date:f.date,title:f.type,detail:`${f.duration} min · RPE ${f.rpe} · carga ${f.duration*f.rpe}`}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12),history=clearNode($('history'));if(!items.length){appendTextElement(history,'p','Todavía no hay registros suficientes.','muted');return;}items.forEach(item=>{const row=history.ownerDocument.createElement('div');row.className='history-item';appendTextElement(row,'strong',item.title);appendTextElement(row,'span',`${item.date} · ${item.detail}`);history.append(row);});
}
function renderStrength(){const points=strengthPoints(data.workouts,$('exerciseSelect').value).slice(-10),max=Math.max(20,...points.map(x=>x.value));lineChart($('strengthChart'),points,{min:0,max:Math.ceil(max/10)*10,suffix:'kg'});}
function renderMatch(){$('matchSection').classList.toggle('hidden',currentContext().dayIndex!==6);}
function renderAuth(){const signed=!!sync.user;$('signedOutBox').classList.toggle('hidden',signed);$('signedInBox').classList.toggle('hidden',!signed);if(signed){$('userEmail').textContent=sync.user.email||'usuario';$('authStatus').textContent=navigator.onLine?sync.lastState.text:'Sin conexión';}else setSyncBadge('local','Solo local');}
function setAuthMessage(msg,error=false){$('authMessage').textContent=msg;$('authMessage').className=error?'advice error-text':'advice';}
function switchView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));$(id).classList.add('active-view');document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===id));if(id==='progressView')setTimeout(renderProgress,0);window.scrollTo({top:0,behavior:'smooth'});}
function renderAll(capture=true){if(capture)captureActiveDrafts();lastRenderedDate=currentContext().dateKey;hydrateToday();renderDashboard();renderWeek();renderWorkout();renderFootball();renderMatch();renderProgress();renderAuth();renderSessionSummary();restorePwaFormDrafts();['sleep','energy','freshness','pain','matchEnergy','legs','performance'].forEach(id=>$(id+'Val').textContent=$(id).value);updateFootballLoad();startTimerIntervals();}
async function resetAll(){if(!allowNewWork())return;const scope=sync.user?'este dispositivo Y tu cuenta sincronizada':'este dispositivo';if(!confirm(`¿Borrar todos los registros de ${scope}?`))return;activeSession.clear();if(sync.user){try{await sync.deleteAll();}catch(error){alert('El borrado quedó pendiente de sincronizar: '+error.message);}location.reload();return;}data=emptyData();clearLocalData(storageOwner);location.reload();}

['sleep','energy','freshness','pain','matchEnergy','legs','performance'].forEach(id=>$(id).addEventListener('input',()=>{$(id+'Val').textContent=$(id).value;if(['sleep','energy','freshness','pain'].includes(id))renderDashboard();}));['footballDuration','footballRpe'].forEach(id=>$(id).addEventListener('input',updateFootballLoad));
$('sessionRpe').addEventListener('input',()=>activeSession.updateSummary({rpe:+$('sessionRpe').value}));$('sessionNotes').addEventListener('input',()=>activeSession.updateSummary({notes:$('sessionNotes').value}));
$('saveReadiness').onclick=saveReadiness;$('saveMatch').onclick=saveMatch;$('saveFootball').onclick=saveFootball;$('startSessionBtn').onclick=startSession;$('finishSessionBtn').onclick=finishSession;$('saveSessionSummary').onclick=saveSessionSummary;$('addRestBtn').onclick=()=>{activeSession.extendRest(30);drawRest();};$('skipRestBtn').onclick=stopRest;$('resetBtn').onclick=resetAll;$('exerciseSelect').onchange=renderStrength;
$('profileBtn').onclick=()=>{$('authSection').classList.toggle('hidden');};$('openAuthSettings').onclick=()=>{$('authSection').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});};$('closeAuthBtn').onclick=()=>$('authSection').classList.add('hidden');document.querySelectorAll('.nav-btn').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
$('loginBtn').onclick=async()=>{try{setAuthMessage('Iniciando sesión…');await sync.signIn($('email').value.trim(),$('password').value);setAuthMessage('Sesión iniciada.');}catch(error){setAuthMessage(error.message,true);}};$('signupBtn').onclick=async()=>{try{const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<6)return setAuthMessage('Email válido y contraseña de al menos 6 caracteres.',true);const result=await sync.signUp(email,password);setAuthMessage(result.session?'Cuenta creada.':'Cuenta creada. Revisá tu email para confirmarla.');}catch(error){setAuthMessage(error.message,true);}};
$('logoutBtn').onclick=async()=>{await sync.signOut();renderAuth();};$('syncNowBtn').onclick=async()=>{try{await sync.syncAll();renderAll();}catch(error){setAuthMessage(error.message,true);}};

renderAll(false);
let reconnectingAuth=null;
async function recoverOnlineAuth(){
  if(navigator.onLine===false)return;
  if(reconnectingAuth)return reconnectingAuth;
  reconnectingAuth=(async()=>{
    try{
      const result=await reconnectV3Auth({sync,rollout:rolloutControl});
      if(result.status==='offline'){setAuthMessage('Esperando conexión para validar Auth y configuración. La sesión V3 local se conserva.');return;}
      if(result.status==='login_required'){setAuthMessage('La sesión expiró. Iniciá sesión nuevamente.');renderAll(false);return;}
      setAuthMessage('Sesión recuperada.');renderAll(false);
      await sync.syncAll();renderAll(false);
    }catch(error){console.warn(error);setAuthMessage('No se pudo validar Auth. La sesión V3 local se conserva.',true);renderAuth();}
  })();
  try{return await reconnectingAuth;}finally{reconnectingAuth=null;}
}
try{const user=rolloutSnapshot()?.flags.v3_enabled?(await reconnectV3Auth({sync,rollout:rolloutControl})).user:await sync.init();renderAuth();if(user){await sync.syncAll();renderAll();}}catch(error){console.warn(error);setAuthMessage('Supabase no está disponible. La app sigue funcionando en modo local.',true);renderAuth();if(navigator.onLine&&rolloutSnapshot()?.flags.v3_enabled)await recoverOnlineAuth();}
window.addEventListener('online',()=>{if(rolloutSnapshot()?.flags.v3_enabled)recoverOnlineAuth().catch(()=>{});else{renderAuth();sync.syncAll().then(()=>renderAll()).catch(()=>{});}});window.addEventListener('offline',renderAuth);document.addEventListener('visibilitychange',()=>{if(!document.hidden){activeSession.reconcileTime();renderAll();if(navigator.onLine&&!sync.user&&rolloutSnapshot()?.flags.v3_enabled)recoverOnlineAuth().catch(()=>{});}});setInterval(()=>{if(localDateKey()!==lastRenderedDate)renderAll();},60000);
