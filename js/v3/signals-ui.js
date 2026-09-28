import {V3SignalsRepository} from './signals-repository.js';

// Product-facing adapter for the existing forms. It only writes through the
// user-scoped V3 repository; remote confirmation remains the sync engine's job.
export class V3SignalsUI{
  constructor({repository,syncNow=async()=>({skipped:'disabled'})}={}){
    if(!repository?.userId)throw new Error('Iniciá sesión para guardar el check-in.');
    this.repository=repository;this.signals=new V3SignalsRepository({repository,featureEnabled:true});this.syncNow=syncNow;
  }
  readiness(date){return this.signals.list('daily_readiness',{date}).then(rows=>rows[0]??null);}
  list(entity,options){return this.signals.list(entity,options);}
  saveReadiness(input,options){return this.#save('daily_readiness',input,options);}
  saveFootball(input,options){return this.#save('football_sessions',input,options);}
  saveMatchReview(input,options){return this.#save('match_reviews',input,options);}
  async #save(entity,input,options){const record=await this.signals.save(entity,input,options);let syncResult=null;try{syncResult=await this.syncNow(this.repository);}catch{}return {record,syncResult};}
}
