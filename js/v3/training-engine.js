import {localDateKey} from '../plan.js';
import {isV3TrainingEnabled,isV3RoutinesEnabled} from './feature-flags.js';
import {V3RoutineService} from './routine-service.js';
import {routineForDay,routineCatalogId} from './routines.js';
import {requiredText,optionalNumber,validatePrescription,validateSet} from './training-validation.js';
import {sessionMetrics,estimatedPRs} from './training-metrics.js';
import {v3Progression} from './training-progression.js';
import {rolloutFlag,rolloutBlocksNewWork} from './rollout-state.js';

const clone=value=>structuredClone(value);
const insert=(entity,id,payload)=>({entity,id,type:'insert',payload});
const update=(entity,record,payload)=>({entity,id:record.id,type:'update',payload,expectedLocalRevision:record.local_revision});
const remove=(entity,record)=>({entity,id:record.id,type:'soft_delete',expectedLocalRevision:record.local_revision});

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
  async catalog(){return (await this.repository.listRecords('exercise_catalog')).sort((a,b)=>a.canonical_name.localeCompare(b.canonical_name));}

  recover(){return this.#run(async()=>{
    const saved=await this.repository.getTrainingState();
    let snapshot=saved?.activeSessionId?await this.snapshot(saved.activeSessionId):null;
    if(!snapshot||snapshot.session.deleted_at||snapshot.session.status!=='draft'){
      const sessions=(await this.repository.listSessions({status:'draft'})).filter(item=>item.started_at&&!item.reconstructed);
      sessions.sort((a,b)=>b.started_at.localeCompare(a.started_at));snapshot=sessions[0]?await this.snapshot(sessions[0].id):null;
    }
    this.state=snapshot?{activeSessionId:snapshot.session.id,currentExerciseId:snapshot.exercises[0]?.id||null,view:'active',drafts:{},summaryDraft:{},...(saved?.activeSessionId===snapshot.session.id?saved:{})}:null;
    if(this.state&&!snapshot.exercises.some(ex=>ex.id===this.state.currentExerciseId))this.state.currentExerciseId=snapshot.exercises[0]?.id||null;
    await this.repository.commitLocalChanges([],{trainingState:this.state});return snapshot;
  });}

  createSession({label,date,dayIndex,useRoutine=true,routineVersionId}={}){return this.#run(async()=>{
    if(rolloutBlocksNewWork()||rolloutFlag('v3_training_enabled')===false)throw new Error('Esta versión no puede iniciar una sesión V3 nueva.');
    const now=this.now(),sessionDate=date??localDateKey(now);
    if(dayIndex!=null&&(!Number.isInteger(dayIndex)||dayIndex<0||dayIndex>6))throw new Error('Día de rutina inválido.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)||localDateKey(new Date(`${sessionDate}T12:00:00`))!==sessionDate)throw new Error('Fecha inválida.');
    const routine=routineForDay(dayIndex??new Date(`${sessionDate}T12:00:00`).getDay()),id=this.crypto.randomUUID();
    if(routineVersionId&&!this.routines)throw new Error('Habilitá explícitamente rutinas V3 para elegir una versión.');
    let concrete=null;
    if(this.routines&&(routineVersionId||useRoutine&&routine.exercises.length)){
      if(routineVersionId)concrete=await this.routines.version(routineVersionId,{forTraining:true});
      else{const defaults=await this.routines.seedDefaults(),selected=defaults.find(item=>item.version.day_index===routine.dayIndex);concrete=await this.routines.version(selected.version.id,{forTraining:true});}
    }
    const session={session_date:sessionDate,label:requiredText(label??concrete?.snapshot.name??routine.label,'Nombre de sesión'),status:'draft',started_at:now.toISOString(),ended_at:null,duration_seconds:null,rpe:null,notes:''};
    if(concrete)Object.assign(session,{routine_id:concrete.template.id,routine_version:concrete.version.version_number,routine_version_id:concrete.version.id,routine_snapshot:clone(concrete.snapshot)});
    const changes=[insert('workout_sessions',id,session)],catalog=await this.catalog();
    const exerciseIds=[];
    const items=concrete?concrete.snapshot.exercises.map(ex=>({catalog_id:ex.exercise_catalog_id,canonical_name:ex.exercise_name_snapshot,prescription:ex.prescription_snapshot})):(useRoutine?routine.exercises:[]);
    for(const [position,item] of items.entries()){
      let entry=catalog.find(ex=>(item.catalog_id?ex.id===item.catalog_id:ex.stable_key===item.stable_key)&&!ex.deleted_at);
      if(concrete&&!entry)throw new Error('Catálogo cambiado mientras se iniciaba la sesión; revisar la versión.');
      if(!entry){entry={id:await routineCatalogId(this.repository.userId,item.stable_key),...item};changes.push(insert('exercise_catalog',entry.id,{stable_key:entry.stable_key,canonical_name:entry.canonical_name,measurement_kind:entry.measurement_kind,metadata:{source:'validated-v2-plan'}}));catalog.push(entry);}
      const exerciseId=this.crypto.randomUUID();exerciseIds.push(exerciseId);
      changes.push(insert('session_exercises',exerciseId,{session_id:id,exercise_catalog_id:entry.id,position,exercise_name_snapshot:concrete?item.canonical_name:entry.canonical_name,prescription_snapshot:validatePrescription(item.prescription),notes:''}));
    }
    const state={activeSessionId:id,currentExerciseId:exerciseIds[0]||null,view:'active',drafts:{},summaryDraft:{}};
    await this.repository.commitLocalChanges(changes,{trainingState:state});this.state=state;return this.snapshot(id);
  });}

  selectSession(id){return this.#run(async()=>{
    const snapshot=await this.#editable(id),state={activeSessionId:id,currentExerciseId:snapshot.exercises[0]?.id||null,view:'active',drafts:{},summaryDraft:{}};
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

  saveSet(exerciseId,input,{setId}={}){return this.#run(async()=>{
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===exerciseId);if(!exercise)throw new Error('Ejercicio no disponible.');
    const current=setId?exercise.sets.find(set=>set.id===setId):null;if(setId&&!current)throw new Error('Serie no disponible.');
    const value=validateSet(current?{...current,...input}:input,exercise.prescription_snapshot.measurement_kind);
    value.completed_at=value.is_completed?(current?.is_completed?current.completed_at:this.now().toISOString()):null;
    const id=current?.id||this.crypto.randomUUID(),change=current?update('exercise_sets',current,value):insert('exercise_sets',id,{...value,session_exercise_id:exerciseId,position:Math.max(-1,...exercise.sets.map(set=>set.position))+1});
    const state={...this.state,drafts:{...this.state.drafts},currentExerciseId:exerciseId};delete state.drafts[`${exerciseId}:${setId||'new'}`];
    const [record]=await this.repository.commitLocalChanges([change],{trainingState:state,guards:[this.#guard(snapshot.session),{entity:'session_exercises',id:exerciseId,expectedLocalRevision:exercise.local_revision}]});this.state=state;return record;
  });}

  deleteSet(exerciseId,setId){return this.#run(async()=>{
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===exerciseId),set=exercise?.sets.find(item=>item.id===setId);if(!set)throw new Error('Serie no disponible.');
    const state={...this.state,drafts:{...this.state.drafts},editingSetId:null};delete state.drafts[`${exerciseId}:${setId}`];
    await this.repository.commitLocalChanges([remove('exercise_sets',set)],{trainingState:state,guards:[this.#guard(snapshot.session)]});this.state=state;return this.snapshot();
  });}

  deleteExercise(id){return this.#run(async()=>{
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===id);if(!exercise)throw new Error('Ejercicio no disponible.');
    const state={...this.state,currentExerciseId:snapshot.exercises.find(ex=>ex.id!==id)?.id||null};
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

  finishSession({rpe,notes=''}={}){return this.#run(async()=>{
    if(this.hasPendingDrafts())throw new Error('Guardá o descartá los borradores de series antes de finalizar.');
    const snapshot=await this.#editable(),value=optionalNumber(rpe,'RPE',{min:1,max:10});if(value==null)throw new Error('RPE requerido.');
    if(typeof notes!=='string'||notes.length>10000)throw new Error('Notas inválidas.');
    if(!sessionMetrics(snapshot).completedSets)throw new Error('Completá al menos una serie antes de finalizar.');
    const end=this.now(),duration=Math.floor((end-Date.parse(snapshot.session.started_at))/1000);if(duration<0)throw new Error('La fecha de finalización es anterior al inicio.');
    await this.repository.commitLocalChanges([update('workout_sessions',snapshot.session,{status:'completed',ended_at:end.toISOString(),duration_seconds:duration,rpe:value,notes})],{trainingState:null,guards:[this.#guard(snapshot.session)]});
    this.state=null;return this.snapshot(snapshot.session.id);
  });}

  async metrics(id=this.state?.activeSessionId){const snapshot=await this.snapshot(id);return snapshot?sessionMetrics(snapshot,{now:this.now().getTime()}):null;}
  async progression(exerciseId,{readinessScore=null}={}){
    const snapshot=await this.#editable(),exercise=snapshot.exercises.find(ex=>ex.id===exerciseId);if(!exercise)throw new Error('Ejercicio no disponible.');
    const occurrenceIndex=snapshot.exercises.filter(ex=>ex.exercise_catalog_id===exercise.exercise_catalog_id).findIndex(ex=>ex.id===exercise.id);
    return v3Progression({exercise,session:snapshot.session,history:await this.history(),readinessScore,now:this.now(),occurrenceIndex});
  }
  async prs(){return estimatedPRs(await this.history());}
}
