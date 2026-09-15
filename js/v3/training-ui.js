import {sessionMetrics} from './training-metrics.js';

const el=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=String(text);if(className)node.className=className;return node;};
const button=(text,action,className='ghost')=>{const node=el('button',text,className);node.type='button';node.addEventListener('click',action);return node;};
const field=(parent,label,{value='',type='number',min,max,step='1'}={})=>{
  const wrapper=el('label',label,'field-label'),input=el(type==='textarea'?'textarea':'input');
  if(type!=='textarea')input.type=type;input.value=value??'';
  if(type==='number'){input.step=step;if(min!=null)input.min=String(min);if(max!=null)input.max=String(max);}
  wrapper.append(input);parent.append(wrapper);return input;
};
const select=(parent,label,options,value)=>{
  const wrapper=el('label',label,'field-label'),node=el('select');
  for(const [id,name] of options){const option=el('option',name);option.value=String(id);node.append(option);}if(value!=null)node.value=String(value);
  wrapper.append(node);parent.append(wrapper);return node;
};
const duration=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;

export class V3TrainingUI{
  constructor({root,engine,onClose}){this.root=root;this.engine=engine;this.onClose=onClose;this.destroyed=false;this.busy=false;this.lastCompleted=null;}

  async mount(){await this.engine.recover();await this.render();if(this.destroyed)return;this.heading?.focus();this.timer=setInterval(()=>this.refreshStatus().catch(()=>{}),1000);}
  destroy(){this.destroyed=true;clearInterval(this.timer);this.root.replaceChildren();}

  async run(task){
    if(this.busy||this.destroyed)return;this.busy=true;this.setDisabled(true);
    try{await task();if(!this.destroyed){await this.render();this.heading?.focus();}}
    catch(error){if(!this.destroyed){this.message.textContent=error.message;this.message.focus();}}
    finally{this.busy=false;if(!this.destroyed)this.setDisabled(false);}
  }
  setDisabled(value){for(const node of this.root.querySelectorAll('button,input,select,textarea'))node.disabled=value;}

  async render(){
    const snapshot=await this.engine.snapshot(),state=this.engine.getState();if(this.destroyed)return;
    this.root.replaceChildren();const shell=el('div','','v3-training-shell');this.root.append(shell);
    const head=el('div','','section-head');this.heading=el('h2','Entrenamiento V3 · prueba local');this.heading.tabIndex=-1;head.append(this.heading,button('Volver a V2',()=>this.onClose()));shell.append(head);
    shell.append(el('p','Guardado local por usuario. Esta pantalla no activa sincronización remota.','muted'));
    this.message=el('p','','advice');this.message.setAttribute('role','status');this.message.setAttribute('aria-live','polite');this.message.tabIndex=-1;shell.append(this.message);
    this.conflict=el('p','','advice v3-conflict');this.conflict.setAttribute('role','status');this.conflict.setAttribute('aria-live','polite');shell.append(this.conflict);
    if(!snapshot||snapshot.session.status!=='draft'){await this.renderStart(shell);return;}
    shell.append(el('h3',snapshot.session.label));shell.append(el('p',`Fecha de la sesión: ${snapshot.session.session_date}`,'muted'));
    this.clock=el('strong',duration(sessionMetrics(snapshot).durationSeconds));shell.append(this.clock);
    const tabs=el('nav','','v3-actions');tabs.setAttribute('aria-label','Vistas del entrenamiento V3');
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
    this.setConflict(snapshot);
  }

  async renderStart(shell){
    if(this.lastCompleted){const metrics=sessionMetrics(this.lastCompleted);shell.append(el('p',`Sesión finalizada localmente: ${metrics.completedSets} series · RPE ${metrics.rpe}. Guardado remoto aún no confirmado.`,'advice'));this.setConflict(this.lastCompleted);}
    const card=el('section','','card');shell.append(card);card.append(el('h3','Nueva sesión'));
    const routine=select(card,'Rutina',[[0,'Personalizada'],[2,'Martes · fuerza'],[4,'Jueves · prevención'],[5,'Viernes · prepartido']],[2,4,5].includes(new Date().getDay())?new Date().getDay():0);
    const name=field(card,'Nombre opcional',{type:'text'});
    card.append(button('Crear sesión V3',()=>this.run(()=>this.engine.createSession({label:name.value.trim()||undefined,dayIndex:Number(routine.value),useRoutine:routine.value!=='0'})),'primary'));
    const drafts=(await this.engine.repository.listSessions({status:'draft'})).filter(item=>item.started_at&&!item.reconstructed);
    for(const session of drafts)card.append(button(`Recuperar ${session.session_date} · ${session.label}`,()=>this.run(()=>this.engine.selectSession(session.id))));
  }

  async renderExercises(shell,snapshot,state){
    const list=el('ol','','v3-exercises');shell.append(list);
    for(const [index,exercise] of snapshot.exercises.entries()){
      const row=el('li');row.append(button(`${index+1}. ${exercise.exercise_name_snapshot}`,()=>this.run(()=>this.engine.saveUIState({currentExerciseId:exercise.id,editingSetId:null}))));
      const actions=el('div','','v3-actions');
      for(const [delta,title] of [[-1,'Subir'],[1,'Bajar']])if(index+delta>=0&&index+delta<snapshot.exercises.length){
        actions.append(button(`${title} ${exercise.exercise_name_snapshot}`,()=>this.run(()=>{const ids=snapshot.exercises.map(ex=>ex.id);[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];return this.engine.reorderExercises(ids);})));
      }
      actions.append(button('Repetir ejercicio',()=>this.run(()=>this.engine.repeatExercise(exercise.id))),button('Eliminar ejercicio y sus series',()=>this.run(()=>this.engine.deleteExercise(exercise.id))));row.append(actions);list.append(row);
    }
    const current=snapshot.exercises.find(ex=>ex.id===state.currentExerciseId)||snapshot.exercises[0];
    if(current)await this.renderSets(shell,current,state);
    const catalog=await this.engine.catalog();
    const card=el('section','','card');shell.append(card);card.append(el('h3','Agregar ejercicio'));
    if(catalog.length){
      const choice=select(card,'Ejercicio del catálogo',catalog.map(ex=>[ex.id,`${ex.canonical_name} · ${ex.measurement_kind}`]));
      const target=field(card,'Series objetivo',{value:3,min:1,max:100}),minimum=field(card,'Mínimo (reps o segundos)',{min:1}),maximum=field(card,'Máximo (reps o segundos)',{min:1}),step=field(card,'Incremento de carga (kg)',{value:0,min:0,max:100,step:'.5'});
      card.append(button('Agregar a la sesión',()=>this.run(()=>this.engine.addExercise(choice.value,{sets:target.value,min:minimum.value,max:maximum.value,step:step.value})),'primary'));
    }
    const name=field(card,'Nombre de ejercicio personalizado',{type:'text'}),mode=select(card,'Unidad', [['reps','Repeticiones'],['seconds','Segundos'],['mixed','Elegir reps o segundos por serie']]);
    card.append(button('Crear ejercicio personalizado y agregar',()=>this.run(async()=>{const custom=await this.engine.createCustomExercise({name:name.value,measurementKind:mode.value});await this.engine.addExercise(custom.id);}))); 
  }

  async renderSets(shell,exercise,state){
    const card=el('section','','card');shell.append(card);card.append(el('h3',exercise.exercise_name_snapshot));
    const rx=exercise.prescription_snapshot;card.append(el('p',`${rx.sets} series objetivo · ${rx.measurement_kind} · ${rx.min??'—'}–${rx.max??'—'}`,'muted'));
    card.append(el('p',(await this.engine.progression(exercise.id)).text,'advice'));
    for(const set of exercise.sets){
      const row=el('div','','v3-set');row.append(el('p',`S${set.position+1} · ${set.load_kg??'—'} kg · ${set.reps!=null?`${set.reps} reps`:`${set.duration_seconds??'—'} s`} · RIR ${set.rir??'—'} · ${set.is_completed?'Completada':'Sin completar'} · ${set.sync_status}`));
      row.append(button(`Editar serie ${set.position+1}`,()=>this.run(()=>this.engine.saveUIState({editingSetId:set.id}))),button(`Eliminar serie ${set.position+1}`,()=>this.run(()=>this.engine.deleteSet(exercise.id,set.id))));card.append(row);
    }
    const editing=exercise.sets.find(set=>set.id===state.editingSetId),key=`${exercise.id}:${editing?.id||'new'}`,draft=state.drafts[key]||editing||{};
    const form=el('form');card.append(form);form.append(el('h4',editing?'Editar serie':'Nueva serie'));
    const load=field(form,'Carga (kg)',{value:draft.load_kg,min:0,max:1000,step:'.001'});
    const reps=rx.measurement_kind!=='seconds'?field(form,'Repeticiones',{value:draft.reps,min:1,max:500}):null;
    const seconds=rx.measurement_kind!=='reps'?field(form,'Duración (s)',{value:draft.duration_seconds,min:1,max:86400}):null;
    const rir=field(form,'RIR (vacío = desconocido)',{value:draft.rir,min:0,max:5,step:'.1'});
    const done=field(form,'Serie completada',{type:'checkbox'});done.checked=!!draft.is_completed;
    const read=()=>({load_kg:load.value,reps:reps?.value??null,duration_seconds:seconds?.value??null,rir:rir.value,is_completed:done.checked});
    form.addEventListener('input',()=>this.engine.saveDraft(key,read()).catch(error=>{if(!this.destroyed)this.message.textContent=error.message;}));
    const submit=el('button',editing?'Guardar edición':'Guardar serie','primary');submit.type='submit';form.append(submit);
    form.append(button('Descartar borrador',()=>this.run(()=>this.engine.discardDraft(key))));
    form.addEventListener('submit',event=>{event.preventDefault();this.run(async()=>{await this.engine.saveSet(exercise.id,read(),{setId:editing?.id});await this.engine.saveUIState({editingSetId:null});});});
    if(editing)form.append(button('Nueva serie',()=>this.run(()=>this.engine.saveUIState({editingSetId:null}))));
  }

  async renderSummary(shell,snapshot,state){
    const metrics=sessionMetrics(snapshot),card=el('section','','card');shell.append(card);card.append(el('h3','Resumen local'));
    if(this.engine.hasPendingDrafts())card.append(el('p','Hay borradores de series sin guardar. Volvé a Ejercicios para guardarlos o descartarlos.','advice'));
    for(const text of [`Volumen: ${metrics.volume.toFixed(1)} kg`,`Reps completadas registradas: ${metrics.recordedReps}`,`Series completadas: ${metrics.completedSets}`,`Duración: ${duration(metrics.durationSeconds)}`])card.append(el('p',text));
    const prs=await this.engine.prs();
    for(const [id,metric] of Object.entries(metrics.perExercise))card.append(el('p',`${metric.name}: máximo ${metric.maxLoad??'—'} kg · 1RM estimado ${metric.estimated1RM?.toFixed(1)??'—'} kg · PR histórico estimado ${prs[id]?.toFixed(1)??'—'} kg`));
    const rpe=field(card,'RPE global (1–10)',{value:state.summaryDraft?.rpe,min:1,max:10,step:'.1'}),notes=field(card,'Notas',{value:state.summaryDraft?.notes,type:'textarea'});
    card.addEventListener('input',()=>this.engine.saveSummaryDraft({rpe:rpe.value,notes:notes.value}).catch(error=>{if(!this.destroyed)this.message.textContent=error.message;}));
    card.append(button('Finalizar y guardar localmente',()=>this.run(async()=>{this.lastCompleted=await this.engine.finishSession({rpe:rpe.value,notes:notes.value});}),'primary'));
  }

  setConflict(snapshot){
    const records=[snapshot.session,...snapshot.exercises.flatMap(ex=>[ex,ex.catalog,...ex.sets])].filter(Boolean);
    const blocked=records.some(record=>record.sync_status==='conflict')||snapshot.conflicts.length;
    this.conflict.textContent=blocked?'Hay conflictos de sincronización. Podés continuar localmente; los cambios afectados quedan bloqueados para revisión.':'';
  }

  async refreshStatus(){
    if(this.destroyed||this.busy)return;const snapshot=await this.engine.snapshot();if(!snapshot||this.destroyed)return;
    if(this.clock)this.clock.textContent=duration(sessionMetrics(snapshot).durationSeconds);this.setConflict(snapshot);
  }
}
