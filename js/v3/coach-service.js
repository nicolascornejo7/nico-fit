import {coachContextFor} from './coach-context.js';
import {localDateKey} from '../plan.js';
import {isV3CoachEnabled} from './feature-flags.js';
import {calculateCoachSignals} from './coach-signals.js';
import {applyCoachRules} from './coach-rules.js';
import {tuesdayDecision} from './tuesday-adaptation.js';
import {latestRoutineVersion} from './weekly-program-v64.js';
import {weekModeFor} from './week-mode.js';

// Only the explicitly owned V2 profile supplies readiness/football; no writes.
export class V3CoachService{
  constructor({engine,readContext,flagStorage=globalThis.localStorage,featureEnabled,now=()=>new Date()}={}){
    if(!(featureEnabled??isV3CoachEnabled(flagStorage)))throw new Error('V3 coach is disabled.');
    if(!engine?.repository?.userId||engine.repository.userId==='guest')throw new Error('Coach requires an isolated authenticated repository.');
    this.engine=engine;this.readContext=readContext;this.now=now;
  }
  async today(snapshot){const context=await (this.readContext?this.readContext(this.engine.repository.userId):coachContextFor(this.engine.repository));const date=localDateKey(this.now()),signals=calculateCoachSignals({date,readiness:context.readiness,football:context.football,matches:context.matches,history:await this.engine.history(),weekMode:weekModeFor(this.engine.repository.userId,date)});signals.warnings.push(...(context.warnings??[]));if(context.hasConflicts){signals.readinessScore=null;}return {recommendation:applyCoachRules(signals,snapshot),signals};}
  // `base` is the Tuesday routine snapshot that will be trained (published or
  // owner-edited); edited versions get a plan derived from exercise profiles.
  async tuesdayPlan({override=false,now=this.now(),base=null,routineVersion=base?.routine_version??latestRoutineVersion(2)}={}){
    let baseExercises=null;
    if(base?.exercises){const catalog=await this.engine.repository.listRecords('exercise_catalog',{includeDeleted:true});baseExercises=base.exercises.map(row=>{const item=catalog.find(entry=>entry.id===row.exercise_catalog_id);return {stableKey:item?.stable_key??row.exercise_catalog_id,sets:row.prescription_snapshot?.sets??0,catalog:item};});}
    const context=await (this.readContext?this.readContext(this.engine.repository.userId):coachContextFor(this.engine.repository));
    return tuesdayDecision({history:await this.engine.history(),readiness:context.readiness,football:context.football??[],now,override,signalsConflicted:context.hasConflicts,routineVersion,baseExercises});
  }
}
