// Internal explicit injection; this module never creates a remote client or enables flags.
import {assertAuthorizedV3Client} from './authorized-projects.js';
const runtimes=new Map();
export function configureV3Observability({userId,engine,audit=null}){
  if(engine?.repository.userId!==userId)throw new Error('Observability engine ownership mismatch.');
  assertAuthorizedV3Client(engine.remote.client);
  if(audit&&audit.repository.userId!==userId)throw new Error('Audit ownership mismatch.');
  const runtime={engine,audit,online:engine.online,now:engine.now};runtimes.set(userId,runtime);return ()=>{if(runtimes.get(userId)===runtime)runtimes.delete(userId);};
}
export function v3ObservabilityRuntime(userId){return runtimes.get(userId)||{engine:null,audit:null};}
