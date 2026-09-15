import {isV3SignalsEnabled} from './feature-flags.js';
import {validateSignal} from './signals-validation.js';
import {stableClientUuid} from './import-v2.js';
import {SIGNAL_STORES} from './indexed-db.js';

export class V3SignalsRepository{
  constructor({repository,featureEnabled,flagStorage=globalThis.localStorage}={}){if(!(featureEnabled??isV3SignalsEnabled(flagStorage)))throw new Error('V3 signals disabled.');if(!repository?.userId)throw new Error('User repository required.');this.repository=repository;this.userId=repository.userId;}
  async list(entity,{date,includeDeleted=false}={}){if(!SIGNAL_STORES.includes(entity))throw new Error('Invalid signal entity.');return (await this.repository.listRecords(entity,{includeDeleted})).filter(row=>!date||row.local_date===date);}
  async save(entity,input,{id,expectedLocalRevision}={}){
    const payload=validateSignal(entity,input);if(!id&&entity==='daily_readiness')id=(await this.list(entity,{date:payload.local_date,includeDeleted:true}))[0]?.id;id??=entity==='daily_readiness'?await stableClientUuid(`signals:${this.userId}:readiness:${payload.local_date}`):this.repository.crypto.randomUUID();
    const existing=await this.repository.get(entity,id);if(existing&&existing.local_date!==payload.local_date)throw new Error('Signal date is immutable.');
    if(existing&&entity==='football_sessions'&&payload.session_type!=='match'&&(await this.list('match_reviews')).some(row=>row.football_session_id===id))throw new Error('Match with reviews cannot become training/friendly.');
    if(existing&&expectedLocalRevision==null)throw new Error('Expected local revision required for edits.');
    const guards=[];
    if(entity==='match_reviews'&&payload.football_session_id){const parent=await this.repository.get('football_sessions',payload.football_session_id);if(!parent||parent.deleted_at||parent.session_type!=='match'||parent.local_date!==payload.local_date)throw new Error('Review requires live same-date match.');guards.push({entity:'football_sessions',id:parent.id,expectedLocalRevision:parent.local_revision});}
    await this.repository.commitLocalChanges([{entity,id,type:existing?'update':'insert',payload,...(existing?{expectedLocalRevision}:{})}],{guards});return this.repository.get(entity,id);
  }
  async softDelete(entity,id,expectedLocalRevision){if(!SIGNAL_STORES.includes(entity))throw new Error('Invalid signal entity.');const changes=[];if(entity==='football_sessions')for(const review of (await this.list('match_reviews')).filter(row=>row.football_session_id===id))changes.push({entity:'match_reviews',id:review.id,type:'soft_delete',expectedLocalRevision:review.local_revision});changes.push({entity,id,type:'soft_delete',expectedLocalRevision});await this.repository.commitLocalChanges(changes);}
  async coachContext(){
    const [readiness,football,matches]=await Promise.all(SIGNAL_STORES.map(entity=>this.list(entity)));
    const mappings=await this.repository.listMigrationMappings(),pendingIds=new Set(mappings.filter(row=>row.migration_status==='pending_review').map(row=>row.target_id));
    const usable=row=>row.migration_status!=='pending_review'&&!pendingIds.has(row.id);const footballIds=new Set(football.filter(usable).map(row=>row.id));
    const warnings=[];if([...readiness,...football,...matches].some(row=>!usable(row)))warnings.push('Señales importadas pendientes de revisión excluidas del Coach.');
    if(mappings.some(row=>row.source_key.startsWith('signals-v2:')&&row.migration_status==='pending_review'))warnings.push('Importación de señales con casos ambiguos pendientes de revisión.');
    const hasConflicts=(await this.repository.listConflicts()).some(row=>SIGNAL_STORES.includes(row.entity))||[...readiness,...football,...matches].some(row=>row.sync_status==='conflict');
    if(hasConflicts)warnings.push('Conflictos en señales: se bloquean aumentos hasta revisión.');
    return {readiness:readiness.filter(usable).map(row=>({...row,date:row.local_date})),football:football.filter(usable).map(row=>({...row,date:row.local_date,duration:row.duration_minutes})),matches:matches.filter(row=>usable(row)&&(!row.football_session_id||footballIds.has(row.football_session_id))).map(row=>({...row,date:row.local_date})),warnings,hasConflicts};
  }
}
