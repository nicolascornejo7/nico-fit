import {stableClientUuid} from './import-v2.js';
import {validateSignal} from './signals-validation.js';
import {loadLocalData} from '../store.js';

export function importOwnedV2Signals(signals){return importV2Signals(signals,loadLocalData(signals.userId));}

const typeMap={'Partido':'match','Amistoso':'friendly','Práctica amistosa F11':'friendly','Entrenamiento equipo':'training','Entrenamiento con el equipo':'training'};
// Explicit caller supplies one owned V2 snapshot; never read a guest/shared key.
export async function importV2Signals(signals,v2){
  const repository=signals.repository,report={migrated:0,pending_review:0,skipped:0};
  const definitions=[['readiness','daily_readiness',row=>row.date,row=>({local_date:row.date,sleep:row.sleep,energy:row.energy,freshness:typeof row.fatigue==='number'?6-row.fatigue:row.freshness,pain:row.pain,pain_area:row.painArea,notes:row.notes})],['football','football_sessions',row=>JSON.stringify([row.date,row.type]),row=>({local_date:row.date,session_type:typeMap[row.type],duration_minutes:row.duration,rpe:row.rpe,minutes_played:row.minutes,notes:row.notes})],['matches','match_reviews',row=>row.date,row=>({local_date:row.date,football_session_id:null,energy:row.energy,legs:row.legs,performance:row.performance,rpe:row.rpe,minutes_played:row.minutes,notes:row.notes})]];
  for(const [collection,entity,keyOf,convert] of definitions){
    const groups=new Map();for(const row of v2[collection]??[]){const key=keyOf(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    for(const [key,rows] of groups){
      const sourceKey=`signals-v2:${signals.userId}:${collection}:${key}`,row=rows[0];let status='migrated',note='Explicit conversion from owned V2 snapshot.',payload;
      if(rows.some(other=>JSON.stringify(other)!==JSON.stringify(row))){status='pending_review';note='Multiple different V2 values for the same identity; no automatic selection.';}
      if(row.deleted_at||row.deletedAt||(v2.tombstones??[]).some(item=>item.entity===collection&&item.recordKey===key||item.entity==='*'&&!(Date.parse(row.updatedAt)>Date.parse(item.deletedAt)))){status='skipped';note='V2 tombstone: not imported.';}
      const existing=(await repository.listMigrationMappings()).find(mapping=>mapping.source_key===sourceKey);
      if(existing){if(existing.migration_status==='migrated'&&(status!=='migrated'||JSON.stringify(existing.source_payload)!==JSON.stringify(row))){if(await repository.markSignalImportChanged(sourceKey,rows))report.pending_review++;}continue;}
      if(status==='migrated')try{payload=validateSignal(entity,convert(row));}catch(error){status='pending_review';note=error.message;}
      // V2 match reviews do not prove which same-day match they describe, nor missing RPE/minutes.
      if(entity==='match_reviews'&&status==='migrated'){status='pending_review';note='Review has no explicit football UUID; missing RPE/minutes are not inferred.';}
      if(status!=='migrated'){const result=await repository.recordMigrationDecision({sourceKey,entity,status,note,sourcePayload:rows});if(result.created)report[status]++;continue;}
      const result=await repository.importRecord(entity,{sourceKey,id:await stableClientUuid(sourceKey),payload:{...payload,source_payload:row},status,note,enqueue:true});if(result.created)report.migrated++;
    }
  }
  return report;
}
