import {coachContextFor} from './coach-context.js';
import {localDateKey} from '../plan.js';
import {isV3CoachEnabled} from './feature-flags.js';
import {calculateCoachSignals} from './coach-signals.js';
import {applyCoachRules} from './coach-rules.js';

// Only the explicitly owned V2 profile supplies readiness/football; no writes.
export class V3CoachService{
  constructor({engine,readContext,flagStorage=globalThis.localStorage,featureEnabled,now=()=>new Date()}={}){
    if(!(featureEnabled??isV3CoachEnabled(flagStorage)))throw new Error('V3 coach is disabled.');
    if(!engine?.repository?.userId||engine.repository.userId==='guest')throw new Error('Coach requires an isolated authenticated repository.');
    this.engine=engine;this.readContext=readContext;this.now=now;
  }
  async today(snapshot){const context=await (this.readContext?this.readContext(this.engine.repository.userId):coachContextFor(this.engine.repository));const signals=calculateCoachSignals({date:localDateKey(this.now()),readiness:context.readiness,football:context.football,matches:context.matches,history:await this.engine.history()});signals.warnings.push(...(context.warnings??[]));if(context.hasConflicts){signals.readinessScore=null;}return {recommendation:applyCoachRules(signals,snapshot),signals};}
}
