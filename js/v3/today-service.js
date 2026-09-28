import {localDateKey} from '../plan.js';
import {V3SignalsRepository} from './signals-repository.js';
import {V3TrainingEngine} from './training-engine.js';
import {V3CoachService} from './coach-service.js';

const readinessScore=row=>row?Math.max(0,Math.min(100,Math.round(((row.sleep+row.energy+row.freshness)/15)*100-Math.max(0,row.pain-2)*3))):null;

export class V3TodayService{
  constructor({repository,now=()=>new Date(),engine}={}){
    if(!repository?.userId)throw new Error('Se requiere un repositorio V3 autenticado.');
    this.repository=repository;this.now=now;this.engine=engine??new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now});this.signals=new V3SignalsRepository({repository,featureEnabled:true});
  }
  async summary(){
    const now=this.now(),date=localDateKey(now),dayIndex=now.getDay(),[readinessRows,football,matches]=await Promise.all(['daily_readiness','football_sessions','match_reviews'].map(entity=>this.signals.list(entity,{date}))),readiness=readinessRows[0]??null;
    const state=await this.repository.getTrainingState(),active=state?.activeSessionId?await this.engine.snapshot(state.activeSessionId):null;
    const usableActive=active?.session?.status==='draft'&&!active.session.deleted_at?active:null;
    let recommendation=null;
    try{recommendation=await new V3CoachService({engine:this.engine,featureEnabled:true,now:this.now}).today(usableActive);}catch{}
    return {date,dayIndex,readiness,football,matches,readinessScore:readinessScore(readiness),recommendation,hasRoutine:[2,4,5].includes(dayIndex),activeSession:usableActive};
  }
  async recover(){return this.engine.recover();}
  async startToday(){const active=await this.engine.recover();if(active)return active;const now=this.now(),dayIndex=now.getDay();if(![2,4,5].includes(dayIndex))return null;return this.engine.createSession({date:localDateKey(now),dayIndex,useRoutine:true});}
  async startFree(){const active=await this.engine.recover();return active??this.engine.createFreeWorkout({date:localDateKey(this.now())});}
}

export {readinessScore as v3ReadinessScore};
