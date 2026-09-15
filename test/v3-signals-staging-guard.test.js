import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('staging runner refuses production, mismatched URLs and secret/service keys before login',()=>{
  const ref='tmydirzzlmlmtjgwqcgh',defaults={SUPABASE_STAGING_PROJECT_REF:ref,SUPABASE_STAGING_URL:`https://${ref}.supabase.co`,SUPABASE_STAGING_PUBLISHABLE_KEY:'sb_publishable_fixture'};
  const jwt=`a.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.b`;
  for(const [override,message] of [
    [{SUPABASE_STAGING_PROJECT_REF:'xaklsoqyzwowtjwcpwmb'},'Only nico-fit-v3-staging'],
    [{SUPABASE_STAGING_URL:'https://xaklsoqyzwowtjwcpwmb.supabase.co'},'Exact staging URL'],
    [{SUPABASE_STAGING_PUBLISHABLE_KEY:'sb_secret_fixture'},'Publishable key required'],
    [{SUPABASE_STAGING_PUBLISHABLE_KEY:jwt},'Service role forbidden']
  ]){
    const result=spawnSync(process.execPath,['scripts/v3-signals-staging.mjs'],{env:{...process.env,...defaults,...override},encoding:'utf8',timeout:5000});
    assert.equal(result.status,1);assert.ok(result.stderr.includes(message));assert.ok(!result.stdout.includes('PASS'));
  }
});
