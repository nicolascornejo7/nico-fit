import {exerciseId} from '../exercise-identity.js';

const encoder=new TextEncoder();
const text=value=>String(value??'').trim();
const finite=value=>value!==''&&value!=null&&Number.isFinite(Number(value));

export async function stableClientUuid(value,cryptoImpl=globalThis.crypto){
  if(!cryptoImpl?.subtle)throw new Error('Web Crypto is required for deterministic import UUIDs.');
  const digest=new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',encoder.encode(String(value))));
  const bytes=digest.slice(0,16);bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function meaningfulSet(set){
  return !!set&&(set.done||finite(set.kg)||finite(set.reps)||finite(set.rir));
}

function sessionSourceKey(userId,session){return `v2:${userId}:session:${text(session.date)}:${text(session.label)}`;}
function workoutSourceKey(userId,workout){return `v2:${userId}:workout:${text(workout.date)}:${exerciseId(workout.exerciseId||workout.exercise)}`;}

export async function importV2LocalData(repository,v2Data={}){
  if(!repository?.userId)throw new Error('A user-scoped V3 repository is required.');
  const owner=repository.userId,sessions=Array.isArray(v2Data.sessions)?v2Data.sessions:[],workouts=Array.isArray(v2Data.workouts)?v2Data.workouts:[];
  const report={sessions:0,reconstructedSessions:0,exercises:0,sets:0,pendingReview:0,skipped:0};
  const sessionIdsByDate=new Map();

  for(const session of sessions){
    if(!text(session.date)||!text(session.label))continue;
    const sourceKey=sessionSourceKey(owner,session),id=await stableClientUuid(sourceKey);
    const complete=!!session.startedAt&&!!session.endedAt;
    const result=await repository.importRecord('workout_sessions',{
      sourceKey,id,status:complete?'migrated':'pending_review',
      note:complete?'Imported from a finalized V2 session.':'V2 session is incomplete and requires review.',
      payload:{
        session_date:session.date,label:session.label,status:complete?'completed':'draft',
        started_at:session.startedAt||null,ended_at:session.endedAt||null,
        duration_seconds:finite(session.durationSeconds)?Number(session.durationSeconds):null,
        rpe:finite(session.rpe)?Number(session.rpe):null,notes:text(session.notes),
        reconstructed:false,source_payload:session
      }
    });
    if(result.created)report.sessions+=1;
    if(!complete)report.pendingReview+=1;
    const values=sessionIdsByDate.get(session.date)||[];values.push(id);sessionIdsByDate.set(session.date,values);
  }

  const positions=new Map();
  for(const workout of workouts){
    const sourceKey=workoutSourceKey(owner,workout),name=text(workout.exercise),sets=(Array.isArray(workout.sets)?workout.sets:[]).filter(meaningfulSet);
    if(!text(workout.date)||!name||!sets.length){
      const mapping=await repository.recordMigrationDecision({sourceKey,entity:'session_exercises',status:'skipped',note:'Empty V2 exercise was not imported.',sourcePayload:workout});
      if(mapping.created)report.skipped+=1;
      continue;
    }

    const candidates=sessionIdsByDate.get(workout.date)||[];
    let parentId=candidates.length===1?candidates[0]:null;
    if(!parentId){
      const reconstructedKey=`${sourceKey}:reconstructed-session`,id=await stableClientUuid(reconstructedKey);
      const reason=candidates.length>1?'Multiple V2 sessions exist on this date; no parent was inferred.':'No finalized V2 session exists on this date.';
      const reconstructed=await repository.importRecord('workout_sessions',{
        sourceKey:reconstructedKey,id,status:'pending_review',note:reason,
        payload:{session_date:workout.date,label:`Importación V2 · ${name}`,status:'draft',started_at:null,ended_at:null,duration_seconds:null,rpe:null,notes:'',reconstructed:true,source_payload:workout}
      });
      if(reconstructed.created){report.sessions+=1;report.reconstructedSessions+=1;report.pendingReview+=1;}
      parentId=id;
    }

    const stableKey=exerciseId(workout.exerciseId||name),catalogSource=`v2:${owner}:catalog:${stableKey}`,catalogId=await stableClientUuid(catalogSource);
    await repository.importRecord('exercise_catalog',{
      sourceKey:catalogSource,id:catalogId,status:'pending_review',note:'Measurement kind needs explicit review.',
      payload:{stable_key:stableKey,canonical_name:name,measurement_kind:'mixed',metadata:{imported_from:'v2-local'},source_payload:{exerciseId:workout.exerciseId||null,exercise:name}}
    });

    const position=positions.get(parentId)||0;positions.set(parentId,position+1);
    const exerciseRecordId=await stableClientUuid(`${sourceKey}:session-exercise`);
    const exerciseResult=await repository.importRecord('session_exercises',{
      sourceKey,id:exerciseRecordId,status:'pending_review',note:'Exercise order and measurement type are synthetic and require review.',
      payload:{session_id:parentId,exercise_catalog_id:catalogId,exercise_key:stableKey,position,exercise_name_snapshot:name,prescription_snapshot:{},notes:'',position_is_inferred:true,source_payload:workout}
    });
    if(exerciseResult.created){report.exercises+=1;report.pendingReview+=1;}

    for(const [index,set] of sets.entries()){
      const setKey=`${sourceKey}:set:${index}`,setId=await stableClientUuid(setKey),hasAmbiguousValue=finite(set.reps);
      const result=await repository.importRecord('exercise_sets',{
        sourceKey:setKey,id:setId,status:'pending_review',note:hasAmbiguousValue?'V2 does not distinguish repetitions from seconds.':'V2 set is incomplete.',
        payload:{
          session_exercise_id:exerciseRecordId,position:index,
          load_kg:finite(set.kg)&&Number(set.kg)>=0?Number(set.kg):null,reps:null,duration_seconds:null,
          rir:finite(set.rir)&&Number(set.rir)>=0&&Number(set.rir)<=5?Number(set.rir):null,
          is_completed:false,completed_at:null,legacy_done_snapshot:!!set.done,
          legacy_value_snapshot:set.reps??null,source_payload:set
        }
      });
      if(result.created){report.sets+=1;report.pendingReview+=1;}
    }
  }
  return report;
}
