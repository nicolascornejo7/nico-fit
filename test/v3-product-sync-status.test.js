import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertAuthorizedV3Url} from '../js/v3/authorized-projects.js';
import {productSyncStatus} from '../js/v3/product-sync-status.js';

const clean=url=>productSyncStatus({authenticated:true,online:true,runtimeAuthorized:!!assertAuthorizedV3Url(url),syncEnabled:true,queue:0,conflicts:0});

test('production and staging authorized runtimes with queue zero are synchronized',()=>{
  assert.deepEqual(clean('https://xaklsoqyzwowtjwcpwmb.supabase.co'),{kind:'synced',text:'Sincronizado',reason:'clean'});
  assert.deepEqual(clean('https://tmydirzzlmlmtjgwqcgh.supabase.co'),{kind:'synced',text:'Sincronizado',reason:'clean'});
});

test('pending queue, offline and real errors have distinct product states',()=>{
  assert.equal(productSyncStatus({authenticated:true,online:true,runtimeAuthorized:true,syncEnabled:true,queue:2}).reason,'queue');
  assert.equal(productSyncStatus({authenticated:true,online:false,runtimeAuthorized:true,syncEnabled:true}).reason,'offline');
  assert.equal(productSyncStatus({authenticated:true,online:true,runtimeAuthorized:false,syncEnabled:true}).reason,'runtime');
  assert.equal(productSyncStatus({authenticated:true,online:true,runtimeAuthorized:true,syncEnabled:true,lastError:{kind:'transient'}}).reason,'error');
});

test('unknown or malformed Supabase projects stay rejected',()=>{
  for(const value of ['https://third-project.supabase.co','not-a-url','https://xaklsoqyzwowtjwcpwmb.supabase.co/path'])assert.throws(()=>assertAuthorizedV3Url(value),/no está autorizado|URL válida/);
});

test('production UI and observability contain no staging-only instruction',async()=>{
  const sources=await Promise.all(['../js/app.js','../js/v3/observability-service.js','../js/v3/observability-runtime.js'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
  assert.doesNotMatch(sources.join('\n'),/motor V3 de staging|Only an explicitly configured staging/i);
});
