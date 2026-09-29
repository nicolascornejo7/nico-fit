import {plan,localDateKey,daysUntilSaturday} from './plan.js';
import {loadLocalData,saveLocalData,clearLocalData,nowIso,emptyData,workoutKey} from './store.js';
import {SyncService} from './sync.js';
import {lineChart} from './charts.js';
import {ActiveSessionStore,commitPendingSession,elapsedSeconds,remainingRestSeconds} from './active-session.js';
import {exerciseId,sameExercise} from './exercise-identity.js';
import {sessionVolume} from './metrics.js';
import {V2HistoryReader} from './v2-history-reader.js';
import {progressionSuggestion} from './progression.js';
import {appendTextElement,clearNode} from './safe-dom.js';
import {hasWorkoutInput,validateFootball,validateMatch,validateReadiness,validateSessionSummary,validateWorkout} from './validation.js';
import {mayStartNewWork} from './pwa-update-gate.js';
import {restorePwaFormDrafts,clearPwaFormDrafts} from './pwa-form-drafts.js';
import {rolloutReady} from './v3/rollout-boot.js';
import {rolloutControl} from './v3/rollout-boot.js';
import {reconnectV3Auth} from './v3/auth-reconnect.js';
import {rolloutSnapshot} from './v3/rollout-state.js';
import {V3LocalRepository} from './v3/repository.js';
import {V3SignalsUI} from './v3/signals-ui.js';
import {V3TodayService} from './v3/today-service.js';
import {syncV3Repository} from './v3/sync-runtime.js';
import {UnifiedProgress} from './v3/unified-progress.js';
import {cachedPublicConfig} from './v3/public-config.js';
import {assertAuthorizedV3Url} from './v3/authorized-projects.js';
import {productSyncStatus} from './v3/product-sync-status.js';

await rolloutReady;

let storageOwner='guest',data=loadLocalData(storageOwner),lastRenderedDate=localDateKey();
let sessionTick=null,restTick=null,restoreExercisePosition=true;
let v3Repository=null,v3Signals=null,v3Today=null,v3Context=null,v3Generation=0;
let progressSnapshot=null,progressGeneration=0,v3Operational=null,currentProductSync={kind:'local',text:'Solo local'};
const v2HistoryReader=new V2HistoryReader({getData:()=>data});
const $=id=>document.getElementById(id);
const activeSession=new ActiveSessionStore({owner:storageOwner});
const sync=new SyncService({getData:()=>data,setData:next=>{captureActiveDrafts();data=next;persistAndRender(false);},onState:setSyncBadge});
sync.onAuth=user=>switchStorageOwner(user);

function currentContext(now=new Date()){const dayIndex=now.getDay();return {now,dayIndex,dateKey:localDateKey(now),plan:plan[dayIndex]};}
function workoutContext(){const state=activeSession.state;if(!state)return currentContext();return {now:new Date(),dayIndex:state.dayIndex,dateKey:state.sessionDate,plan:plan[state.dayIndex],active:state};}
function persist(){saveLocalData(data,storageOwner);}
function persistAndRender(capture=true){if(capture)captureActiveDrafts();persist();renderAll(false);}
async function activateV3Product(user){
  const token=++v3Generation;v3Repository?.close();v3Repository=null;v3Signals=null;v3Today=null;v3Context=null;v3Operational=null;progressSnapshot=null;
  if(!user?.id){renderAll(false);return;}
  const repository=await V3LocalRepository.open({userId:user.id});if(token!==v3Generation){repository.close();return;}
  v3Repository=repository;v3Signals=new V3SignalsUI({repository,syncNow:syncV3Repository});v3Today=new V3TodayService({repository});await refreshV3Product();
}
function refreshProductSyncStatus(){
  let runtimeAuthorized=false;try{runtimeAuthorized=!!assertAuthorizedV3Url(cachedPublicConfig()?.url);}catch{}
  const rollout=rolloutSnapshot(),lastError=v3Operational?.lastError,lastSuccess=v3Operational?.lastSuccess,currentError=lastError&&(!lastSuccess||(lastError.sequence??0)>(lastSuccess.sequence??0))?lastError:null,status=productSyncStatus({authenticated:!!sync.user,online:navigator.onLine!==false,runtimeAuthorized,syncEnabled:!!rollout?.flags.v3_sync_enabled,queue:v3Operational?.queue.operations??0,conflicts:v3Operational?.counts.conflict??0,lastError:currentError});currentProductSync=status;setSyncBadge(status.kind,status.text);return status;
}
async function refreshV3Product(){if(!v3Today)return;[v3Context,v3Operational]=await Promise.all([v3Today.summary(),v3Repository.operationalSnapshot()]);refreshProductSyncStatus();renderAll(false);}
function switchStorageOwner(user){
  if(storageOwner!==(user?.id||'guest'))clearPwaFormDrafts(['sleep','energy','freshness','pain','painArea','footballDuration','footballRpe','footballMinutes','matchEnergy','legs','performance','matchNotes']);
  captureActiveDrafts();storageOwner=user?.id||'guest';data=loadLocalData(storageOwner);activeSession.setOwner(storageOwner);restoreExercisePosition=true;persistAndRender(false);
  currentProductSync=user?{kind:'local',text:'Comprobando sincronización…'}:{kind:'local',text:'Solo local'};setSyncBadge(currentProductSync.kind,currentProductSync.text);
  document.dispatchEvent(new CustomEvent('nico-fit:auth',{detail:{userId:user?.id||null}}));
  activateV3Product(user).catch(error=>{console.warn(error);setAuthMessage('No se pudo abrir el almacenamiento de entrenamiento.',true);});
}
document.addEventListener('nico-fit:auth-request',()=>document.dispatchEvent(new CustomEvent('nico-fit:auth',{detail:{userId:sync.user?.id||null}})));
document.addEventListener('nico-fit:pwa-safety-request',event=>{event.detail.critical ||= sync.busy;event.detail.userId=storageOwner;});
const allowNewWork=()=>{if(mayStartNewWork())return true;alert(rolloutSnapshot()?.updateRequired?'Actualización requerida. Tus datos locales quedan conservados; actualizá la app antes de continuar.':'Esta pestaña tiene una actualización pendiente. Terminá la sesión abierta o recargá cuando sea seguro.');return false;};
function setSyncBadge(state,text){$('syncBadge').className=`sync-badge ${state}`;$('syncBadge').textContent=text;}
function readinessScore(r){if(!r)return null;const freshness=r.freshness??(6-(+r.fatigue||3));return Math.round(((+r.sleep + +r.energy + freshness)/15)*100-Math.max(0,(+r.pain||0)-2)*3);}
function readinessLevel(score){if(score==null)return ['neutral','Sin registrar'];if(score>=78)return ['good',`${score}% · Bueno`];if(score>=60)return ['mid',`${score}% · Intermedio`];return ['low',`${score}% · Bajo`];}
function latestReadiness(date=currentContext().dateKey){if(v3Context?.date===date)return v3Context.readiness;return storageOwner==='guest'?data.readiness.find(x=>x.date===date):null;}
function currentReadinessState(){
  const saved=latestReadiness(),freshness=saved?.freshness??(saved?6-(+saved.fatigue||3):null),matches=!!saved&&+saved.sleep===+$('sleep').value&&+saved.energy===+$('energy').value&&+freshness===+$('freshness').value&&+saved.pain===+$('pain').value&&String(saved.pain_area??saved.painArea??'')===$('painArea').value;
  return !saved?['neutral','Sin guardar','Completá el check-in para personalizar tu recomendación.']:matches?['good','✓ Guardado hoy','✓ Guardado. Tu recomendación ya usa este estado.']:['mid','Cambios pendientes','Guardá los cambios para actualizar tu recomendación.'];
}
function renderReadinessState(){const [kind,label,message]=currentReadinessState();$('readinessMini').className=`score-pill ${kind}`;$('readinessMini').textContent=label;$('readinessAdvice').textContent=message;}
function latestPreviousWorkout(exercise,date){return [...data.workouts].filter(x=>sameExercise(x.exerciseId||x.exercise,exercise)&&x.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0]||null;}
function daysText(n){return n===0?'Partido hoy':n===1?'Partido mañana':`Faltan ${n} días para el partido`;}
function guidance(ctx=currentContext()){
  if(v3Context?.date===ctx.dateKey&&v3Context.recommendation?.recommendation){const value=v3Context.recommendation.recommendation;return `${value.title}. ${value.summary}`;}
  const r=latestReadiness(ctx.dateKey),score=readinessScore(r),toSat=daysUntilSaturday(ctx.now);
  if(r?.pain>=5)return 'Hay dolor relevante: evitá forzar la zona molesta. Si persiste o empeora, conviene evaluarlo con un profesional.';
  if(toSat===1)return 'Prepartido: mantené todo rápido y liviano. Terminá sintiéndote mejor que al empezar.';
  if(score!=null&&score<60)return 'Readiness bajo: reducí 20–30% el volumen, conservá técnica y evitá llegar al fallo.';
  if(score!=null&&score<78)return 'Estado intermedio: mantené 2–3 RIR en piernas y priorizá calidad sobre volumen.';
  return ctx.plan.type==='Gimnasio'?'Buen estado: podés seguir el plan normal dejando 1–3 RIR.':'Priorizá la sesión del día y registrá la carga para ajustar el resto de la semana.';
}

function renderDashboard(){
  const ctx=currentContext(),r=latestReadiness(ctx.dateKey),score=readinessScore(r),[cls,label]=readinessLevel(score),sat=daysUntilSaturday(ctx.now),hasActive=!!v3Context?.activeSession;
  const hasRoutine=ctx.plan.type==='Gimnasio',action=hasActive?['Continuar entrenamiento','today']:hasRoutine?['Comenzar rutina','today']:['Explorar entrenamientos','open'],actions=storageOwner!=='guest'?`<button class="primary wide" id="goWorkoutBtn">${action[0]}</button><button class="ghost wide" id="freeWorkoutBtn">Musculación libre</button>`:'',syncNotice=storageOwner!=='guest'&&currentProductSync.kind!=='synced'?`<button class="sync-alert" id="openSupportBtn"><span>${currentProductSync.text}</span><strong>Revisar</strong></button>`:'';
  $('dashboardCard').innerHTML=`<div class="dashboard-top"><div><p class="eyebrow">${daysText(sat).toUpperCase()}</p><h2>Hoy · ${ctx.plan.name}</h2><p class="dashboard-sub">${ctx.plan.label}</p></div><div class="big-score ${cls}">${score??'—'}<span>${score==null?'readiness':'/100'}</span></div></div><div class="recommendation"><strong>Recomendación</strong><p>${guidance(ctx)}</p></div>${actions}${syncNotice}`;
  $('goWorkoutBtn')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('nico-fit:open-training',{detail:{mode:action[1]}})));
  $('freeWorkoutBtn')?.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('nico-fit:open-training',{detail:{mode:'free'}})));
  $('openSupportBtn')?.addEventListener('click',()=>{switchView('settingsView');setTimeout(()=>$('v3SupportSection')?.scrollIntoView({block:'start',behavior:'smooth'}),0);});
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

function renderFootball(){const ctx=currentContext(),show=[1,3,6].includes(ctx.dayIndex);$('footballQuickCard').classList.toggle('hidden',!show);if(!show)return;const type=ctx.dayIndex===6?'Partido':ctx.dayIndex===3?'Amistoso':'Entrenamiento equipo',sessionType=ctx.dayIndex===6?'match':ctx.dayIndex===3?'friendly':'training';$('footballTitle').textContent=type;const rec=v3Context?.date===ctx.dateKey?v3Context.football?.find(x=>x.session_type===sessionType):data.football.find(x=>x.date===ctx.dateKey&&x.type===type);if(rec){$('footballDuration').value=rec.duration_minutes??rec.duration;$('footballRpe').value=rec.rpe;$('footballMinutes').value=rec.minutes_played??rec.minutes??'';}updateFootballLoad();}
function updateFootballLoad(){const d=+$('footballDuration').value||0,r=+$('footballRpe').value||0;$('footballLoadPreview').textContent=`Carga estimada: ${d&&r?d*r:'—'} AU`;}
async function saveFootball(){
  if(!allowNewWork()||!v3Signals)return alert('Iniciá sesión para guardar la carga de fútbol.');
  const ctx=currentContext(),sessionType=ctx.dayIndex===6?'match':ctx.dayIndex===3?'friendly':'training',legacy={duration:+$('footballDuration').value,rpe:+$('footballRpe').value,minutes:$('footballMinutes').value===''?0:+$('footballMinutes').value};
  const validation=validateFootball(legacy);if(!validation.valid)return alert(validation.message);
  const existing=(await v3Signals.list('football_sessions',{date:ctx.dateKey})).find(row=>row.session_type===sessionType);
  await v3Signals.saveFootball({local_date:ctx.dateKey,session_type:sessionType,duration_minutes:legacy.duration,rpe:legacy.rpe,minutes_played:legacy.minutes,notes:existing?.notes??''},existing?{id:existing.id,expectedLocalRevision:existing.local_revision}:undefined);
  clearPwaFormDrafts(['footballDuration','footballRpe','footballMinutes']);await refreshV3Product();
}
async function saveReadiness(){
  if(!allowNewWork()||!v3Signals)return alert('Iniciá sesión para guardar el check-in.');
  const date=currentContext().dateKey,input={local_date:date,sleep:+$('sleep').value,energy:+$('energy').value,freshness:+$('freshness').value,pain:+$('pain').value,pain_area:$('painArea').value,notes:''};
  const existing=await v3Signals.readiness(date);await v3Signals.saveReadiness(input,existing?{id:existing.id,expectedLocalRevision:existing.local_revision}:undefined);
  clearPwaFormDrafts(['sleep','energy','freshness','pain','painArea']);await refreshV3Product();renderReadinessState();
}
async function saveMatch(){
  if(!allowNewWork()||!v3Signals)return alert('Iniciá sesión para guardar el partido.');
  const date=currentContext().dateKey,legacy={energy:+$('matchEnergy').value,legs:+$('legs').value,performance:+$('performance').value,notes:$('matchNotes').value},validation=validateMatch(legacy);if(!validation.valid)return alert(validation.message);
  const matches=await v3Signals.list('football_sessions',{date}),parent=matches.find(row=>row.session_type==='match')??null,existing=(await v3Signals.list('match_reviews',{date}))[0]??null;
  await v3Signals.saveMatchReview({local_date:date,football_session_id:parent?.id??null,...legacy,rpe:parent?.rpe??null,minutes_played:parent?.minutes_played??null},existing?{id:existing.id,expectedLocalRevision:existing.local_revision}:undefined);
  clearPwaFormDrafts(['matchEnergy','legs','performance','matchNotes']);await refreshV3Product();alert('Partido guardado');
}
function hydrateToday(){const date=currentContext().dateKey,r=latestReadiness(date);if(r){$('sleep').value=r.sleep;$('energy').value=r.energy;$('freshness').value=r.freshness??6-r.fatigue;$('pain').value=r.pain;$('painArea').value=r.pain_area??r.painArea??'';}['sleep','energy','freshness','pain'].forEach(id=>$(id+'Val').textContent=$(id).value);const m=v3Context?.date===date?v3Context.matches?.[0]:data.matches.find(x=>x.date===date);if(m){$('matchEnergy').value=m.energy;$('legs').value=m.legs;$('performance').value=m.performance;$('matchNotes').value=m.notes||'';}['matchEnergy','legs','performance'].forEach(id=>$(id+'Val').textContent=$(id).value);}

async function renderProgress(){
  const token=++progressGeneration,model=await new UnifiedProgress({v2Reader:v2HistoryReader,repository:v3Repository,userId:storageOwner}).load();if(token!==progressGeneration)return;progressSnapshot=model;
  $('workoutCount').textContent=model.metrics.completedSessions;$('gymVolume').textContent=`${Math.round(model.metrics.volume)} kg`;$('footballLoad7').textContent=Math.round(model.metrics.footballLoad7);$('avgReadiness').textContent=model.metrics.averageReadiness??'—';$('progressStatus').textContent=model.warnings.join(' ');
  lineChart($('readinessChart'),model.readiness.slice(-8).map(row=>({label:row.date.slice(5),value:row.value})),{min:0,max:100});lineChart($('matchChart'),[...model.matches].sort((a,b)=>a.date.localeCompare(b.date)).slice(-8).map(row=>({label:row.date.slice(5),value:+row.legs})),{min:1,max:5});
  const identities=new Map();for(const item of model.exercises)if(item.identity&&!identities.has(item.identity))identities.set(item.identity,item.name);const select=$('exerciseSelect'),current=select.value;clearNode(select);if(identities.size){[...identities].sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id,name])=>{const option=select.ownerDocument.createElement('option');option.value=id;option.textContent=name;select.append(option);});if(identities.has(current))select.value=current;}else appendTextElement(select,'option','Sin datos');renderStrength();
  const items=[...model.sessions.map(row=>({...row,detail:`${row.durationMinutes} min · RPE ${row.rpe??'—'}${row.volume!=null?` · volumen ${Math.round(row.volume)} kg`:''}`})),...model.matches.map(row=>({date:row.date,title:'Partido',detail:`Piernas ${row.legs??'—'}/5 · Rendimiento ${row.performance??'—'}/5`})),...model.football.map(row=>({date:row.date,title:row.title,detail:`${row.durationMinutes} min · RPE ${row.rpe??'—'} · carga ${Math.round(row.load)}`}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,16),history=clearNode($('history'));if(!items.length){appendTextElement(history,'p','Todavía no hay registros suficientes.','muted');return;}items.forEach(item=>{const row=history.ownerDocument.createElement('div');row.className='history-item';appendTextElement(row,'strong',item.title);appendTextElement(row,'span',`${item.date} · ${item.detail}`);history.append(row);});
}
function renderStrength(){const points=(progressSnapshot?.exercises??[]).filter(item=>item.identity===$('exerciseSelect').value&&item.maxLoad>0).sort((a,b)=>a.date.localeCompare(b.date)).slice(-10).map(item=>({label:item.date.slice(5),value:item.maxLoad})),maxValue=Math.max(0,...points.map(item=>item.value)),max=Math.max(20,maxValue);$('exerciseMaxLoad').textContent=maxValue?`Máximo: ${maxValue} kg`:'Sin carga registrada';lineChart($('strengthChart'),points,{min:0,max:Math.ceil(max/10)*10,suffix:'kg'});}
function renderMatch(){$('matchSection').classList.toggle('hidden',currentContext().dayIndex!==6);}
function renderAuth(){const signed=!!sync.user;$('signedOutBox').classList.toggle('hidden',signed);$('signedInBox').classList.toggle('hidden',!signed);if(signed){$('userEmail').textContent=sync.user.email||'usuario';const status=refreshProductSyncStatus();$('authStatus').textContent=status.text;}else{currentProductSync={kind:'local',text:'Solo local'};setSyncBadge('local','Solo local');}}
function setAuthMessage(msg,error=false){$('authMessage').textContent=msg;$('authMessage').className=error?'advice error-text':'advice';}
function switchView(id){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));$(id).classList.add('active-view');document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===id));if(id==='progressView')setTimeout(()=>renderProgress().catch(()=>{}),0);window.scrollTo({top:0,behavior:'smooth'});}
function renderAll(capture=true){if(capture)captureActiveDrafts();lastRenderedDate=currentContext().dateKey;hydrateToday();renderDashboard();renderReadinessState();renderWeek();renderWorkout();renderFootball();renderMatch();renderProgress().catch(()=>{});renderAuth();renderSessionSummary();restorePwaFormDrafts();['sleep','energy','freshness','pain','matchEnergy','legs','performance'].forEach(id=>$(id+'Val').textContent=$(id).value);updateFootballLoad();startTimerIntervals();}
async function resetAll(){if(!allowNewWork())return;const scope=sync.user?'este dispositivo Y tu cuenta sincronizada':'este dispositivo';if(!confirm(`¿Borrar todos los registros de ${scope}?`))return;activeSession.clear();if(sync.user){try{await sync.deleteAll();}catch(error){alert('El borrado quedó pendiente de sincronizar: '+error.message);}location.reload();return;}data=emptyData();clearLocalData(storageOwner);location.reload();}

['sleep','energy','freshness','pain','matchEnergy','legs','performance'].forEach(id=>$(id).addEventListener('input',()=>{$(id+'Val').textContent=$(id).value;if(['sleep','energy','freshness','pain'].includes(id)){renderDashboard();renderReadinessState();}}));$('painArea').addEventListener('change',renderReadinessState);['footballDuration','footballRpe'].forEach(id=>$(id).addEventListener('input',updateFootballLoad));
$('sessionRpe').addEventListener('input',()=>activeSession.updateSummary({rpe:+$('sessionRpe').value}));$('sessionNotes').addEventListener('input',()=>activeSession.updateSummary({notes:$('sessionNotes').value}));
$('saveReadiness').onclick=saveReadiness;$('saveMatch').onclick=saveMatch;$('saveFootball').onclick=saveFootball;$('startSessionBtn').onclick=()=>document.dispatchEvent(new CustomEvent('nico-fit:open-training',{detail:{mode:'today'}}));$('finishSessionBtn').onclick=null;$('saveSessionSummary').onclick=null;$('addRestBtn').onclick=null;$('skipRestBtn').onclick=null;$('resetBtn').onclick=()=>alert('El histórico V2 es de solo lectura. Los datos V3 se administran desde Entrenar y Diagnóstico.');$('exerciseSelect').onchange=renderStrength;
$('profileBtn').onclick=()=>{$('authSection').classList.toggle('hidden');};$('openAuthSettings').onclick=()=>{$('authSection').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});};$('closeAuthBtn').onclick=()=>$('authSection').classList.add('hidden');document.querySelectorAll('.nav-btn').forEach(button=>button.onclick=()=>button.dataset.view==='workoutView'?document.dispatchEvent(new CustomEvent('nico-fit:open-training',{detail:{mode:'open'}})):switchView(button.dataset.view));
$('loginBtn').onclick=async()=>{try{setAuthMessage('Iniciando sesión…');await sync.signIn($('email').value.trim(),$('password').value);setAuthMessage('Sesión iniciada.');}catch(error){setAuthMessage(error.message,true);}};$('signupBtn').onclick=async()=>{try{const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<6)return setAuthMessage('Email válido y contraseña de al menos 6 caracteres.',true);const result=await sync.signUp(email,password);setAuthMessage(result.session?'Cuenta creada.':'Cuenta creada. Revisá tu email para confirmarla.');}catch(error){setAuthMessage(error.message,true);}};
$('logoutBtn').onclick=async()=>{await sync.signOut();renderAuth();};$('syncNowBtn').onclick=async()=>{try{if(!v3Repository)throw new Error('Iniciá sesión para sincronizar.');await syncV3Repository(v3Repository);await refreshV3Product();}catch(error){setAuthMessage(error.message,true);}};

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
      await sync.refreshReadOnly();renderAll(false);
    }catch(error){console.warn(error);setAuthMessage('No se pudo validar Auth. La sesión V3 local se conserva.',true);renderAuth();}
  })();
  try{return await reconnectingAuth;}finally{reconnectingAuth=null;}
}
try{const user=rolloutSnapshot()?.flags.v3_enabled?(await reconnectV3Auth({sync,rollout:rolloutControl})).user:await sync.init();renderAuth();if(user){await sync.refreshReadOnly();await activateV3Product(user);renderAll();}}catch(error){console.warn(error);setAuthMessage('Supabase no está disponible. La app sigue funcionando en modo local.',true);renderAuth();if(navigator.onLine&&rolloutSnapshot()?.flags.v3_enabled)await recoverOnlineAuth();}
window.addEventListener('online',()=>{if(rolloutSnapshot()?.flags.v3_enabled)recoverOnlineAuth().then(()=>v3Today&&refreshV3Product()).catch(()=>{});else{renderAuth();sync.refreshReadOnly().then(()=>renderAll()).catch(()=>{});}});window.addEventListener('offline',renderAuth);document.addEventListener('nico-fit:pwa-safety-changed',()=>{if(v3Today)refreshV3Product().catch(()=>{});});document.addEventListener('visibilitychange',()=>{if(!document.hidden){activeSession.reconcileTime();renderAll();if(v3Today)refreshV3Product().catch(()=>{});if(navigator.onLine&&!sync.user&&rolloutSnapshot()?.flags.v3_enabled)recoverOnlineAuth().catch(()=>{});}});setInterval(()=>{if(localDateKey()!==lastRenderedDate){renderAll();if(v3Today)refreshV3Product().catch(()=>{});}},60000);
