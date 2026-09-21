import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const ref='tmydirzzlmlmtjgwqcgh',url=`https://${ref}.supabase.co`,env=process.env;
assert.equal(env.SUPABASE_STAGING_PROJECT_REF,ref);
assert.equal(env.SUPABASE_STAGING_URL,url);
assert.ok(env.SUPABASE_STAGING_PUBLISHABLE_KEY&&!env.SUPABASE_STAGING_PUBLISHABLE_KEY.startsWith('sb_secret_'));
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="nico-fit-build" content="nico-fit-v18"><title>Rollout V3 · staging</title><link rel="stylesheet" href="/styles.css"></head><body><main class="app-shell"><h1>Rollout V3 · staging</h1><p>Lectura pública del proyecto descartable. No hay login, IndexedDB ni escrituras.</p><button id="refresh" type="button">Leer configuración ahora</button><p id="summary" role="status"></p><pre id="details"></pre></main><script type="module">import {rolloutControl,rolloutReady} from '/js/v3/rollout-boot.js';const summary=document.querySelector('#summary'),details=document.querySelector('#details');function render(s){summary.textContent=s.reason||'Configuración recibida.';details.textContent=JSON.stringify({version:s.configVersion,source:s.source,ageMs:s.cacheAgeMs,minimum:s.minimumClientVersion,maintenance:s.maintenanceMode,updateRequired:s.updateRequired,remoteWritesAllowed:s.remoteWritesAllowed,flags:s.flags},null,2)}document.addEventListener('nico-fit:rollout-change',e=>render(e.detail));document.querySelector('#refresh').onclick=()=>rolloutControl.refresh({force:true});render(await rolloutReady);</script></body></html>`;
createServer(async(request,response)=>{
  const path=new URL(request.url,'http://127.0.0.1').pathname;
  if(path==='/api/config'){response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({url,publishableKey:env.SUPABASE_STAGING_PUBLISHABLE_KEY}));return;}
  if(path==='/'){response.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}).end(html);return;}
  if(!['/styles.css','/js/pwa-version.js','/js/v3/rollout-boot.js','/js/v3/rollout-control.js','/js/v3/rollout-policy.js','/js/v3/rollout-state.js'].includes(path)){response.writeHead(404).end('Not found');return;}
  try{const body=await readFile(new URL('..'+path,import.meta.url));response.writeHead(200,{'Content-Type':path.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store'}).end(body);}catch{response.writeHead(404).end('Not found');}
}).listen(41744,'127.0.0.1',()=>console.log('V3 staging rollout read-only fixture: http://127.0.0.1:41744'));
