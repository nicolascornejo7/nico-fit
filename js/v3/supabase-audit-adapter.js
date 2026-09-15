const columns='event_id,user_id,event_type,entity,entity_id,strategy,local_revision,local_remote_version,remote_version,occurred_at,error_kind,error_code,received_at';
export function assertStagingV3Client(client){
  if(client?.supabaseUrl!=='https://tmydirzzlmlmtjgwqcgh.supabase.co')throw new Error('Only nico-fit-v3-staging is allowed.');
  const key=client.supabaseKey;if(!key||key.startsWith('sb_secret_'))throw new Error('Publishable key required.');
  if(key.split('.').length===3){const payload=JSON.parse(globalThis.atob(key.split('.')[1].replaceAll('-','+').replaceAll('_','/')));if(payload.role!=='anon')throw new Error('Service role forbidden.');}
}
const expect=result=>{if(result.error)throw Object.assign(new Error('Audit request rejected.'),result.error,{status:result.status});return result.data;};
export class SupabaseAuditAdapter{
  constructor({client}){assertStagingV3Client(client);this.client=client;}
  table(){return this.client.schema('nico_fit_v3').from('operational_audit');}
  async authenticatedUserId(){const {data,error}=await this.client.auth.getUser();if(error||!data?.user?.id)throw Object.assign(new Error('Audit session expired.'),{status:401,code:'PGRST301'});return data.user.id;}
  async append(event){
    const result=await this.table().insert(event).select(columns).single();if(!result.error)return expect(result);
    if(result.error.code!=='23505')return expect(result);
    const existing=expect(await this.table().select(columns).eq('event_id',event.event_id).single());
    if(!Object.entries(event).every(([key,value])=>key==='occurred_at'?Date.parse(existing[key])===Date.parse(value):existing[key]===value))throw new Error('Audit event ID has incompatible metadata.');return existing;
  }
  async list({cursor=null,pageSize=100}={}){let query=this.table().select(columns).order('received_at').order('event_id').limit(pageSize);if(cursor)query=query.or(`received_at.gt.${cursor.receivedAt},and(received_at.eq.${cursor.receivedAt},event_id.gt.${cursor.eventId})`);return expect(await query);}
}
