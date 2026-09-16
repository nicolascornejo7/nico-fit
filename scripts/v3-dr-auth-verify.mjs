import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import process from 'node:process';
import {createClient} from '@supabase/supabase-js';

const PROD='xaklsoqyzwowtjwcpwmb',STAGING='tmydirzzlmlmtjgwqcgh';
const env=process.env,mode=process.argv.includes('--preserved-hash')?'preserved-hash':process.argv.includes('--recovery-link')?'recovery-link':null;
if(!mode)throw new Error('Choose --preserved-hash or --recovery-link.');
if([PROD,STAGING].includes(env.SUPABASE_DR_PROJECT_REF))throw new Error('Protected Supabase project ref.');
if(!env.SUPABASE_DR_PROJECT_REF||!env.SUPABASE_DR_URL||!env.SUPABASE_DR_URL.includes(env.SUPABASE_DR_PROJECT_REF))throw new Error('Exact disposable project ref/URL required.');
if(env.SUPABASE_DR_URL.includes(PROD)||env.SUPABASE_DR_URL.includes(STAGING))throw new Error('Protected Supabase URL.');
if(!env.SUPABASE_DR_PUBLISHABLE_KEY||!env.SUPABASE_DR_TEST_EMAIL)throw new Error('Disposable publishable key and test email required.');
if(env.NICO_FIT_DR_EXECUTION_APPROVAL!=='approved-disposable-auth-test')throw new Error('Disposable Auth test approval marker missing.');
const auth=createClient(env.SUPABASE_DR_URL,env.SUPABASE_DR_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
let password,user;
if(mode==='preserved-hash'){
  password=env.SUPABASE_DR_TEST_PASSWORD;
  if(!password||!env.SUPABASE_DR_EXPECTED_USER_ID)throw new Error('Original test password and expected preserved UUID required.');
}else{
  if(!env.SUPABASE_DR_SERVICE_ROLE_KEY?.startsWith('sb_secret_')&&!env.SUPABASE_DR_SERVICE_ROLE_KEY?.startsWith('ey'))throw new Error('Server-side disposable service role key required.');
  if(!env.SUPABASE_DR_NEW_PASSWORD)throw new Error('New test password required.');
  const admin=createClient(env.SUPABASE_DR_URL,env.SUPABASE_DR_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const temporary=randomBytes(24).toString('base64url');
  const created=await admin.auth.admin.createUser({email:env.SUPABASE_DR_TEST_EMAIL,password:temporary,email_confirm:true});
  if(created.error&&!/already/i.test(created.error.message))throw created.error;
  const link=await admin.auth.admin.generateLink({type:'recovery',email:env.SUPABASE_DR_TEST_EMAIL});
  if(link.error)throw link.error;
  const tokenHash=link.data?.properties?.hashed_token;
  assert.ok(tokenHash,'Recovery token hash missing.');
  const verified=await auth.auth.verifyOtp({type:'recovery',token_hash:tokenHash});
  if(verified.error)throw verified.error;
  const updated=await auth.auth.updateUser({password:env.SUPABASE_DR_NEW_PASSWORD});
  if(updated.error)throw updated.error;
  await auth.auth.signOut();
  password=env.SUPABASE_DR_NEW_PASSWORD;
}
const signed=await auth.auth.signInWithPassword({email:env.SUPABASE_DR_TEST_EMAIL,password});
if(signed.error)throw signed.error;
user=signed.data.user;
if(mode==='preserved-hash')assert.equal(user.id,env.SUPABASE_DR_EXPECTED_USER_ID,'Restored Auth UUID changed.');
const expected=JSON.parse(env.SUPABASE_DR_EXPECTED_COUNTS||'{}'),ownership={};
for(const [table,count] of Object.entries(expected)){
  const result=await auth.from(table).select('id',{count:'exact',head:true});
  if(result.error)throw result.error;
  ownership[table]={expected:Number(count),visible:result.count,match:Number(count)===result.count};
}
assert.ok(Object.values(ownership).every(x=>x.match),'Recovered identity does not own the expected rows.');
console.log(JSON.stringify({status:'PASS',mode,user_id:user.id,ownership},null,2));
