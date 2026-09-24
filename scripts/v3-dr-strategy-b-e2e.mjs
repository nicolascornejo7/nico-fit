import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';

const PROTECTED=new Set(['tmydirzzlmlmtjgwqcgh','xaklsoqyzwowtjwcpwmb']);
const url=process.env.SUPABASE_DR_URL||process.env.SUPABASE_URL;
const publishableKey=process.env.SUPABASE_DR_PUBLISHABLE_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey=process.env.SUPABASE_DR_SECRET_KEY||process.env.SUPABASE_SECRET_KEY;
const databaseUrl=process.env.SUPABASE_DR_DB_URL;
if(!url||!publishableKey||!secretKey||!databaseUrl)throw new Error('DR environment is incomplete.');
const projectRef=new URL(url).hostname.split('.')[0];
if(PROTECTED.has(projectRef)||!databaseUrl.includes(projectRef))throw new Error('Protected or mismatched DR target.');

const sqlFiles=[
  'supabase/schema.sql',
  'supabase/migration-v3-schema.sql',
  'supabase/migration-v3-signals.sql',
  'supabase/migration-v3-observability.sql',
  'supabase/migration-v3-audit-retention.sql',
  'supabase/migration-v3-routines.sql',
  'supabase/migration-v3-free-workouts.sql',
  'supabase/staging-v3-api-grants.sql',
  'supabase/staging-v3-signals-api-grants.sql',
  'supabase/staging-v3-routines-api-grants.sql'
];
const db=new pg.Client({connectionString:databaseUrl,ssl:{rejectUnauthorized:false}});
const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const publicClient=()=>createClient(url,publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const password=()=>`Dr-${randomBytes(24).toString('base64url')}!7a`;
const suffix=`${Date.now()}-${randomBytes(4).toString('hex')}`;
const ownerEmail=`nico-fit-dr-owner-${suffix}@example.invalid`,otherEmail=`nico-fit-dr-other-${suffix}@example.invalid`;
const ownerPassword=password(),otherPassword=password(),oldUserId=randomUUID();
const ids={catalog:randomUUID(),session:randomUUID(),readiness:randomUUID(),football:randomUUID(),routine:randomUUID(),audit:randomUUID()};
const result={projectRef,checks:{},counts:{}};

const createUser=async(email,passwordValue)=>{
  const response=await admin.auth.admin.createUser({email,password:passwordValue,email_confirm:true});
  if(response.error)throw response.error;
  return response.data.user;
};
const login=async(email,passwordValue)=>{
  const client=publicClient(),response=await client.auth.signInWithPassword({email,password:passwordValue});
  if(response.error)throw response.error;
  assert.match(response.data.session.access_token,/^[^.]+\.[^.]+\.[^.]+$/);
  return {client,user:response.data.user,jwtPresent:true};
};
const rows=async(client,table)=>{
  const response=await client.schema('nico_fit_v3').from(table).select('*');
  if(response.error)throw response.error;
  return response.data;
};

try{
  await db.connect();
  result.checks.postgres=true;
  for(let pass=0;pass<2;pass++)for(const file of sqlFiles)await db.query(await readFile(new URL(`../${file}`,import.meta.url),'utf8'));
  result.checks.migrationsIdempotent=true;
  await db.query("alter role authenticator set pgrst.db_schemas='public, storage, graphql_public, nico_fit_v3'");
  await db.query("notify pgrst,'reload config'");
  await db.query("notify pgrst,'reload schema'");

  const owner=await createUser(ownerEmail,ownerPassword),other=await createUser(otherEmail,otherPassword);
  result.checks.authUsersCreated=owner.id!==other.id;

  await db.query('begin');
  try{
    await db.query('create temporary table dr_restored_owner(source_user_id uuid primary key) on commit drop');
    await db.query('insert into dr_restored_owner values ($1)',[oldUserId]);
    await db.query("insert into nico_fit_v3.exercise_catalog(id,owner_user_id,stable_key,canonical_name,measurement_kind) select $1,$2,'dr-squat','DR Squat','reps' from dr_restored_owner where source_user_id=$3",[ids.catalog,owner.id,oldUserId]);
    await db.query("insert into nico_fit_v3.workout_sessions(id,user_id,session_date,label,session_type,status,started_at) select $1,$2,current_date,'DR restored session','free_workout','draft',clock_timestamp() from dr_restored_owner where source_user_id=$3",[ids.session,owner.id,oldUserId]);
    await db.query('insert into nico_fit_v3.daily_readiness(id,user_id,local_date,sleep,energy,freshness,pain) select $1,$2,current_date,4,4,4,0 from dr_restored_owner where source_user_id=$3',[ids.readiness,owner.id,oldUserId]);
    await db.query("insert into nico_fit_v3.football_sessions(id,user_id,local_date,session_type,duration_minutes,rpe,minutes_played) select $1,$2,current_date,'training',60,5,60 from dr_restored_owner where source_user_id=$3",[ids.football,owner.id,oldUserId]);
    await db.query("insert into nico_fit_v3.routine_templates(id,user_id,stable_key,name,is_active) select $1,$2,'dr-routine','DR Routine',true from dr_restored_owner where source_user_id=$3",[ids.routine,owner.id,oldUserId]);
    await db.query("insert into nico_fit_v3.operational_audit(event_id,user_id,event_type,entity,entity_id,strategy,local_revision,local_remote_version,remote_version,occurred_at) select $1,$2,'conflict_resolution','workout_sessions',$3,'accept_remote',1,1,1,clock_timestamp() from dr_restored_owner where source_user_id=$4",[ids.audit,owner.id,ids.session,oldUserId]);
    await db.query('commit');
  }catch(error){await db.query('rollback');throw error;}
  result.checks.atomicRemap=true;

  const ownershipTables=[['exercise_catalog','owner_user_id'],['workout_sessions','user_id'],['daily_readiness','user_id'],['football_sessions','user_id'],['routine_templates','user_id'],['operational_audit','user_id']];
  for(const [table,column] of ownershipTables){
    const primaryColumn=table==='operational_audit'?'event_id':'id',recordId=table==='operational_audit'?ids.audit:ids[table==='exercise_catalog'?'catalog':table==='workout_sessions'?'session':table==='daily_readiness'?'readiness':table==='football_sessions'?'football':'routine'];
    const check=await db.query(`select count(*)::int total,count(*) filter(where ${column}=$1)::int owned,count(*) filter(where ${column}=$2)::int stale from nico_fit_v3.${table} where ${primaryColumn}=$3`,[owner.id,oldUserId,recordId]);
    assert.equal(check.rows[0].total,1);assert.equal(check.rows[0].owned,1);assert.equal(check.rows[0].stale,0);
  }
  result.checks.noStaleOwnership=true;
  const fk=await db.query("select count(*)::int invalid from pg_constraint k join pg_namespace n on n.oid=k.connamespace where k.contype='f' and n.nspname in ('public','nico_fit_v3') and not k.convalidated");
  assert.equal(fk.rows[0].invalid,0);result.checks.foreignKeysValid=true;

  // Give PostgREST time to observe the explicit schema reload.
  await new Promise(resolve=>setTimeout(resolve,1500));
  const ownerLogin=await login(ownerEmail,ownerPassword),otherLogin=await login(otherEmail,otherPassword);
  result.checks.realLogin=true;result.checks.realJwt=ownerLogin.jwtPresent&&otherLogin.jwtPresent;
  for(const table of ['exercise_catalog','workout_sessions','daily_readiness','football_sessions','routine_templates','operational_audit']){
    const ownerRows=await rows(ownerLogin.client,table),otherRows=await rows(otherLogin.client,table);
    assert.ok(ownerRows.some(row=>(row.id||row.event_id)===(table==='operational_audit'?ids.audit:ids[table==='exercise_catalog'?'catalog':table==='workout_sessions'?'session':table==='daily_readiness'?'readiness':table==='football_sessions'?'football':'routine'])));
    assert.equal(otherRows.some(row=>(row.id||row.event_id)===(table==='operational_audit'?ids.audit:ids[table==='exercise_catalog'?'catalog':table==='workout_sessions'?'session':table==='daily_readiness'?'readiness':table==='football_sessions'?'football':'routine'])),false);
    result.counts[table]={owner:ownerRows.length,other:otherRows.length};
  }
  result.checks.ownerRls=true;result.checks.crossUserDenied=true;result.checks.operationalAudit=true;
  console.log(JSON.stringify({...result,status:'PASS'}));
}finally{
  await db.end().catch(()=>{});
}
