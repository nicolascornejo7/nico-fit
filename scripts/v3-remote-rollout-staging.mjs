import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {fetchRolloutConfig} from '../js/v3/rollout-control.js';
import {resolveRollout} from '../js/v3/rollout-policy.js';

const ref='tmydirzzlmlmtjgwqcgh',url=`https://${ref}.supabase.co`,env=process.env;
assert.equal(env.SUPABASE_STAGING_PROJECT_REF,ref,'Sólo staging está permitido.');
assert.equal(env.SUPABASE_STAGING_URL,url,'La URL debe coincidir exactamente con staging.');
const key=env.SUPABASE_STAGING_PUBLISHABLE_KEY;
assert.ok(key&&!key.startsWith('sb_secret_'),'Se requiere una publishable key.');
if(key.split('.').length===3)assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role,'anon');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},anon=createClient(url,key,options),users=[createClient(url,key,options),createClient(url,key,options)];
const mode=process.argv[2]||'baseline';
const expectations={baseline:{v3_enabled:false,v3_sync_enabled:false,maintenance_mode:false,minimum_client_version:'nico-fit-v18'},enabled:{v3_enabled:true,v3_sync_enabled:true,maintenance_mode:false,minimum_client_version:'nico-fit-v18'},maintenance:{v3_enabled:true,v3_sync_enabled:true,maintenance_mode:true,minimum_client_version:'nico-fit-v18'},minimum:{v3_enabled:true,v3_sync_enabled:true,maintenance_mode:false,minimum_client_version:'nico-fit-v19'},kill:{v3_enabled:true,v3_sync_enabled:false,maintenance_mode:false,minimum_client_version:'nico-fit-v18'},restored:{v3_enabled:false,v3_sync_enabled:false,maintenance_mode:false,minimum_client_version:'nico-fit-v18'}};
assert.ok(expectations[mode],`Modo no reconocido: ${mode}`);
const ok=result=>{if(result.error)throw new Error(`${result.error.code}: ${result.error.message}`);return result.data;};
try{
  const remote=await fetchRolloutConfig({fetchImpl:(input,init)=>input==='/api/config'?Promise.resolve(new Response(JSON.stringify({url,publishableKey:key}),{status:200,headers:{'content-type':'application/json'}})):fetch(input,init),timeoutMs:15000});
  for(const [name,wanted] of Object.entries(expectations[mode]))assert.equal(remote[name],wanted,`${name} in ${mode}`);
  const anonymous=ok(await anon.schema('nico_fit_v3').from('rollout_config').select('*').eq('singleton_id',true).single());
  assert.equal(anonymous.config_version,remote.config_version);
  const identities=[];
  for(let index=0;index<users.length;index++){
    const suffix=index?'B':'A';const signed=ok(await users[index].auth.signInWithPassword({email:env[`SUPABASE_STAGING_USER_${suffix}_EMAIL`],password:env[`SUPABASE_STAGING_USER_${suffix}_PASSWORD`]}));identities.push(signed.user.id);
    const row=ok(await users[index].schema('nico_fit_v3').from('rollout_config').select('*').single());assert.equal(row.config_version,remote.config_version);
  }
  assert.notEqual(identities[0],identities[1]);
  for(const client of [anon,...users]){
    assert.equal((await client.schema('nico_fit_v3').from('rollout_config').update({v3_sync_enabled:true}).eq('singleton_id',true)).error?.code,'42501');
    assert.equal((await client.schema('nico_fit_v3').from('rollout_config').insert({singleton_id:true})).error?.code,'42501');
    assert.equal((await client.schema('nico_fit_v3').from('rollout_config').delete().eq('singleton_id',true)).error?.code,'42501');
    assert.equal((await client.schema('nico_fit_v3').from('rollout_config_history').select('config_version')).error?.code,'42501');
  }
  const client=resolveRollout(remote,{buildId:'nico-fit-v18',source:'remote'});
  assert.equal(client.remoteWritesAllowed,mode==='enabled');
  if(mode==='minimum')assert.equal(client.updateRequired,true);
  if(mode==='maintenance')assert.equal(client.maintenanceMode,true);
  if(mode==='kill')assert.equal(client.flags.v3_sync_enabled,false);
  console.log(JSON.stringify({project:'nico-fit-v3-staging',mode,configVersion:remote.config_version,anonRead:true,authenticatedUsers:2,clientWritesRejected:true,historyPrivate:true,remoteWritesAllowed:client.remoteWritesAllowed,updateRequired:client.updateRequired}));
}finally{await Promise.allSettled(users.map(client=>client.auth.signOut()));}
