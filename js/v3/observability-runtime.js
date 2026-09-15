// Internal explicit injection; this module never creates a remote client or enables flags.
import {assertStagingV3Client} from './supabase-audit-adapter.js';
const runtimes=new Map();
export function configureV3Observability({userId,engine,audit=null}){
  if(engine?.repository.userId!==userId||engine.remote?.client?.supabaseUrl!=='https://tmydirzzlmlmtjgwqcgh.supabase.co')throw new Error('Only an explicitly configured staging V3 engine is accepted.');
  assertStagingV3Client(engine.remote.client);
  if(audit&&audit.repository.userId!==userId)throw new Error('Audit ownership mismatch.');
  runtimes.set(userId,{engine,audit,online:engine.online,now:engine.now});return ()=>runtimes.delete(userId);
}
export function v3ObservabilityRuntime(userId){return runtimes.get(userId)||{engine:null,audit:null};}
