import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';

const PROTECTED=new Set(['tmydirzzlmlmtjgwqcgh','xaklsoqyzwowtjwcpwmb']);
const EXPECTED_DR_REF='bfjcmnfnhcahoejprquf';
const url=process.env.SUPABASE_DR_URL||process.env.SUPABASE_URL;
const publishableKey=process.env.SUPABASE_DR_PUBLISHABLE_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey=process.env.SUPABASE_DR_SECRET_KEY;
const databaseUrl=process.env.SUPABASE_DR_DB_URL;
if(!url||!publishableKey||!secretKey||!databaseUrl)throw new Error('SUPABASE_DR_* environment is incomplete.');
const projectRef=new URL(url).hostname.split('.')[0];
if(projectRef!==EXPECTED_DR_REF||PROTECTED.has(projectRef)||!databaseUrl.includes(projectRef))throw new Error('Target is not the approved disposable DR project; validation aborted.');

const db=new pg.Client({connectionString:databaseUrl,ssl:{rejectUnauthorized:false}});
const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const publicClient=()=>createClient(url,publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const password=()=>`Grant-${randomBytes(24).toString('base64url')}!8b`;
const suffix=`${Date.now()}-${randomBytes(4).toString('hex')}`;
const ids={readiness:randomUUID(),routine:randomUUID()};
let owner,other;

const createUser=async(prefix)=>{
  const email=`nico-fit-grants-${prefix}-${suffix}@example.invalid`,pass=password();
  const created=await admin.auth.admin.createUser({email,password:pass,email_confirm:true});
  if(created.error)throw created.error;
  const client=publicClient(),login=await client.auth.signInWithPassword({email,password:pass});
  if(login.error)throw login.error;
  return {id:created.data.user.id,client};
};

const expected={
  exercise_catalog:['SELECT','INSERT','UPDATE'],workout_sessions:['SELECT','INSERT','UPDATE'],
  session_exercises:['SELECT','INSERT','UPDATE'],exercise_sets:['SELECT','INSERT','UPDATE'],
  daily_readiness:['SELECT','INSERT','UPDATE'],football_sessions:['SELECT','INSERT','UPDATE'],match_reviews:['SELECT','INSERT','UPDATE'],
  routine_templates:['SELECT','INSERT','UPDATE'],routine_versions:['SELECT','INSERT','UPDATE'],routine_exercises:['SELECT','INSERT','UPDATE'],
  v2_workout_session_map:['SELECT'],v2_workout_map:['SELECT'],v2_set_map:['SELECT'],v2_exercise_name_map:['SELECT'],
  operational_audit:['SELECT','INSERT'],rollout_config:['SELECT'],rollout_config_history:[]
};

try{
  await db.connect();
  const grantsSql=await readFile(new URL('../sql/v3-production-api-grants.sql',import.meta.url),'utf8');
  const rolloutSql=await readFile(new URL('../supabase/migration-v3-rollout-control.sql',import.meta.url),'utf8');
  await db.query(rolloutSql);
  await db.query(rolloutSql);
  await db.query("select set_config('nico_fit.allow_v3_cutover','approved',false)");
  await db.query(grantsSql);
  await db.query(grantsSql);

  const relations=Object.keys(expected);
  const grants=await db.query(`select table_name,privilege_type from information_schema.role_table_grants where table_schema='nico_fit_v3' and grantee='authenticated' and table_name=any($1::text[]) order by 1,2`,[relations]);
  for(const table of relations){
    const actual=grants.rows.filter(row=>row.table_name===table).map(row=>row.privilege_type).sort();
    assert.deepEqual(actual,[...expected[table]].sort(),`authenticated grants for ${table}`);
  }
  const anon=await db.query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='nico_fit_v3' and grantee='anon' order by 1,2");
  assert.deepEqual(anon.rows,[{table_name:'rollout_config',privilege_type:'SELECT'}]);

  const rls=await db.query(`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='nico_fit_v3' and c.relname=any($1::text[])`,[relations]);
  assert.equal(rls.rows.length,relations.length);
  assert.ok(rls.rows.every(row=>row.relrowsecurity));
  const policies=await db.query("select tablename,policyname from pg_policies where schemaname='nico_fit_v3'");
  for(const [table,names] of Object.entries({
    daily_readiness:['signals_select','signals_insert','signals_update'],
    football_sessions:['signals_select','signals_insert','signals_update'],
    match_reviews:['signals_select','signals_insert','signals_update'],
    routine_templates:['routines_read_own','routines_insert_own','routines_update_own'],
    routine_versions:['routines_read_own','routines_insert_own','routines_update_own'],
    routine_exercises:['routines_read_own','routines_insert_own','routines_update_own']
  }))for(const name of names)assert.ok(policies.rows.some(row=>row.tablename===table&&row.policyname===name),`${table}.${name}`);

  await new Promise(resolve=>setTimeout(resolve,2000));
  owner=await createUser('owner');other=await createUser('other');
  const anonClient=publicClient();
  const publicConfig=await anonClient.schema('nico_fit_v3').from('rollout_config').select('config_version').limit(1);
  assert.equal(publicConfig.error,null);
  const anonSignal=await anonClient.schema('nico_fit_v3').from('daily_readiness').select('id').limit(1);
  assert.ok(anonSignal.error);

  const readiness={id:ids.readiness,user_id:owner.id,local_date:'2099-01-02',sleep:4,energy:4,freshness:4,pain:0};
  let response=await owner.client.schema('nico_fit_v3').from('daily_readiness').insert(readiness).select();
  assert.equal(response.error,null);assert.equal(response.data.length,1);
  response=await owner.client.schema('nico_fit_v3').from('daily_readiness').update({energy:5,version:2}).eq('id',ids.readiness).select();
  assert.equal(response.error,null);assert.equal(response.data.length,1);
  response=await other.client.schema('nico_fit_v3').from('daily_readiness').select('id').eq('id',ids.readiness);
  assert.equal(response.error,null);assert.equal(response.data.length,0);
  response=await other.client.schema('nico_fit_v3').from('daily_readiness').insert({...readiness,id:randomUUID(),user_id:owner.id});
  assert.ok(response.error);
  response=await owner.client.schema('nico_fit_v3').from('daily_readiness').delete().eq('id',ids.readiness);
  assert.ok(response.error);

  const routine={id:ids.routine,user_id:owner.id,stable_key:`grant-${suffix}`,name:'Grant validation routine',is_active:true};
  response=await owner.client.schema('nico_fit_v3').from('routine_templates').insert(routine).select();
  assert.equal(response.error,null);assert.equal(response.data.length,1);
  response=await owner.client.schema('nico_fit_v3').from('routine_templates').update({name:'Grant validation routine 2',version:2}).eq('id',ids.routine).select();
  assert.equal(response.error,null);assert.equal(response.data.length,1);
  response=await other.client.schema('nico_fit_v3').from('routine_templates').select('id').eq('id',ids.routine);
  assert.equal(response.error,null);assert.equal(response.data.length,0);

  console.log(JSON.stringify({status:'PASS',projectRef,checks:{appliedTwice:true,grants:true,anonRestricted:true,rls:true,policies:true,postgrest:true,ownerCrud:true,crossUserDenied:true,deleteDenied:true}}));
}finally{
  if(db._connected){
    await db.query('delete from nico_fit_v3.daily_readiness where id=$1',[ids.readiness]).catch(()=>{});
    await db.query('delete from nico_fit_v3.routine_templates where id=$1',[ids.routine]).catch(()=>{});
  }
  if(owner)await admin.auth.admin.deleteUser(owner.id).catch(()=>{});
  if(other)await admin.auth.admin.deleteUser(other.id).catch(()=>{});
  await db.end().catch(()=>{});
}
