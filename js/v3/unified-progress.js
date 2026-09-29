import {exerciseId} from '../exercise-identity.js';
import {sessionMetrics} from './training-metrics.js';

const finite=value=>value!==''&&value!=null&&Number.isFinite(Number(value));
const number=value=>finite(value)?Number(value):0;
const score=row=>{
  if(!row)return null;const freshness=finite(row.freshness)?number(row.freshness):finite(row.fatigue)?6-number(row.fatigue):3;
  return Math.max(0,Math.min(100,Math.round(((number(row.sleep)+number(row.energy)+freshness)/15)*100-Math.max(0,number(row.pain)-2)*3)));
};
const namespaced=(source,kind,id)=>`${source}:${kind}:${String(id)}`;
const legacyId=(kind,row,index)=>row.id??row.uuid??`${row.date??'unknown'}:${row.label??row.type??row.exerciseId??row.exercise??kind}:${index}`;
const legacySourceKey=(userId,kind,row)=>{
  if(kind==='session')return `v2:${userId}:session:${String(row.date??'').trim()}:${String(row.label??'').trim()}`;
  if(kind==='workout')return `v2:${userId}:workout:${String(row.date??'').trim()}:${exerciseId(row.exerciseId||row.exercise)}`;
  if(kind==='readiness')return `signals-v2:${userId}:readiness:${row.date}`;
  if(kind==='football')return `signals-v2:${userId}:football:${JSON.stringify([row.date,row.type])}`;
  if(kind==='match')return `signals-v2:${userId}:matches:${row.date}`;
  return null;
};
const doneV2=sets=>(sets??[]).filter(set=>set.done);
const v2Volume=workouts=>workouts.reduce((total,row)=>total+doneV2(row.sets).reduce((sum,set)=>sum+number(set.kg)*number(set.reps),0),0);
const v2ExerciseMetric=(row,index,userId)=>({
  id:namespaced('v2','exercise',`${exerciseId(row.exerciseId||row.exercise)}:${index}`),identity:namespaced('v2','exercise',exerciseId(row.exerciseId||row.exercise)),source:'v2',name:row.exercise||row.exerciseId||'Ejercicio',date:row.date,
  maxLoad:Math.max(0,...doneV2(row.sets).map(set=>number(set.kg))),volume:doneV2(row.sets).reduce((sum,set)=>sum+number(set.kg)*number(set.reps),0),sourceKey:legacySourceKey(userId,'workout',row)
});

async function readV3(repository){
  const [sessions,readiness,football,matches,mappings]=await Promise.all([
    repository.listSessions(),repository.listRecords('daily_readiness'),repository.listRecords('football_sessions'),repository.listRecords('match_reviews'),repository.listMigrationMappings()
  ]);
  const snapshots=await Promise.all(sessions.map(async session=>{
    const exercises=await repository.listChildren('session_exercises',session.id);
    for(const exercise of exercises)exercise.sets=await repository.listChildren('exercise_sets',exercise.id);
    return {session,exercises};
  }));
  return {snapshots,readiness,football,matches,mappings};
}

const mappedSources=(mappings,targetIds)=>new Set(mappings.filter(row=>row.migration_status==='migrated'&&targetIds.has(row.target_id)).map(row=>row.source_key));
const completedV3=snapshot=>snapshot.session.status==='completed'&&!snapshot.session.deleted_at;

export class UnifiedProgress{
  constructor({v2Reader,repository,userId=repository?.userId}={}){this.v2Reader=v2Reader;this.repository=repository;this.userId=userId;}
  async load(){
    const [v2Result,v3Result]=await Promise.allSettled([
      this.v2Reader?.read?.()??Promise.reject(new Error('Histórico no disponible.')),
      this.repository?readV3(this.repository):Promise.reject(new Error('Datos actuales no disponibles.'))
    ]);
    if(v2Result.status==='rejected'&&v3Result.status==='rejected')return {status:{v2:'error',v3:'error'},warnings:['No se pudo cargar el progreso.'],sessions:[],readiness:[],football:[],matches:[],exercises:[],metrics:{completedSessions:0,volume:0,footballLoad7:0,averageReadiness:null}};
    const v2=v2Result.status==='fulfilled'?v2Result.value:{workouts:[],sessions:[],readiness:[],football:[],matches:[]};
    const v3=v3Result.status==='fulfilled'?v3Result.value:{snapshots:[],readiness:[],football:[],matches:[],mappings:[]};
    const targetIds=new Set([
      ...v3.snapshots.flatMap(item=>[item.session.id,...item.exercises.flatMap(ex=>[ex.id,...ex.sets.map(set=>set.id)])]),...v3.readiness.map(row=>row.id),...v3.football.map(row=>row.id),...v3.matches.map(row=>row.id)
    ]),linked=mappedSources(v3.mappings,targetIds),keep=(kind,row)=>!linked.has(legacySourceKey(this.userId,kind,row));
    const legacySessions=v2.sessions.filter(row=>keep('session',row)).map((row,index)=>({id:namespaced('v2','session',legacyId('session',row,index)),source:'v2',date:row.date,title:row.label||'Entrenamiento',status:row.endedAt&&number(row.duration)>0?'completed':'historical',durationMinutes:number(row.duration),rpe:row.rpe??null,volume:null,sourceKey:legacySourceKey(this.userId,'session',row)}));
    const currentSessions=v3.snapshots.filter(completedV3).map(item=>{const metrics=sessionMetrics(item);return {id:namespaced('v3','session',item.session.id),source:'v3',date:item.session.session_date,title:item.session.label,status:'completed',durationMinutes:Math.round(metrics.durationSeconds/60),rpe:item.session.rpe??null,volume:metrics.volume};});
    const legacyExercises=v2.workouts.filter(row=>keep('workout',row)).map((row,index)=>v2ExerciseMetric(row,index,this.userId));
    const currentExercises=v3.snapshots.filter(completedV3).flatMap(item=>Object.values(sessionMetrics(item).perExercise).map(metric=>({id:namespaced('v3','exercise-occurrence',`${item.session.id}:${metric.catalogId}`),identity:namespaced('v3','exercise',metric.catalogId),source:'v3',name:metric.name,date:item.session.session_date,maxLoad:metric.maxLoad??0,volume:metric.volume})));
    const readinessFields=row=>({sleep:finite(row.sleep)?number(row.sleep):null,energy:finite(row.energy)?number(row.energy):null,freshness:finite(row.freshness)?number(row.freshness):finite(row.fatigue)?6-number(row.fatigue):null,pain:finite(row.pain)?number(row.pain):null});
    const legacyReadiness=v2.readiness.filter(row=>keep('readiness',row)).map((row,index)=>({id:namespaced('v2','readiness',legacyId('readiness',row,index)),source:'v2',date:row.date,value:score(row),...readinessFields(row)}));
    const currentReadiness=v3.readiness.map(row=>({id:namespaced('v3','readiness',row.id),source:'v3',date:row.local_date,value:score(row),...readinessFields(row)}));
    const legacyFootball=v2.football.filter(row=>keep('football',row)).map((row,index)=>({id:namespaced('v2','football',legacyId('football',row,index)),source:'v2',date:row.date,title:row.type||'Fútbol',durationMinutes:number(row.duration),rpe:row.rpe??null,load:number(row.duration)*number(row.rpe)}));
    const currentFootball=v3.football.map(row=>({id:namespaced('v3','football',row.id),source:'v3',date:row.local_date,title:row.session_type==='match'?'Partido':row.session_type==='friendly'?'Amistoso':'Entrenamiento de fútbol',durationMinutes:number(row.duration_minutes),rpe:row.rpe??null,load:number(row.calculated_load??number(row.duration_minutes)*number(row.rpe))}));
    const legacyMatches=v2.matches.filter(row=>keep('match',row)).map((row,index)=>({id:namespaced('v2','match',legacyId('match',row,index)),source:'v2',date:row.date,legs:row.legs??null,performance:row.performance??null}));
    const currentMatches=v3.matches.map(row=>({id:namespaced('v3','match',row.id),source:'v3',date:row.local_date,legs:row.legs??null,performance:row.performance??null}));
    const readiness=[...legacyReadiness,...currentReadiness].sort((a,b)=>a.date.localeCompare(b.date)),football=[...legacyFootball,...currentFootball],matches=[...legacyMatches,...currentMatches],sessions=[...legacySessions,...currentSessions],exercises=[...legacyExercises,...currentExercises];
    const since=new Date();since.setDate(since.getDate()-6);const sinceKey=`${since.getFullYear()}-${String(since.getMonth()+1).padStart(2,'0')}-${String(since.getDate()).padStart(2,'0')}`,scores=readiness.map(row=>row.value).filter(value=>value!=null);
    return {status:{v2:v2Result.status==='fulfilled'?'ok':'error',v3:v3Result.status==='fulfilled'?'ok':'error'},warnings:[v2Result.status==='rejected'?'No se pudo cargar el histórico.':null,v3Result.status==='rejected'?'No se pudieron cargar los datos actuales.':null].filter(Boolean),sessions,readiness,football,matches,exercises,metrics:{completedSessions:sessions.filter(row=>row.status==='completed').length,volume:v2Volume(v2.workouts.filter(row=>keep('workout',row)))+currentSessions.reduce((sum,row)=>sum+row.volume,0),footballLoad7:football.filter(row=>row.date>=sinceKey).reduce((sum,row)=>sum+row.load,0),averageReadiness:scores.length?Math.round(scores.reduce((sum,value)=>sum+value,0)/scores.length):null}};
  }
}
