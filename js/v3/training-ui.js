import {sessionMetrics} from './training-metrics.js';
import {isV3CoachEnabled} from './feature-flags.js';
import {localDateKey} from '../plan.js';
import {mayStartNewWork} from '../pwa-update-gate.js';
import {buildV3SyncDiagnostic} from './sync-diagnostic.js';
import {buildV3SessionDiagnostic} from './session-diagnostic.js';
import {appBuildId} from '../pwa-version.js';

const el=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=String(text);if(className)node.className=className;return node;};
const button=(text,action,className='ghost')=>{const node=el('button',text,className);node.type='button';node.addEventListener('click',action);return node;};
const field=(parent,label,{value='',type='number',min,max,step='1'}={})=>{
  const wrapper=el('label',label,'field-label'),input=el(type==='textarea'?'textarea':'input');
  if(type!=='textarea')input.type=type;input.value=value??'';
  if(min!=null)input.min=String(min);if(max!=null)input.max=String(max);
  if(type==='number')input.step=step;
  wrapper.append(input);parent.append(wrapper);return input;
};
const select=(parent,label,options,value)=>{
  const wrapper=el('label',label,'field-label'),node=el('select');
  node.setAttribute('aria-label',label);
  for(const [id,name] of options){const option=el('option',name);option.value=String(id);node.append(option);}if(value!=null)node.value=String(value);
  wrapper.append(node);parent.append(wrapper);return node;
};
const duration=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
const confirmDiscard=label=>globalThis.confirm?.(`¿Descartar “${label}”? Se conservará una marca de borrado local para sincronizarla cuando corresponda.`)===true;

export class V3TrainingUI{
  constructor({root,engine,onClose,syncNow=null,pullOnly=null,readinessScore=null}){this.root=root;this.engine=engine;this.onClose=onClose;this.syncNow=syncNow;this.pullOnly=pullOnly;this.readinessScore=readinessScore;this.destroyed=false;this.busy=false;this.lastCompleted=null;this.lastFinishDiagnostic=null;this.syncing=false;this.onOnline=()=>this.requestSync({automatic:true});}

  async mount(){await this.engine.recover();await this.render();if(this.destroyed)return;this.heading?.focus();this.timer=setInterval(()=>this.refreshStatus().catch(()=>{}),1000);globalThis.window?.addEventListener('online',this.onOnline);}
  destroy(){this.destroyed=true;clearInterval(this.timer);globalThis.window?.removeEventListener('online',this.onOnline);this.root.replaceChildren();}

  async run(task){
    if(this.busy||this.destroyed)return;
    if(!mayStartNewWork()){this.message.textContent='Esta pestaña debe actualizarse antes de iniciar trabajo nuevo.';return;}
    this.busy=true;this.setDisabled(true);
    try{await task();if(!this.destroyed){await this.render();this.heading?.focus();}}
    catch(error){if(!this.destroyed){this.message.textContent=error.message;this.message.focus();}}
    finally{this.busy=false;if(!this.destroyed)this.setDisabled(false);}
  }
  setDisabled(value){for(const node of this.root.querySelectorAll('button,input,select,textarea'))node.disabled=value;}

  async render(){
    const snapshot=await this.engine.snapshot(),state=this.engine.getState();if(this.destroyed)return;
    this.root.replaceChildren();const shell=el('div','','v3-training-shell');this.root.append(shell);
    const head=el('header','','v3-training-header');this.heading=el('h2','Entrenar');this.heading.tabIndex=-1;const back=button('‹ Volver',()=>this.onClose(),'ghost v3-back-button');back.setAttribute('aria-label','Volver al inicio');head.append(back,this.heading);shell.append(head);
    shell.append(el('p','Tus cambios se guardan en este dispositivo y se sincronizan cuando hay conexión.','muted v3-local-note'));
    this.message=el('p','','advice');this.message.setAttribute('role','status');this.message.setAttribute('aria-live','polite');this.message.tabIndex=-1;shell.append(this.message);
    await this.renderSync(shell);
    this.conflict=el('p','','advice v3-conflict');this.conflict.setAttribute('role','status');this.conflict.setAttribute('aria-live','polite');shell.append(this.conflict);
    this.coachSlot=null;
    if(isV3CoachEnabled()){this.coachSlot=el('div');shell.append(this.coachSlot);await this.refreshCoach(snapshot);if(this.destroyed)return;}
    if(!snapshot||snapshot.session.status!=='draft'){await this.renderStart(shell);return;}
    shell.append(el('h3',snapshot.session.label));shell.append(el('p',`${snapshot.session.session_type==='free_workout'?'Musculación libre · ':''}Fecha de la sesión: ${snapshot.session.session_date}`,'muted'));
    if(snapshot.session.routine_snapshot?.name)shell.append(el('p',snapshot.session.routine_snapshot.name,'muted'));
    this.clock=el('strong',duration(sessionMetrics(snapshot).durationSeconds));shell.append(this.clock);
    const tabs=el('nav','','v3-actions');tabs.setAttribute('aria-label','Vistas del entrenamiento');
    for(const [id,title] of [['active','Sesión activa'],['exercises','Ejercicios'],['summary','Resumen']]){
      const tab=button(title,()=>this.run(()=>this.engine.saveUIState({view:id})));tab.setAttribute('aria-current',state.view===id?'page':'false');tabs.append(tab);
    }shell.append(tabs);
    const drafts=(await this.engine.repository.listSessions({status:'draft'})).filter(item=>item.started_at&&!item.reconstructed);
    if(drafts.length>1){const picker=select(shell,'Cambiar sesión activa',drafts.map(item=>[item.id,`${item.session_date} · ${item.label}`]),snapshot.session.id);picker.addEventListener('change',()=>this.run(()=>this.engine.selectSession(picker.value)));}
    if(state.view==='active'){
      const metrics=sessionMetrics(snapshot);shell.append(el('p',`${snapshot.exercises.length} ejercicios · ${metrics.completedSets} series completadas · ${metrics.volume.toFixed(1)} kg de volumen`));
      shell.append(button('Continuar con ejercicios',()=>this.run(()=>this.engine.saveUIState({view:'exercises'})),'primary'));
    }else if(state.view==='exercises')await this.renderExercises(shell,snapshot,state);
    else await this.renderSummary(shell,snapshot,state);
    this.renderRest();
    this.setConflict(snapshot);
  }

  renderRest(){
    this.restTime=null;
    const remaining=this.engine.restRemaining();if(!remaining)return;
    const bar=el('aside','','v3-rest-bar');bar.setAttribute('role','timer');bar.setAttribute('aria-label','Descanso entre series');
    this.restTime=el('strong',`Descanso ${duration(remaining)}`);bar.append(this.restTime,button('Omitir',()=>this.run(()=>this.engine.skipRest()),'ghost'));
    this.root.append(bar);
  }

  async renderStart(shell){
    if(this.engine.routines)await this.engine.routines.seedDefaults();
    if(this.lastCompleted){const metrics=sessionMetrics(this.lastCompleted);shell.append(el('p',`Sesión finalizada localmente: ${metrics.completedSets} series · RPE ${metrics.rpe}. Guardado remoto aún no confirmado.`,'advice'));this.setConflict(this.lastCompleted);}
    const dayIndex=new Date(this.engine.now()).getDay(),hasRoutine=[2,4,5].includes(dayIndex),dayLabel={2:'Fuerza principal',4:'Prevención y fuerza',5:'Activación prepartido'}[dayIndex];
    const primary=el('section','','card v3-training-primary');shell.append(primary);primary.append(el('h3',hasRoutine?'Entrenamiento de hoy':'Hoy no hay rutina programada'));
    primary.append(el('p',hasRoutine?`${dayLabel}. Podés ajustar los detalles durante la sesión.`:'Elegí musculación libre o creá una sesión personalizada cuando quieras.','muted'));
    if(hasRoutine)primary.append(button('Comenzar entrenamiento',()=>this.run(()=>this.engine.createSession({dayIndex,useRoutine:true})),'primary wide'));
    const free=el('section','','card v3-free-workout');shell.append(free);free.append(el('h3','Musculación libre'),el('p','Registrá sólo lo que realmente hagas, cualquier día.','muted'));
    const today=localDateKey(this.engine.now()),freeOptions=document.createElement('details');freeOptions.className='v3-start-options';freeOptions.append(el('summary','Ajustar fecha o nombre'));
    const freeDate=field(freeOptions,'Fecha de la sesión',{type:'date',value:today,max:today}),freeName=field(freeOptions,'Nombre opcional',{type:'text'});free.append(freeOptions);
    free.append(button('Comenzar musculación libre',()=>this.run(()=>this.engine.createFreeWorkout({label:freeName.value.trim()||undefined,date:freeDate.value})),'ghost wide'));
    const custom=document.createElement('details');custom.className='card v3-custom-session';custom.append(el('summary','Crear sesión personalizada'));
    const routine=select(custom,'Rutina',[[0,'Personalizada'],[2,'Martes · fuerza'],[4,'Jueves · prevención'],[5,'Viernes · prepartido']],hasRoutine?dayIndex:0),name=field(custom,'Nombre opcional',{type:'text'});
    custom.append(button('Comenzar sesión personalizada',()=>this.run(()=>this.engine.createSession({label:name.value.trim()||undefined,dayIndex:Number(routine.value),useRoutine:routine.value!=='0'})),'primary wide'));shell.append(custom);
    const drafts=(await this.engine.repository.listSessions({status:'draft'})).filter(item=>item.started_at&&!item.reconstructed);
    if(drafts.length){const recovery=el('section','','v3-draft-recovery');recovery.append(el('h3','Sesiones sin finalizar'));for(const session of drafts){const actions=el('div','','v3-actions');actions.append(button(`Recuperar ${session.session_date} · ${session.label}`,()=>this.run(()=>this.engine.selectSession(session.id))),button(`Descartar ${session.session_date} · ${session.label}`,()=>{if(confirmDiscard(session.label))return this.run(()=>this.engine.discardSession(session.id));},'danger-btn'));recovery.append(actions);}shell.append(recovery);}
  }

  async renderSync(shell){
    const operational=await this.engine.repository.operationalSnapshot(),counts=operational.counts;
    const state=counts.conflict?'conflicto':counts.failed?'error':this.syncing?'sincronizando':counts.pending||counts.syncing?'pendiente':'sincronizado',clean=state==='sincronizado';
    const row=el('section','',clean?'v3-sync-status is-clean':'card v3-sync-status');row.append(el('p',clean?'✓ Sincronizado':`Sincronización: ${state}. Cola: ${operational.queue.operations}.`,clean?'v3-sync-indicator':'advice'));
    if(!clean){const action=button('Sincronizar ahora',()=>this.requestSync());action.disabled=!this.syncNow||globalThis.navigator?.onLine===false||this.syncing;row.append(action);
      if(this.pullOnly){const recovery=button('Recuperar del servidor (sin enviar)',()=>this.requestPullOnly());recovery.disabled=globalThis.navigator?.onLine===false||this.syncing;row.append(recovery);}}
    shell.append(row);
  }

  async exportDiagnostic(){
    if(this.destroyed)return;
    const operations=await this.engine.repository.listOperations(),conflicts=await this.engine.repository.listConflicts({status:null});
    const text=JSON.stringify(buildV3SyncDiagnostic({operations,conflicts,buildId:appBuildId()}),null,2);
    const modal=el('section','','card v3-sync-diagnostic');modal.setAttribute('role','dialog');modal.setAttribute('aria-label','Diagnóstico local de sincronización');
    modal.append(el('h3','Diagnóstico local de sincronización'),el('p','Sólo incluye estados resumidos. No ejecuta sync ni modifica datos locales.','muted'));
    const area=document.createElement('textarea');area.readOnly=true;area.value=text;area.setAttribute('aria-label','JSON de diagnóstico');area.rows=12;modal.append(area);
    const actions=el('div','','v3-actions'),copy=button('Copiar JSON',async()=>{try{await navigator.clipboard.writeText(text);this.message.textContent='Diagnóstico copiado.';}catch{area.focus();area.select();this.message.textContent='Seleccioná el texto y copialo manualmente.';}}),download=button('Descargar JSON',()=>{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='nico-fit-v3-sync-diagnostic.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);}),close=button('Cerrar',()=>{modal.remove();this.heading?.focus();});actions.append(copy,download,close);modal.append(actions);this.root.querySelector('.v3-training-shell')?.append(modal);area.focus();area.select();
  }

  async exportSessionDiagnostic(){
    if(this.destroyed)return;
    const [sessions,trainingState]=await Promise.all([this.engine.repository.listSessions({includeDeleted:true}),this.engine.repository.getTrainingState()]);
    const text=JSON.stringify(buildV3SessionDiagnostic({sessions,trainingState,uiState:this.engine.getState(),buildId:appBuildId()}),null,2);
    const modal=el('section','','card v3-sync-diagnostic');modal.setAttribute('role','dialog');modal.setAttribute('aria-label','Diagnóstico local de sesiones');
    modal.append(el('h3','Diagnóstico local de sesiones'),el('p','Lectura local: no sincroniza, finaliza ni modifica sesiones o checkpoints.','muted'));
    const area=document.createElement('textarea');area.readOnly=true;area.value=text;area.setAttribute('aria-label','JSON de diagnóstico de sesiones');area.rows=16;modal.append(area);
    const actions=el('div','','v3-actions'),copy=button('Copiar JSON',async()=>{try{await navigator.clipboard.writeText(text);this.message.textContent='Diagnóstico de sesiones copiado.';}catch{area.focus();area.select();this.message.textContent='Seleccioná el texto y copialo manualmente.';}}),close=button('Cerrar',()=>{modal.remove();this.heading?.focus();});actions.append(copy,close);modal.append(actions);this.root.querySelector('.v3-training-shell')?.append(modal);area.focus();area.select();
  }

  showFinishDiagnostic(){
    if(this.destroyed||!this.lastFinishDiagnostic)return;
    const text=JSON.stringify(this.lastFinishDiagnostic,null,2),modal=el('section','','card v3-sync-diagnostic');modal.setAttribute('role','dialog');modal.setAttribute('aria-label','Diagnóstico del último intento de finalización');
    modal.append(el('h3','Diagnóstico de finalización'),el('p','Resultado sanitizado del último intento. No modifica ni reintenta la sesión.','muted'));
    const area=document.createElement('textarea');area.readOnly=true;area.value=text;area.setAttribute('aria-label','JSON de diagnóstico de finalización');area.rows=18;modal.append(area);
    const actions=el('div','','v3-actions'),copy=button('Copiar JSON',async()=>{try{await navigator.clipboard.writeText(text);this.message.textContent='Diagnóstico de finalización copiado.';}catch{area.focus();area.select();this.message.textContent='Seleccioná el texto y copialo manualmente.';}}),close=button('Cerrar',()=>{modal.remove();this.heading?.focus();});actions.append(copy,close);modal.append(actions);this.root.querySelector('.v3-training-shell')?.append(modal);area.focus();area.select();
  }

  async requestSync({automatic=false}={}){
    if(this.destroyed||this.syncing||!this.syncNow||globalThis.navigator?.onLine===false)return {skipped:'offline'};
    this.syncing=true;await this.render();this.message.textContent='Sincronizando…';
    try{
      const result=await this.syncNow();
      if(!this.destroyed)this.message.textContent=result.skipped==='offline'?'Offline: la cola local se conserva.':result.skipped==='rollout_blocked'?'Sync pausado por configuración remota.':result.skipped==='disabled'?'Sync V3 desactivado.':result.conflicts?'Hay conflictos que requieren revisión.':'Sincronización confirmada.';
      return result;
    }catch(error){if(!this.destroyed)this.message.textContent=`Error de sync: ${error.message}`;if(!automatic)throw error;return {failed:true};}
    finally{this.syncing=false;if(!this.destroyed)await this.render();}
  }

  async requestPullOnly(){
    if(this.destroyed||this.syncing||!this.pullOnly||globalThis.navigator?.onLine===false)return {skipped:'offline'};
    if(globalThis.confirm?.('Se descargarán datos de tu cuenta sin enviar la cola local. Las semillas equivalentes se confirmarán; las diferentes quedarán para revisión. ¿Continuar?')!==true)return {skipped:'cancelled'};
    this.syncing=true;await this.render();this.message.textContent='Recuperando datos del servidor sin enviar la cola…';
    let result,message;
    try{
      result=await this.pullOnly();
      message=result.skipped?'Recuperación pausada: no se cambió el servidor.':result.conflicts?'Datos descargados; algunas semillas requieren revisión. No se envió la cola.':'Datos recuperados del servidor. No se envió la cola.';
      return result;
    }catch(error){message=`No se completó la recuperación: ${error.message}`;return {failed:true};}
    finally{this.syncing=false;if(!this.destroyed){await this.render();this.message.textContent=message;}}
  }

  async renderExercises(shell,snapshot,state){
    const list=el('div','','v3-exercises');shell.append(list),catalog=await this.engine.catalog();
    for(const [index,exercise] of snapshot.exercises.entries()){
      const card=el('section','','card v3-exercise-card');list.append(card);
      const heading=el('div','','v3-exercise-heading');heading.append(el('h3',`${index+1}. ${exercise.exercise_name_snapshot}`));
      const rx=exercise.prescription_snapshot,completed=exercise.sets.filter(set=>set.is_completed).length;
      heading.append(el('span',`${completed}/${Math.max(rx.sets||1,exercise.sets.length)}`,'v3-exercise-progress'));card.append(heading);
      card.append(el('p',`${rx.sets||1} × ${rx.min??'—'}${rx.max!=null&&rx.max!==rx.min?`–${rx.max}`:''} ${rx.measurement_kind==='seconds'?'s':'reps'} · Descanso ${rx.rest??rx.rest_seconds??0} s`,'muted'));
      const menu=document.createElement('details');menu.className='v3-exercise-menu';menu.append(el('summary','Más acciones'));
      const actions=el('div','','v3-actions');
      for(const [delta,title] of [[-1,'Subir'],[1,'Bajar']])if(index+delta>=0&&index+delta<snapshot.exercises.length){
        actions.append(button(`${title} ${exercise.exercise_name_snapshot}`,()=>this.run(()=>{const ids=snapshot.exercises.map(ex=>ex.id);[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];return this.engine.reorderExercises(ids);})));
      }
      actions.append(button('Repetir ejercicio',()=>this.run(()=>this.engine.repeatExercise(exercise.id))));
      const swap=button('Cambiar ejercicio',()=>{replacement.hidden=!replacement.hidden;if(!replacement.hidden)search.focus();});
      actions.append(swap,button('Eliminar ejercicio y sus series',()=>this.run(()=>this.engine.deleteExercise(exercise.id))));menu.append(actions);
      const replacement=el('div','','v3-replace-exercise');replacement.hidden=true;
      replacement.append(el('p',exercise.sets.length?'Las series registradas conservarán el ejercicio original. El reemplazo aparecerá a continuación.':'Se cambia sólo en esta sesión; la rutina base queda intacta.','muted'));
      const search=field(replacement,'Buscar alternativa',{type:'search'}),choice=select(replacement,'Ejercicio alternativo',[['','Elegí un ejercicio']]);
      const region=exercise.catalog?.metadata?.body_region;
      const ordered=[...catalog].filter(item=>item.id!==exercise.exercise_catalog_id).sort((a,b)=>{
        const aMatch=region&&a.metadata?.body_region===region&&a.measurement_kind===exercise.catalog?.measurement_kind;
        const bMatch=region&&b.metadata?.body_region===region&&b.measurement_kind===exercise.catalog?.measurement_kind;
        return Number(!!bMatch)-Number(!!aMatch)||a.canonical_name.localeCompare(b.canonical_name);
      });
      const refill=()=>{const prior=choice.value,query=search.value.trim().toLocaleLowerCase('es');choice.replaceChildren();
        for(const [id,name] of [['','Elegí un ejercicio'],...ordered.filter(item=>item.canonical_name.toLocaleLowerCase('es').includes(query)).map(item=>[item.id,`${region&&item.metadata?.body_region===region?'Sugerido · ':''}${item.canonical_name}`])]){const option=el('option',name);option.value=id;choice.append(option);}if([...choice.options].some(option=>option.value===prior))choice.value=prior;
      };search.addEventListener('input',refill);refill();
      replacement.append(button('Confirmar cambio',()=>{if(!choice.value){this.message.textContent='Elegí un ejercicio alternativo.';return;}this.run(()=>this.engine.replaceExercise(exercise.id,choice.value));},'ghost'));
      menu.append(replacement);
      await this.renderSets(card,exercise,state);
      card.append(menu);
    }
    const card=el('section','','card v3-add-exercise');shell.append(card);card.append(el('h3','Agregar ejercicio'));
    if(catalog.length){
      const choice=select(card,'Ejercicio del catálogo',catalog.map(ex=>[ex.id,`${ex.metadata?.category?`${ex.metadata.category} · `:''}${ex.canonical_name} · ${ex.measurement_kind}`]));
      const advanced=document.createElement('details');advanced.className='v3-exercise-advanced';advanced.append(el('summary','Ajustes avanzados (opcional)'));
      const target=field(advanced,'Series objetivo',{value:3,min:1,max:100}),minimum=field(advanced,'Mínimo (reps o segundos)',{min:1}),maximum=field(advanced,'Máximo (reps o segundos)',{min:1}),rest=field(advanced,'Descanso (s)',{min:0,max:3600}),step=field(advanced,'Incremento de carga (kg)',{value:0,min:0,max:100,step:'.5'});
      card.append(advanced,button('Agregar',()=>this.run(()=>this.engine.addExercise(choice.value,{sets:target.value,min:minimum.value,max:maximum.value,rest:rest.value,step:step.value})),'primary wide'));
    }
    const custom=document.createElement('details');custom.className='v3-custom-exercise';custom.append(el('summary','Crear ejercicio personalizado'));
    const name=field(custom,'Nombre de ejercicio personalizado',{type:'text'}),mode=select(custom,'Unidad', [['reps','Repeticiones'],['seconds','Segundos'],['mixed','Elegir reps o segundos por serie']]);
    custom.append(button('Crear y agregar',()=>this.run(async()=>{const created=await this.engine.createCustomExercise({name:name.value,measurementKind:mode.value});await this.engine.addExercise(created.id);}),'ghost wide'));card.append(custom);
  }

  async renderSets(card,exercise,state){
    const rx=exercise.prescription_snapshot,extra=state.extraSets?.[exercise.id]||0,count=Math.max((rx.sets||1)+extra,0,...exercise.sets.map(set=>set.position+1));
    const suggestion=document.createElement('details');suggestion.className='v3-progression-note';suggestion.append(el('summary','Sugerencia de carga'));
    suggestion.append(el('p',(await this.engine.progression(exercise.id,{readinessScore:this.readinessScore})).text,'advice'));
    const rows=el('div','','v3-inline-sets');card.append(rows);
    for(let position=0;position<count;position++){
      const set=exercise.sets.find(item=>item.position===position),key=`${exercise.id}:${set?.id||`slot:${position}`}`;
      const draft=state.drafts?.[key]||(!set&&position===0?state.drafts?.[`${exercise.id}:new`]:null)||set||{};
      const row=el('div','','v3-inline-set');rows.append(row);row.append(el('strong',`S${position+1}`,'v3-set-number'));
      const input=(label,value,{max=1000,step='1',placeholder=''}={})=>{
        const wrapper=el('label','','v3-inline-field'),caption=el('span',label);const node=el('input');node.type='number';node.inputMode='decimal';node.min='0';node.max=String(max);node.step=step;node.value=value??'';node.placeholder=placeholder;
        node.setAttribute('aria-label',`Serie ${position+1}: ${label}`);wrapper.append(caption,node);row.append(wrapper);return node;
      };
      const load=input('kg',draft.load_kg,{step:'.001'}),reps=rx.measurement_kind!=='seconds'?input('reps',draft.reps,{max:500,placeholder:rx.min&&rx.max?`${rx.min}–${rx.max}`:''}):null;
      const seconds=rx.measurement_kind==='seconds'?input('seg',draft.duration_seconds,{max:86400,placeholder:rx.min&&rx.max?`${rx.min}–${rx.max}`:''}):null;
      const rir=input('RIR',draft.rir,{max:5,step:'.1',placeholder:rx.target_rir!=null?String(rx.target_rir):''});
      const read=isCompleted=>({load_kg:load.value,reps:reps?.value??null,duration_seconds:seconds?.value??null,rir:rir.value,is_completed:isCompleted});
      for(const node of [load,reps,seconds,rir].filter(Boolean))node.addEventListener('input',()=>this.engine.saveDraft(key,read(!!set?.is_completed)).catch(error=>{if(!this.destroyed)this.message.textContent=error.message;}));
      const complete=button(set?.is_completed?'✓':'○',()=>this.run(()=>this.engine.saveSet(exercise.id,read(!set?.is_completed),{setId:set?.id,position,startRest:!set?.is_completed,draftKey:key})),'v3-set-complete');
      complete.setAttribute('aria-pressed',String(!!set?.is_completed));complete.setAttribute('aria-label',`${set?.is_completed?'Desmarcar':'Completar'} serie ${position+1} de ${exercise.exercise_name_snapshot}`);row.append(complete);
      const menu=document.createElement('details');menu.className='v3-set-menu';const summary=el('summary','⋯');summary.setAttribute('aria-label',`Más acciones para serie ${position+1}`);menu.append(summary);
      const actions=el('div','','v3-actions');actions.append(button(set?'Guardar cambios':'Guardar sin completar',()=>this.run(()=>this.engine.saveSet(exercise.id,read(!!set?.is_completed),{setId:set?.id,position,draftKey:key}))));
      if(set)actions.append(button('Borrar serie',()=>this.run(()=>this.engine.deleteSet(exercise.id,set.id)),'danger-btn'));
      else actions.append(button('Descartar cambios',()=>this.run(()=>this.engine.discardDraft(key))));
      menu.append(actions);row.append(menu);
    }
    card.append(button('+ Agregar serie',()=>this.run(()=>{
      if(count>=100)throw new Error('Máximo de 100 series por ejercicio.');
      return this.engine.saveUIState({extraSets:{...state.extraSets,[exercise.id]:(state.extraSets?.[exercise.id]||0)+1}});
    }),'ghost v3-add-set'));
    card.append(suggestion);
  }

  async renderSummary(shell,snapshot,state){
    const metrics=sessionMetrics(snapshot),card=el('section','','card');shell.append(card);card.append(el('h3','Resumen local'));
    if(this.engine.hasPendingDrafts())card.append(el('p','Hay borradores de series sin guardar. Volvé a Ejercicios para guardarlos o descartarlos.','advice'));
    for(const text of [`Volumen: ${metrics.volume.toFixed(1)} kg`,`Reps completadas registradas: ${metrics.recordedReps}`,`Series completadas: ${metrics.completedSets}`,`Duración: ${duration(metrics.durationSeconds)}`])card.append(el('p',text));
    const prs=await this.engine.prs();
    for(const [id,metric] of Object.entries(metrics.perExercise))card.append(el('p',`${metric.name}: máximo ${metric.maxLoad??'—'} kg · 1RM estimado ${metric.estimated1RM?.toFixed(1)??'—'} kg · PR histórico estimado ${prs[id]?.toFixed(1)??'—'} kg`));
    const rpe=field(card,'RPE global (1–10)',{value:state.summaryDraft?.rpe,min:1,max:10,step:'.1'}),notes=field(card,'Notas',{value:state.summaryDraft?.notes,type:'textarea'});
    card.addEventListener('input',()=>this.engine.saveSummaryDraft({rpe:rpe.value,notes:notes.value}).catch(error=>{if(!this.destroyed)this.message.textContent=error.message;}));
    card.append(button('Finalizar y guardar localmente',()=>this.run(async()=>{
      this.lastCompleted=await this.engine.finishSession({rpe:rpe.value,notes:notes.value},{onDiagnostic:value=>{this.lastFinishDiagnostic=value;if(this.finishDiagnosticButton)this.finishDiagnosticButton.disabled=false;}});
      document.dispatchEvent(new CustomEvent('nico-fit:pwa-safety-changed'));
    }),'primary'),button('Descartar sesión',()=>{if(confirmDiscard(snapshot.session.label))return this.run(async()=>{await this.engine.discardSession(snapshot.session.id);document.dispatchEvent(new CustomEvent('nico-fit:pwa-safety-changed'));});},'danger-btn'));
  }

  setConflict(snapshot){
    const records=[snapshot.session,...snapshot.exercises.flatMap(ex=>[ex,ex.catalog,...ex.sets])].filter(Boolean);
    const blocked=records.some(record=>record.sync_status==='conflict')||snapshot.conflicts.length;
    this.conflict.textContent=blocked?'Hay conflictos de sincronización. Podés continuar localmente; los cambios afectados quedan bloqueados para revisión.':'';
  }

  async refreshStatus(){
    if(this.destroyed||this.busy)return;const snapshot=await this.engine.snapshot();if(this.destroyed)return;
    if(this.coachSlot&&this.coachDate!==localDateKey())await this.refreshCoach(snapshot);
    if(!snapshot||this.destroyed)return;
    if(this.clock)this.clock.textContent=duration(sessionMetrics(snapshot).durationSeconds);
    const remaining=this.engine.restRemaining();if(this.restTime){if(remaining)this.restTime.textContent=`Descanso ${duration(remaining)}`;else{this.restTime.parentElement?.remove();this.restTime=null;}}
    this.setConflict(snapshot);
  }

  async refreshCoach(snapshot){
    const slot=this.coachSlot;if(!slot)return;
    try{const [{V3CoachService},{renderCoachCard}]=await Promise.all([import('./coach-service.js'),import('./coach-presentation.js')]);
      const result=await new V3CoachService({engine:this.engine}).today(snapshot);if(this.destroyed||slot!==this.coachSlot)return;
      const card=renderCoachCard(result,snapshot);card.classList.add('v3-coach-card');slot.replaceChildren(card,button('Actualizar Coach',async()=>{await this.refreshCoach(await this.engine.snapshot());},'ghost v3-coach-refresh'));this.coachDate=result.signals.date;
    }catch(error){if(this.destroyed||slot!==this.coachSlot)return;slot.replaceChildren(el('p',`Coach no disponible: ${error.message}`,'advice'));this.coachDate=localDateKey();}
  }
}
