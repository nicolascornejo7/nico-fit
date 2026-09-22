const COMMON_FIELDS=['id','created_at','deleted_at'];
const SIGNAL_TRACE=['migration_status','migration_note','source_payload'];

export const REMOTE_ENTITY_FIELDS=Object.freeze({
  workout_sessions:[...COMMON_FIELDS,'session_date','label','status','started_at','ended_at','duration_seconds','rpe','notes','session_type','routine_id','routine_version','routine_version_id','routine_snapshot'],
  session_exercises:[...COMMON_FIELDS,'session_id','exercise_catalog_id','position','exercise_name_snapshot','prescription_snapshot','notes'],
  exercise_sets:[...COMMON_FIELDS,'session_exercise_id','position','load_kg','reps','duration_seconds','rir','is_completed','completed_at'],
  exercise_catalog:[...COMMON_FIELDS,'stable_key','canonical_name','measurement_kind','metadata'],
  daily_readiness:[...COMMON_FIELDS,...SIGNAL_TRACE,'local_date','sleep','energy','freshness','pain','pain_area','notes'],
  football_sessions:[...COMMON_FIELDS,...SIGNAL_TRACE,'local_date','session_type','duration_minutes','rpe','minutes_played','notes'],
  match_reviews:[...COMMON_FIELDS,...SIGNAL_TRACE,'local_date','football_session_id','energy','legs','performance','rpe','minutes_played','notes'],
  routine_templates:[...COMMON_FIELDS,'stable_key','name','is_active','derived_from_routine_id'],
  routine_versions:[...COMMON_FIELDS,'routine_id','version_number','name_snapshot','day_index','prescription_snapshot'],
  routine_exercises:[...COMMON_FIELDS,'routine_version_id','exercise_catalog_id','position','exercise_name_snapshot','prescription_snapshot']
});

const stableValue=value=>{
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));
  return value;
};
const sameValue=(left,right)=>JSON.stringify(stableValue(left))===JSON.stringify(stableValue(right));

export function remotePayloadForOperation(operation,userId){
  const fields=REMOTE_ENTITY_FIELDS[operation.entity];
  if(!fields)throw new Error(`Unsupported remote V3 entity: ${operation.entity}`);
  const payload={};
  for(const field of fields)if(Object.hasOwn(operation.payload,field))payload[field]=structuredClone(operation.payload[field]);
  if(['workout_sessions','daily_readiness','football_sessions','match_reviews','routine_templates','routine_versions','routine_exercises'].includes(operation.entity))payload.user_id=userId;
  if(operation.entity==='exercise_catalog')payload.owner_user_id=userId;
  payload.version=operation.type==='insert'?1:Number(operation.base_remote_version)+1;
  if(operation.type!=='insert')delete payload.created_at;
  return payload;
}

export function remoteConfirmsOperation(operation,remoteRecord,userId){
  if(!remoteRecord||remoteRecord.id!==operation.record_id)return false;
  const expected=remotePayloadForOperation(operation,userId);
  return Object.entries(expected).every(([key,value])=>sameValue(remoteRecord[key],value));
}

function canCompact(group,operation){
  if(operation.preserve_transition||group.operations.some(item=>item.preserve_transition))return false;
  if(group.entity!==operation.entity||group.recordId!==operation.record_id)return false;
  if(group.type==='insert')return operation.base_remote_version==null;
  return operation.type!=='insert'&&operation.base_remote_version===group.baseRemoteVersion;
}

export function compactOperations(operations){
  const sorted=[...operations].sort((a,b)=>a.sequence-b.sequence),groups=[];
  for(const operation of sorted){
    const last=groups.at(-1);
    if(last&&canCompact(last,operation)){
      last.operations.push(operation);last.operationIds.push(operation.operation_id);last.payload=structuredClone(operation.payload);
      if(operation.type==='soft_delete')last.type='soft_delete';
      continue;
    }
    groups.push({
      entity:operation.entity,recordId:operation.record_id,type:operation.type,
      baseRemoteVersion:operation.base_remote_version,payload:structuredClone(operation.payload),
      operations:[operation],operationIds:[operation.operation_id]
    });
  }
  return groups;
}

export function classifySyncError(error){
  const code=String(error?.code||''),status=Number(error?.status||error?.statusCode||0);
  if(code==='PT409'||code==='55000'||status===409)return 'conflict';
  if(status===401||code==='401'||code==='PGRST301')return 'auth';
  if(status===408||status===425||status===429||status>=500||error?.name==='TypeError'||code==='NETWORK_ERROR')return 'transient';
  return 'permanent';
}

export function retryDelayMs(attempt,{baseMs=1000,maxMs=60000,random=Math.random}={}){
  const exponential=Math.min(maxMs,baseMs*(2**Math.max(0,attempt-1)));
  return Math.round(exponential*(0.75+random()*0.5));
}

