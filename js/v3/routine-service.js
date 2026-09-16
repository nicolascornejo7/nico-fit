import {isV3RoutinesEnabled} from './feature-flags.js';
import {routineForDay,routineCatalogId} from './routines.js';
import {stableClientUuid} from './import-v2.js';
import {requiredText} from './training-validation.js';
import {routinePrescription,sameRoutineValue} from './routine-validation.js';
const insert=(entity,id,payload)=>({entity,id,type:'insert',payload});
const uuid=()=>crypto.randomUUID();
export const defaultRoutineId=(userId,dayIndex)=>stableClientUuid(`v3:routine-template:${userId}:validated-day-${dayIndex}`);

// Public API for a future editor. Every prescription change publishes a new graph.
export class V3RoutineService{
  constructor({repository,flagStorage=globalThis.localStorage,featureEnabled}={}){
    if(!repository||!(featureEnabled??isV3RoutinesEnabled(flagStorage)))throw new Error('Rutinas V3 desactivadas.');
    this.repository=repository;
  }
  async list(){const templates=await this.repository.listRecords('routine_templates'),versions=await this.repository.listRecords('routine_versions'),conflicts=await this.repository.listConflicts();return templates.map(template=>({...template,versions:versions.filter(row=>row.routine_id===template.id).sort((a,b)=>b.version_number-a.version_number),conflicts:conflicts.filter(row=>row.status==='open'&&(row.record_id===template.id||versions.some(version=>version.routine_id===template.id&&(version.id===row.record_id||version.prescription_snapshot.exercises.some(ex=>ex.id===row.record_id||ex.exercise_catalog_id===row.record_id)))))}));}
  async version(versionId,{forTraining=false}={}){
    const version=await this.repository.get('routine_versions',versionId);if(!version)throw new Error('Versión no encontrada.');
    const template=await this.repository.get('routine_templates',version.routine_id),rows=(await this.repository.listRecords('routine_exercises')).filter(row=>row.routine_version_id===versionId).sort((a,b)=>a.position-b.position);
    if(forTraining){
      if(!template?.is_active||template.deleted_at||version.deleted_at)throw new Error('Rutina desactivada o borrada.');
      if(rows.length!==version.prescription_snapshot.exercises.length||rows.some((row,index)=>row.deleted_at||!['id','position','exercise_catalog_id','exercise_name_snapshot','prescription_snapshot'].every(key=>sameRoutineValue(row[key],version.prescription_snapshot.exercises[index][key]))))throw new Error('Versión incompleta: esperar descarga o revisar conflictos.');
      const conflicts=await this.repository.listConflicts();const ids=new Set([template.id,version.id,...rows.flatMap(row=>[row.id,row.exercise_catalog_id])]);
      if(conflicts.some(row=>row.status==='open'&&ids.has(row.record_id))||[template,version,...rows].some(row=>row.sync_status==='conflict'))throw new Error('Conflicto de rutina pendiente: no iniciar una sesión nueva con esta versión.');
      for(const row of rows){const catalog=await this.repository.get('exercise_catalog',row.exercise_catalog_id);if(!catalog||catalog.deleted_at||catalog.sync_status==='conflict')throw new Error('Catálogo no disponible para esta versión.');}
    }
    return {template,version,exercises:rows,snapshot:structuredClone(version.prescription_snapshot)};
  }
  async #changes(template,exercises,{versionNumber,versionId=uuid(),name=template.name,dayIndex=null,deterministicKey=null}={}){
    if(!exercises?.length||exercises.length>100)throw new Error('La rutina requiere entre 1 y 100 ejercicios.');
    const rows=[];for(const [position,input] of exercises.entries()){
      const catalog=await this.repository.get('exercise_catalog',input.exercise_catalog_id);if(!catalog||catalog.deleted_at)throw new Error('Ejercicio de catálogo no disponible.');
      if(catalog.measurement_kind!=='mixed'&&input.prescription_snapshot?.measurement_kind&&input.prescription_snapshot.measurement_kind!==catalog.measurement_kind)throw new Error('La unidad de prescripción no coincide con el catálogo.');
      const prescription_snapshot=routinePrescription({...input.prescription_snapshot,measurement_kind:catalog.measurement_kind==='mixed'?input.prescription_snapshot?.measurement_kind:catalog.measurement_kind});
      rows.push({id:deterministicKey?await stableClientUuid(`${deterministicKey}:exercise:${position}`):uuid(),routine_version_id:versionId,exercise_catalog_id:catalog.id,position,exercise_name_snapshot:input.exercise_name_snapshot??catalog.canonical_name,prescription_snapshot});
    }
    const snapshot={schema_version:1,routine_id:template.id,routine_version:versionNumber,routine_version_id:versionId,name:requiredText(name,'Nombre histórico'),day_index:dayIndex,exercises:rows.map(({routine_version_id,...row})=>row)};
    return [insert('routine_versions',versionId,{routine_id:template.id,version_number:versionNumber,name_snapshot:snapshot.name,day_index:dayIndex,prescription_snapshot:snapshot}),...rows.map(({id,...row})=>insert('routine_exercises',id,row))];
  }
  async create({name,exercises,dayIndex=null,derivedFrom=null,id=uuid(),stableKey=`custom:${id}`}={}){
    const template={id,name:requiredText(name,'Rutina'),stable_key:stableKey,is_active:true,derived_from_routine_id:derivedFrom};
    const changes=await this.#changes(template,exercises,{versionNumber:1,dayIndex});
    await this.repository.commitLocalChanges([insert('routine_templates',id,template),...changes]);return this.version(changes[0].id);
  }
  async createVersion(routineId,{exercises,dayIndex,name}={}){
    const template=await this.repository.get('routine_templates',routineId);if(!template||template.deleted_at)throw new Error('Rutina no disponible.');
    const versions=(await this.repository.listRecords('routine_versions',{includeDeleted:true})).filter(row=>row.routine_id===routineId),previous=versions.sort((a,b)=>b.version_number-a.version_number)[0];
    const changes=await this.#changes(template,exercises,{versionNumber:(previous?.version_number||0)+1,dayIndex:dayIndex===undefined?previous?.day_index??null:dayIndex,name:name??template.name});
    await this.repository.commitLocalChanges(changes,{guards:[{entity:'routine_templates',id:template.id,expectedLocalRevision:template.local_revision}]});return this.version(changes[0].id);
  }
  async rename(id,name){const template=await this.repository.get('routine_templates',id);if(!template)throw new Error('Rutina no encontrada.');const [row]=await this.repository.commitLocalChanges([{entity:'routine_templates',id,type:'update',payload:{name:requiredText(name,'Rutina')},expectedLocalRevision:template.local_revision}]);return row;}
  async setActive(id,isActive){if(typeof isActive!=='boolean')throw new Error('Estado inválido.');const template=await this.repository.get('routine_templates',id);if(!template)throw new Error('Rutina no encontrada.');const [row]=await this.repository.commitLocalChanges([{entity:'routine_templates',id,type:'update',payload:{is_active:isActive},expectedLocalRevision:template.local_revision}]);return row;}
  async duplicate(versionId,name){const source=await this.version(versionId);return this.create({name,exercises:source.snapshot.exercises,dayIndex:source.version.day_index,derivedFrom:source.template.id});}
  async seedDefaults(){
    const result=[];
    for(const dayIndex of [2,4,5]){
      const id=await defaultRoutineId(this.repository.userId,dayIndex),source=routineForDay(dayIndex),versionId=await stableClientUuid(`v3:routine-version:${id}:1`);
      if(await this.repository.get('routine_templates',id)){result.push(await this.version(versionId));continue;}
      // Seed only the known stable plan IDs. No matching by name or weekday history.
      const changes=[],exercises=[],catalog=await this.repository.listRecords('exercise_catalog',{includeDeleted:true});for(const item of source.exercises){const existing=catalog.find(row=>row.stable_key===item.stable_key),catalogId=existing?.id??await routineCatalogId(this.repository.userId,item.stable_key);if(existing?.deleted_at)throw new Error('Catálogo inicial borrado: revisión explícita requerida.');if(!existing)changes.push(insert('exercise_catalog',catalogId,{stable_key:item.stable_key,canonical_name:item.canonical_name,measurement_kind:item.measurement_kind,metadata:{source:'validated-v2-plan'}}));exercises.push({exercise_catalog_id:catalogId,exercise_name_snapshot:item.canonical_name,prescription_snapshot:routinePrescription(item.prescription)});}
      // Catalog and template are committed together; build the known seed graph without rereading missing rows.
      const template={id,name:source.label,stable_key:`validated-day-${dayIndex}`,is_active:true,derived_from_routine_id:null},rows=[];
      for(const [position,ex] of exercises.entries())rows.push({id:await stableClientUuid(`v3:routine-version:${id}:1:exercise:${position}`),position,...ex});
      const snapshot={schema_version:1,routine_id:id,routine_version:1,routine_version_id:versionId,name:source.label,day_index:dayIndex,exercises:rows};
      await this.repository.commitLocalChanges([...changes,insert('routine_templates',id,template),insert('routine_versions',versionId,{routine_id:id,version_number:1,name_snapshot:source.label,day_index:dayIndex,prescription_snapshot:snapshot}),...rows.map(({id:rowId,...row})=>insert('routine_exercises',rowId,{...row,routine_version_id:versionId}))]);
      await this.repository.recordMigrationDecision({sourceKey:`v3:routine-seed:${dayIndex}:1`,entity:'routine_templates',status:'migrated',note:'Known validated V2 plan; no historic sessions inferred.',sourcePayload:source});result.push(await this.version(versionId));
    }
    return result;
  }
}
