import {localDateKey} from '../plan.js';
import {isV3TrainingEnabled,isV3RoutinesEnabled} from './feature-flags.js';
import {V3RoutineService} from './routine-service.js';
import {routineForDay,routineCatalogId} from './routines.js';
import {requiredText,optionalNumber,validatePrescription,validateSet} from './training-validation.js';
import {sessionMetrics,estimatedPRs} from './training-metrics.js';
import {v3Progression} from './training-progression.js';
import {rolloutFlag,rolloutBlocksNewWork,rolloutAllowsLocalTraining} from './rollout-state.js';
import {BASE_EXERCISES,baseCatalogId} from './base-exercise-catalog.js';
import {compatiblePrescription} from './exercise-recommendations.js';
import {V3CoachService} from './coach-service.js';
import {effectiveTuesdayExercises} from './tuesday-adaptation.js';

const clone=value=>structuredClone(value);
const insert=(entity,id,payload)=>({entity,id,type:'insert',payload});
const update=(entity,record,payload)=>({entity,id:record.id,type:'update',payload,expectedLocalRevision:record.local_revision});
const remove=(entity,record)=>({entity,id:record.id,type:'soft_delete',expectedLocalRevision:record.local_revision});
export const remainingRestSeconds=(rest,now=Date.now())=>rest?Math.max(0,Math.ceil((Date.parse(rest.endsAt)-now)/1000)||0):0;

export class V3TrainingEngine{
  constructor({repository,flagStorage=globalThis.localStorage,featureEnabled,routinesEnabled,now=()=>new Date(),cryptoImpl=globalThis.crypto}={}){
    if(!repository)throw new Error('V3 training requires a repository.');
    if(!(featureEnabled??isV3TrainingEnabled(flagStorage)))throw new Error('V3 training is disabled.');
    this.repository=repository;this.now=now;this.crypto=cryptoImpl;this.state=null;this.pending=Promise.resolve();
    this.routines=(routinesEnabled??isV3RoutinesEnabled(flagStorage))?new V3RoutineService({repository,featureEnabled:true}):null;
  }

  #run(task){const result=this.pending.then(task);this.pending=result.catch(()=>{});return result;}
  flush(){return this.pending;}
  getState(){return this.state?clone(this.state):null;}
  restRemaining(){return remainingRestSeconds(this.state?.rest,this.now().getTime());}
  #guard(session){return {entity:'workout_sessions',id:session.id,expectedLocalRevision:session.local_revision,status:'draft'};}

  async snapshot(sessionId=this.state?.activeSessionId){
    if(!sessionId)return null;
    const session=await this.repository.get('workout_sessions',sessionId);if(!session)return null;
    const exercises=await this.repository.listChildren('session_exercises',sessionId);
    for(const exercise of exercises){
      exercise.sets=await this.repository.listChildren('exercise_sets',exercise.id);
      // V2 backfills and early V3 rows may legitimately only have a historical
      // name/prescription snapshot. IndexedDB rejects get(null), so keep that
      // snapshot usable without inventing a catalog identity.
      exercise.catalog=exercise.exercise_catalog_id?await this.repository.get('exercise_catalog',exercise.exercise_catalog_id):null;
    }
    const ids=new Set([session.id,session.routine_id,session.routine_version_id,...(session.routine_snapshot?.exercises??[]).map(ex=>ex.id),...exercises.flatMap(ex=>[ex.id,ex.exercise_catalog_id,...ex.sets.map(set=>set.id)])]);
    let routineIdentity=null;
    if(session.routine_id){const template=await this.repository.get('routine_templates',session.routine_id);routineIdentity={id:session.routine_id,currentName:template?.name??null,isActive:!!template?.is_active&&!template?.deleted_at,state:!template?'missing':template.deleted_at?'deleted':template.sync_status==='conflict'?'conflict':template.is_active?'active':'inactive'};}
    return {session,exercises,routineIdentity,conflicts:(await this.repository.listConflicts()).filter(item=>ids.has(item.record_id))};
  }

  async history(){const sessions=await this.repository.listSessions();return Promise.all(sessions.map(session=>this.snapshot(session.id)));}
  async #catalogRows(){return (await this.repository.listRecords('exercise_catalog')).sort((a,b)=>a.canonical_name.localeCompare(b.canonical_name));}
  async #ensureBaseCatalog(){
    const existing=await this.repository.listRecords('exercise_catalog',{includeDeleted:true}),known=new Set(existing.map(row=>row.stable_key));
    const missing=BASE_EXERCISES.filter(item=>!known.has(item.stable_key));
    if(!missing.length)return;
    const changes=await Promise.all(missing.map(async item=>insert('exercise_catalog',await baseCatalogId(this.repository.userId,item.stable_key),item)));
    await this.repository.commitLocalChanges(changes);
  }
  catalog(){return this.#run(async()=>{await this.#ensureBaseCatalog();return this.#catalogRows();});}

  recover(){return this.#run(async()=>{
    const saved=await this.repository.getTrainingState();
    let snapshot=saved?.activeSessionId?await this.snapshot(saved.activeSessionId):null;
    if(!snapshot||snapshot.session.deleted_at||snapshot.session.status!=='draft')snapshot=null;
    this.state=snapshot?{activeSessionId:snapshot.session.id,currentExerciseId:snapshot.exercises[0]?.id||null,view:'active',drafts:{},summaryDraft:{},...(saved?.activeSessionId===snapshot.session.id?saved:{})}:null;
    if(this.state&&!snapshot.exercises.some(ex=>ex.id===this.state.currentExerciseId))this.state.currentExerciseId=snapshot.exercises[0]?.id||null;
    await this.repository.commitLocalChanges([],{trainingState:this.state});return snapshot;
  });}

  createSession({label,date,dayIndex,useRoutine=true,routineVersionId,sessionType='routine',adaptTuesday=false,overrideCoach=false,expectedCoachEvidenceKey=null}={}){return this.#run(async()=>{
    if(!rolloutAllowsLocalTraining()||rolloutBlocksNewWork()||rolloutFlag('v3_training_enabled')===false)throw new Error('Esta versión no puede iniciar una sesión V3 nueva.');
    if(!['routine','free_workout'].includes(sessionType))throw new Error('Tipo de sesión inválido.');
    if(sessionType==='free_workout'&&(useRoutine||routineVersionId))throw new Error('La musculación libre no usa una rutina.');
    const now=this.now(),sessionDate=date??localDateKey(now);
    if(dayIndex!=null&&(!Number.isInteger(dayIndex)||dayIndex<0||dayIndex>6))throw new Error('Día de rutina inválido.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)||localDateKey(new Date(`${sessionDate}T12:00:00`))!==sessionDate)throw new Error('Fecha inválida.');
    if(sessionDate>localDateKey(now))throw new Error('No podés registrar una sesión en una fecha futura.');
    if(adaptTuesday&&(sessionType!=='routine'||!useRoutine||routineVersionId||sessionDate!==localDateKey(now)||new Date(`${sessionDate}T12:00:00`).getDay()!==2))throw new Error('La adaptación requiere la rutina programada del martes de hoy.');
    const routine=routineForDay(dayIndex??new Date(`${sessionDate}T12:00:00`).getDay()),id=this.crypto.randomUUID();
    if(routineVersionId&&!this.routines)throw new Error('Habilitá explícitamente rutinas V3 para elegir una versión.');
    let concrete=null;
    if(this.routines&&(routineVersionId||useRoutine&&routine.exercises.length)){
      if(routineVersionId)concrete=await this.routines.version(routineVersionId,{forTraining:true});
      else{const defaults=await this.routines.seedDefaults(),selected=defaults.find(item=>item.version.day_index===routine.dayIndex);concrete=await this.routines.version(selected.version.id,{forTraining:true});}
    }
    let decision=null;
    if(adaptTuesday){
      if(concrete?.version.version_number!==2||concrete.version.day_index!==2)throw new Error('La adaptación requiere la versión 2 del martes.');
      decision=await new V3CoachService({engine:this,featureEnabled:true,now:this.now}).tuesdayPlan({override:overrideCoach,now});
      if(expectedCoachEvidenceKey!=null&&decision.evidenceKey!==expectedCoachEvidenceKey){const error=new Error('Los datos del lunes o el check-in cambiaron. Revisá el plan actualizado antes de comenzar.');error.code='COACH_PLAN_CHANGED';throw error;}
    }
    if(sessionType==='free_workout')await this.#ensureBaseCatalog();
    const session={session_date:sessionDate,label:requiredText(label??concrete?.snapshot.name??(sessionType==='free_workout'?'Musculación libre':routine.label),'Nombre de sesión'),session_type:sessionType,status:'draft',started_at:now.toISOString(),ended_at:null,duration_seconds:null,rpe:null,notes:''};
    if(concrete)Object.assign(session,{routine_id:concrete.template.id,routine_version:concrete.version.version_number,routine_version_id:concrete.version.id,routine_snapshot:clone(concrete.snapshot)});
    const changes=[insert('workout_sessions',id,session)],catalog=await this.#catalogRows();
    const exerciseIds=[];
    const sourceExercises=decision?effectiveTuesdayExercises(concrete.snapshot,decision,catalog):concrete?.snapshot.exercises;
    const items=sourceExercises?sourceExercises.map(ex=>({catalog_id:ex.exercise_catalog_id,canonical_name:ex.exercise_name_snapshot,prescription:ex.prescription_snapshot})):(useRoutine?routine.exercises:[]);
    for(const [position,item] of items.entries()){
      let entry=catalog.find(ex=>(item.catalog_id?ex.id===item.catalog_id:ex.stable_key===item.stable_key)&&!ex.deleted_at);
      if(concrete&&!entry)throw new Error('Catálogo cambiado mientras se iniciaba la sesión; revisar la versión.');
      if(!entry){entry={id:await routineCatalogId(this.repository.userId,item.stable_key),...item};changes.push(insert('exercise_catalog',entry.id,{stable_key:entry.stable_key,canonical_name:entry.canonical_name,measurement_kind:entry.measurement_kind,metadata:{source:'validated-v2-plan'}}));catalog.push(entry);}
      const exerciseId=this.crypto.randomUUID();exerciseIds.push(exerciseId);
      changes.push(insert('session_exercises',exerciseId,{session_id:id,exercise_catalog_id:entry.id,position,exercise_name_snapshot:concrete?item.canonical_name:entry.canonical_name,prescription_snapshot:validatePrescription(item.prescription),notes:''}));
    }
    const state={activeSessionId:id,currentExerciseId:exerciseIds[0]||null,view:'exercises',drafts:{},summaryDraft:{}};
    await this.repository.commitLocalChanges(changes,{trainingState:state});this.state=state;return this.snapshot(id);
  });}

  createFreeWorkout({label='Musculación libre',date}={}){return this.createSession({label,date,useRoutine:false,sessionType:'free_workout'});}

  selectSession(id){return this.#run(async()=>{
    const snapshot=await this.#editable(id),state={activeSessionId:id,currentExerciseId:snapshot.exercises[0]?.id||null,view:'exercises',drafts:{},summaryDraft:{}};
    await this.repository.commitLocalChanges([],{trainingState:state,guards:[this.#guard(snapshot.session)]});this.state=state;return snapshot;
  });}

  async #editable(id=this.state?.activeSessionId){
    const snapshot=await this.snapshot(id);
    if(!snapshot||snapshot.session.deleted_at||snapshot.session.status!=='draft')throw new Error('La sesión no está activa.');
    return snapshot;
  }

  createCustomExercise({name,measurementKind='reps'}={}){return this.#run(async()=>{
    const canonical_name=requiredText(name,'Ejercicio');
    if(!['reps','seconds','mixed'].includes(measurementKind))throw new Error('Unidad inválida.');
    const id=this.crypto.randomUUID();const [record]=await this.repository.commitLocalChanges([insert('exercise_catalog',id,{stable_key:`custom:${id}`,canonical_name,measurement_kind:measurementKind,metadata:{custom:true}})]);return record;
  });}

  addExercise(catalogId,prescription={}){return this.#run(async()=>{
    const snapshot=await this.#editable(),catalog=await this.repository.get('exercise_catalog',catalogId);
    if(!catalog||catalog.deleted_at)throw new Error('Ejercicio de catálogo no disponible.');
    const id=this.crypto.randomUUID(),position=Math.max(-1,...snapshot.exercises.map(ex=>ex.position))+1;
    const payload={session_id:snapshot.session.id,exercise_catalog_id:catalogId,position,exercise_name_snapshot:catalog.canonical_name,prescription_snapshot:validatePrescription({...prescription,measurement_kind:catalog.measurement_kind}),notes:''};
    const state={...this.state,currentExerciseId:id,view:'exercises'};
    const [record]=await this.repository.commitLocalChanges([insert('session_exercises',id,payload)],{trainingState:state,guards:[this.#guard(snapshot.session)]});this.state=state;return record;
  });}

  repeatExercise(id){return this.#run(async()=>{
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===id);if(!exercise)throw new Error('Ejercicio no disponible.');
    const newId=this.crypto.randomUUID(),payload={session_id:snapshot.session.id,exercise_catalog_id:exercise.exercise_catalog_id,position:Math.max(-1,...snapshot.exercises.map(ex=>ex.position))+1,exercise_name_snapshot:exercise.exercise_name_snapshot,prescription_snapshot:clone(exercise.prescription_snapshot),notes:exercise.notes};
    const state={...this.state,currentExerciseId:newId,view:'exercises'};const [record]=await this.repository.commitLocalChanges([insert('session_exercises',newId,payload)],{trainingState:state,guards:[this.#guard(snapshot.session)]});this.state=state;return record;
  });}

  replaceExercise(id,catalogId){return this.#run(async()=>{
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===id);
    if(!exercise)throw new Error('Ejercicio no disponible.');
    const catalog=await this.repository.get('exercise_catalog',catalogId);
    if(!catalog||catalog.deleted_at)throw new Error('Ejercicio de catálogo no disponible.');
    if(catalog.id===exercise.exercise_catalog_id)return exercise;
    const prescription=clone(exercise.prescription_snapshot);
    if(!compatiblePrescription(exercise.catalog,catalog)){
      Object.assign(prescription,{sets:1,min:null,max:null,rest:null,rest_seconds:null,target_rir:null,step:0,rx:''});
    }
    prescription.replaced_exercise_name ||=exercise.exercise_name_snapshot;
    prescription.replaced_exercise_catalog_id ||=exercise.exercise_catalog_id;
    Object.assign(prescription,{id:catalog.stable_key,name:catalog.canonical_name,source:'session-substitution'});
    prescription.measurement_kind=catalog.measurement_kind;
    if(exercise.sets.length){
      // A performed occurrence is historical evidence. Keep it, and insert the
      // substitute after it so completed sets retain their actual identity.
      prescription.sets=Math.max(1,(prescription.sets||1)-exercise.sets.filter(set=>set.is_completed).length);
      const newId=this.crypto.randomUUID(),base=Math.max(...snapshot.exercises.map(ex=>ex.position))+snapshot.exercises.length+2;
      const changes=snapshot.exercises.map((ex,index)=>({...update('session_exercises',ex,{position:base+index}),preserveTransition:true}));
      changes.push(insert('session_exercises',newId,{session_id:snapshot.session.id,exercise_catalog_id:catalog.id,position:exercise.position+1,exercise_name_snapshot:catalog.canonical_name,prescription_snapshot:validatePrescription(prescription),notes:''}));
      for(const ex of snapshot.exercises)changes.push({entity:'session_exercises',id:ex.id,type:'update',payload:{position:ex.position+(ex.position>exercise.position?1:0)},preserveTransition:true});
      const state={...this.state,currentExerciseId:newId,view:'exercises'};
      const records=await this.repository.commitLocalChanges(changes,{trainingState:state,guards:[this.#guard(snapshot.session)]});this.state=state;
      return records[snapshot.exercises.length];
    }
    const state={...this.state,drafts:Object.fromEntries(Object.entries(this.state.drafts||{}).filter(([key])=>!key.startsWith(`${id}:`)))};
    const [record]=await this.repository.commitLocalChanges([update('session_exercises',exercise,{
      exercise_catalog_id:catalog.id,exercise_name_snapshot:catalog.canonical_name,
      prescription_snapshot:validatePrescription(prescription)
    })],{trainingState:state,guards:[this.#guard(snapshot.session)]});this.state=state;
    return record;
  });}

  reorderExercises(ids){return this.#run(async()=>{
    const snapshot=await this.#editable(),current=snapshot.exercises;
    if(ids.length!==current.length||new Set(ids).size!==ids.length||ids.some(id=>!current.some(ex=>ex.id===id)))throw new Error('El orden debe incluir cada ejercicio una vez.');
    if(ids.every((id,index)=>id===current[index].id))return snapshot;
    const base=Math.max(...current.map(ex=>ex.position))+current.length+1,changes=[];
    // Preserve both phases in the outbox: remote unique positions cannot be swapped directly.
    current.forEach((ex,index)=>changes.push({...update('session_exercises',ex,{position:base+index}),preserveTransition:true}));
    current.forEach(ex=>changes.push({entity:'session_exercises',id:ex.id,type:'update',payload:{position:ids.indexOf(ex.id)},preserveTransition:true}));
    await this.repository.commitLocalChanges(changes,{guards:[this.#guard(snapshot.session)]});return this.snapshot();
  });}

  saveSet(exerciseId,input,{setId,position,startRest=false,draftKey}={}){return this.#run(async()=>{
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===exerciseId);if(!exercise)throw new Error('Ejercicio no disponible.');
    const current=setId?exercise.sets.find(set=>set.id===setId):null;if(setId&&!current)throw new Error('Serie no disponible.');
    if(position!=null&&(!Number.isInteger(position)||position<0||position>999))throw new Error('Posición de serie inválida.');
    if(!current&&position!=null&&exercise.sets.some(set=>set.position===position))throw new Error('La serie ya existe. Recargá antes de guardarla.');
    const value=validateSet(current?{...current,...input}:input,exercise.prescription_snapshot.measurement_kind);
    value.completed_at=value.is_completed?(current?.is_completed?current.completed_at:this.now().toISOString()):null;
    const id=current?.id||this.crypto.randomUUID(),change=current?update('exercise_sets',current,value):insert('exercise_sets',id,{...value,session_exercise_id:exerciseId,position:position??Math.max(-1,...exercise.sets.map(set=>set.position))+1});
    const state={...this.state,drafts:{...this.state.drafts},currentExerciseId:exerciseId};delete state.drafts[`${exerciseId}:${setId||'new'}`];
    if(draftKey)delete state.drafts[draftKey];
    if(!value.is_completed&&state.rest?.setId===id)state.rest=null;
    if(startRest&&value.is_completed&&!current?.is_completed){
      const seconds=optionalNumber(exercise.prescription_snapshot.rest??exercise.prescription_snapshot.rest_seconds,'Descanso',{max:3600,integer:true});
      const started=this.now();state.rest=seconds>0?{startedAt:started.toISOString(),endsAt:new Date(started.getTime()+seconds*1000).toISOString(),durationSeconds:seconds,exerciseId,setId:id}:null;
    }
    const [record]=await this.repository.commitLocalChanges([change],{trainingState:state,guards:[this.#guard(snapshot.session),{entity:'session_exercises',id:exerciseId,expectedLocalRevision:exercise.local_revision}]});this.state=state;return record;
  });}

  skipRest(){return this.#run(async()=>{
    if(!this.state?.rest)return null;
    const state={...this.state,rest:null};await this.repository.commitLocalChanges([],{trainingState:state});this.state=state;return state;
  });}

  deleteSet(exerciseId,setId){return this.#run(async()=>{
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===exerciseId),set=exercise?.sets.find(item=>item.id===setId);if(!set)throw new Error('Serie no disponible.');
    const state={...this.state,drafts:{...this.state.drafts},editingSetId:null};delete state.drafts[`${exerciseId}:${setId}`];
    if(state.rest?.setId===setId)state.rest=null;
    await this.repository.commitLocalChanges([remove('exercise_sets',set)],{trainingState:state,guards:[this.#guard(snapshot.session)]});this.state=state;return this.snapshot();
  });}

  deleteExercise(id){return this.#run(async()=>{
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===id);if(!exercise)throw new Error('Ejercicio no disponible.');
    const state={...this.state,currentExerciseId:snapshot.exercises.find(ex=>ex.id!==id)?.id||null};
    if(state.rest?.exerciseId===id)state.rest=null;
    state.drafts=Object.fromEntries(Object.entries(state.drafts).filter(([key])=>!key.startsWith(`${id}:`)));state.editingSetId=null;
    await this.repository.commitLocalChanges([...exercise.sets.map(set=>remove('exercise_sets',set)),remove('session_exercises',exercise)],{trainingState:state,guards:[this.#guard(snapshot.session)]});this.state=state;return this.snapshot();
  });}

  saveUIState(patch){return this.#run(async()=>{
    if(!this.state)return null;const state={...this.state,...clone(patch)};
    if(!['active','exercises','summary'].includes(state.view))throw new Error('Vista inválida.');
    state.activeSessionId=this.state.activeSessionId;
    await this.repository.commitLocalChanges([],{trainingState:state});this.state=state;return this.getState();
  });}

  saveDraft(key,value){return this.#run(async()=>{
    if(!this.state)return null;
    const state={...this.state,drafts:{...this.state.drafts,[key]:clone(value)}};
    await this.repository.commitLocalChanges([],{trainingState:state});this.state=state;return this.getState();
  });}

  saveSummaryDraft(value){return this.#run(async()=>{
    if(!this.state)return null;const state={...this.state,summaryDraft:clone(value)};
    await this.repository.commitLocalChanges([],{trainingState:state});this.state=state;return this.getState();
  });}

  discardDraft(key){return this.#run(async()=>{
    if(!this.state)return;
    const state={...this.state,drafts:{...this.state.drafts}};delete state.drafts[key];
    await this.repository.commitLocalChanges([],{trainingState:state});this.state=state;
  });}

  hasPendingDrafts(){return Object.values(this.state?.drafts||{}).some(draft=>draft.is_completed||['load_kg','reps','duration_seconds','rir'].some(key=>draft[key]!=null&&draft[key]!==''));}

  discardSession(id=this.state?.activeSessionId){return this.#run(async()=>{
    const session=await this.repository.get('workout_sessions',id);if(!session||session.deleted_at||session.status!=='draft')throw new Error('Sólo podés descartar una sesión activa o abandonada.');
    const persisted=await this.repository.getTrainingState(),clearsActive=this.state?.activeSessionId===id||persisted?.activeSessionId===id;
    await this.repository.commitLocalChanges([remove('workout_sessions',session)],{trainingState:clearsActive?null:persisted,guards:[this.#guard(session)]});
    if(clearsActive)this.state=null;
    return this.repository.get('workout_sessions',id);
  });}

  finishSession({rpe,notes=''}={},options={}){return this.#run(async()=>{
    const events=[],emit=event=>events.push({...event,at:this.now().toISOString()}),sessionId=this.state?.activeSessionId??null;
    const finish=async(success,error=null)=>{
      let persistedSession=null,persistedTrainingState=null;
      try{persistedSession=sessionId?await this.repository.get('workout_sessions',sessionId):null;persistedTrainingState=await this.repository.getTrainingState();}catch(readError){emit({stage:'post_read_failed',errorName:readError?.name||'Error',errorMessage:readError?.message||String(readError),errorCode:readError?.code??null});}
      const failedValidation=[...events].reverse().find(event=>event.stage.startsWith('validation_')&&event.passed===false);
      const failureStage=success?null:events.some(event=>event.stage==='transaction_aborted')?'transaction_aborted':failedValidation?.stage??'javascript_exception';
      const result={schemaVersion:1,sessionId,enteredFinishSession:true,success,preState:events.find(event=>event.stage==='pre_state')?.sessionStatus??null,trainingStateActiveSessionId:events.find(event=>event.stage==='pre_state')?.trainingStateActiveSessionId??null,sessionIdMatchesTrainingState:events.find(event=>event.stage==='pre_state')?.sessionIdMatchesTrainingState??false,validations:events.filter(event=>event.stage.startsWith('validation_')).map(event=>({name:event.stage.slice(11),passed:event.passed})),transaction:{opened:events.some(event=>event.stage==='transaction_opened'),stores:events.find(event=>event.stage==='transaction_opened')?.stores??[],workoutSessionUpdateWritten:events.some(event=>event.stage==='workout_session_update_written'),trainingStateCleanupWritten:events.some(event=>event.stage==='training_state_cleanup_written'),committed:events.some(event=>event.stage==='transaction_committed'),aborted:events.some(event=>event.stage==='transaction_aborted')},failureStage,error:error?{name:error?.name||'Error',message:error?.message||String(error),code:error?.code??null}:null,after:{sessionStatus:persistedSession?.status??null,endedAt:persistedSession?.ended_at??null,durationSeconds:persistedSession?.duration_seconds??null,trainingStateActiveSessionId:persistedTrainingState?.activeSessionId??null},events};
      options.onDiagnostic?.(clone(result));return result;
    };
    try{
      emit({stage:'finish_entered'});const trainingState=await this.repository.getTrainingState(),prior=sessionId?await this.repository.get('workout_sessions',sessionId):null;
      emit({stage:'pre_state',sessionStatus:prior?.status??null,trainingStateActiveSessionId:trainingState?.activeSessionId??null,sessionIdMatchesTrainingState:!!sessionId&&sessionId===trainingState?.activeSessionId});
      if(!prior){emit({stage:'validation_session_found',passed:false});throw new Error('Active V3 session was not found.');}emit({stage:'validation_session_found',passed:true});
      if(this.hasPendingDrafts()){emit({stage:'validation_no_pending_drafts',passed:false});throw new Error('Guardá o descartá los borradores de series antes de finalizar.');}emit({stage:'validation_no_pending_drafts',passed:true});
      const snapshot=await this.#editable(),value=optionalNumber(rpe,'RPE',{min:1,max:10});if(value==null){emit({stage:'validation_rpe',passed:false});throw new Error('RPE requerido.');}emit({stage:'validation_rpe',passed:true});
      if(typeof notes!=='string'||notes.length>10000){emit({stage:'validation_notes',passed:false});throw new Error('Notas inválidas.');}emit({stage:'validation_notes',passed:true});
      if(!sessionMetrics(snapshot).completedSets){emit({stage:'validation_completed_sets',passed:false});throw new Error('Completá al menos una serie antes de finalizar o descartá la sesión.');}emit({stage:'validation_completed_sets',passed:true});
      const end=this.now(),duration=Math.floor((end-Date.parse(snapshot.session.started_at))/1000);if(duration<0){emit({stage:'validation_duration',passed:false});throw new Error('La fecha de finalización es anterior al inicio.');}emit({stage:'validation_duration',passed:true});
      await this.repository.commitLocalChanges([update('workout_sessions',snapshot.session,{status:'completed',ended_at:end.toISOString(),duration_seconds:duration,rpe:value,notes})],{trainingState:null,guards:[this.#guard(snapshot.session)],diagnostic:emit});
      this.state=null;const result=await this.snapshot(snapshot.session.id);await finish(true);return result;
    }catch(error){emit({stage:'finish_failed',errorName:error?.name||'Error',errorMessage:error?.message||String(error),errorCode:error?.code??null});await finish(false,error);throw error;}
  });}

  async metrics(id=this.state?.activeSessionId){const snapshot=await this.snapshot(id);return snapshot?sessionMetrics(snapshot,{now:this.now().getTime()}):null;}
  async progression(exerciseId,{readinessScore=null}={}){
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===exerciseId);if(!exercise)throw new Error('Ejercicio no disponible.');
    const occurrenceIndex=snapshot.exercises.filter(ex=>ex.exercise_catalog_id===exercise.exercise_catalog_id).findIndex(ex=>ex.id===exercise.id);
    return v3Progression({exercise,session:snapshot.session,history:await this.history(),readinessScore,now:this.now(),occurrenceIndex});
  }
  async prs(){return estimatedPRs(await this.history());}
}
