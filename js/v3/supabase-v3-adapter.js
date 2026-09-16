import {remotePayloadForOperation} from './sync-protocol.js';

const SCHEMA='nico_fit_v3';

function asError(error,status){
  const value=error instanceof Error?error:new Error(error?.message||'Supabase V3 request failed.');
  Object.assign(value,error||{});if(status&&!value.status)value.status=status;return value;
}

function expect(result){
  if(result.error)throw asError(result.error,result.status);
  return result.data;
}

export class SupabaseV3Adapter{
  constructor({client,pageSize=100,schema=SCHEMA}={}){
    if(!client)throw new Error('A Supabase client is required.');
    this.client=client;this.pageSize=pageSize;this.schema=schema;
  }

  async authenticatedUserId(){
    const {data,error}=await this.client.auth.getUser();
    if(error){
      if(error.name==='AuthSessionMissingError'||[400,401,403].includes(Number(error.status)))throw asError({message:'Supabase session is expired.',code:'PGRST301'},401);
      throw asError(error,Number(error.status)>=500?Number(error.status):503);
    }
    if(!data?.user?.id)throw asError({message:'Supabase session is expired.',code:'PGRST301'},401);
    return data.user.id;
  }

  async fetchChanges(entity,{cursor,pageSize=this.pageSize}={}){
    let query=this.client.schema(this.schema).from(entity).select('*').order('updated_at',{ascending:true}).order('id',{ascending:true}).limit(pageSize);
    if(cursor?.updatedAt&&cursor?.id){
      query=query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`);
    }
    const data=expect(await query);
    return data||[];
  }

  async fetchById(entity,id){
    const data=expect(await this.client.schema(this.schema).from(entity).select('*').eq('id',id).maybeSingle());
    return data||null;
  }

  async mutate(operation,userId){
    const table=this.client.schema(this.schema).from(operation.entity),payload=remotePayloadForOperation(operation,userId);
    let result;
    if(operation.type==='insert')result=await table.insert(payload).select('*').single();
    else result=await table.update(payload).eq('id',operation.record_id).select('*').maybeSingle();
    if(result.error){if(operation.entity==='routine_versions'&&result.error.code==='23505')throw asError({...result.error,code:'PT409',reason:'routine_version_number_collision',message:'Routine version number already exists; explicit review required.'},409);throw asError(result.error,result.status);}
    if(!result.data)throw asError({message:'Remote row was not visible after mutation.',code:'REMOTE_ROW_MISSING'},404);
    return result.data;
  }
}

