import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fetchRolloutConfig,V3RolloutControl} from '../js/v3/rollout-control.js';

const PUBLIC={url:'https://xaklsoqyzwowtjwcpwmb.supabase.co',publishableKey:'sb_publishable_fixture'};
const json=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
const ROW={singleton_id:true,config_version:3,minimum_client_version:'nico-fit-v18',maintenance_mode:false,v3_enabled:true,v3_storage_enabled:true,v3_signals_enabled:true,v3_routines_enabled:true,v3_training_enabled:true,v3_sync_enabled:true,v3_conflicts_enabled:true,v3_observability_enabled:true,v3_coach_enabled:true,updated_at:'2026-11-13T10:00:00Z'};

test('a PGRST106 response is classified as an unexposed schema',async()=>{
  const fetchImpl=async url=>String(url).endsWith('/api/config')?json(200,PUBLIC):json(406,{code:'PGRST106',message:'Invalid schema: nico_fit_v3',hint:'Only the following schemas are exposed: public, graphql_public'});
  await assert.rejects(fetchRolloutConfig({fetchImpl}),error=>error.code==='SCHEMA_NOT_EXPOSED'&&error.status===406);
  const other=async url=>String(url).endsWith('/api/config')?json(200,PUBLIC):json(503,null);
  await assert.rejects(fetchRolloutConfig({fetchImpl:other}),error=>error.code==='HTTP_503');
});

test('rollout control exposes the remote error while blocked and clears it when the server answers again',async()=>{
  let fail=true,time=Date.parse('2026-11-13T10:00:00Z');
  const control=new V3RolloutControl({buildId:'nico-fit-v72',storage:{getItem:()=>null,setItem(){},removeItem(){}},Channel:null,windowLike:null,now:()=>time,
    fetchConfig:async()=>{if(fail)throw Object.assign(new Error('blocked'),{code:'SCHEMA_NOT_EXPOSED'});return ROW;}});
  const blocked=await control.refresh({force:true});
  assert.equal(blocked.remoteError,'SCHEMA_NOT_EXPOSED');assert.notEqual(blocked.source,'remote');
  fail=false;time+=61000;
  const healthy=await control.refresh({force:true});
  assert.equal(healthy.source,'remote');assert.equal(healthy.remoteError,undefined);
});

test('the app explains how to fix an unexposed schema',async()=>{
  const app=await readFile(new URL('../js/app.js',import.meta.url),'utf8');
  assert.match(app,/Project Settings → Data API → Exposed schemas/);
  assert.match(app,/remoteError==='SCHEMA_NOT_EXPOSED'/);
});

test('v64 load steps are explicit and identical to the values version 2 was published with',async()=>{
  const {plan}=await import('../js/plan.js');
  const {WEEKLY_PROGRAM_V64,v64LoadStep}=await import('../js/v3/weekly-program-v64.js');
  for(const day of [2,4,5])for(const item of WEEKLY_PROGRAM_V64[day].exercises){
    const legacy=plan[day].exercises.find(row=>row.id===item.stable_key);
    assert.equal(v64LoadStep(day,item.stable_key),legacy?.step??0,`${day}:${item.stable_key}`);
  }
});
