import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('daily training actions state their intent and the option hub is explicit',async()=>{
  const [app,entry,index]=await Promise.all([read('../js/app.js'),read('../js/v3/training-entry.js'),read('../index.html')]);
  assert.match(app,/Continuar entrenamiento/);
  assert.match(app,/Comenzar rutina/);
  assert.match(app,/Explorar entrenamientos/);
  assert.match(app,/mode:action\[1\]/);
  assert.match(app,/mode:'open'/);
  assert.match(entry,/textContent='Explorar'/);
  assert.match(entry,/aria-label','Explorar entrenamientos'/);
  assert.match(index,/aria-label="Explorar entrenamientos"/);
});

test('check-in states distinguish never saved, pending changes, and today saved',async()=>{
  const [app,index]=await Promise.all([read('../js/app.js'),read('../index.html')]);
  assert.match(app,/Sin guardar/);
  assert.match(app,/Cambios pendientes/);
  assert.match(app,/✓ Guardado hoy/);
  assert.match(app,/function renderReadinessState/);
  assert.match(app,/\$\('painArea'\)\.addEventListener\('change',renderReadinessState\)/);
  assert.match(index,/id="readinessAdvice" class="advice" role="status" aria-live="polite"/);
});

test('healthy sync stays discreet while problems have an actionable route to Settings',async()=>{
  const [app,training,conflicts,observability,index]=await Promise.all([read('../js/app.js'),read('../js/v3/training-ui.js'),read('../js/v3/conflict-entry.js'),read('../js/v3/observability-entry.js'),read('../index.html')]);
  assert.match(training,/clean\?'v3-sync-status is-clean':'card v3-sync-status'/);
  assert.match(training,/clean\?'✓ Sincronizado'/);
  assert.match(app,/currentProductSync\.kind!=='synced'/);
  assert.match(app,/openSupportBtn/);
  assert.match(index,/id="v3SupportSection"/);
  assert.match(index,/id="v3SupportActions"/);
  assert.match(conflicts,/#v3SupportActions/);
  assert.match(observability,/#v3SupportActions/);
});

test('primary mobile controls retain 44px targets, safe areas, and visible focus',async()=>{
  const [css,trainingCss]=await Promise.all([read('../styles.css'),read('../v3-training.css')]);
  assert.match(css,/\.primary,\.ghost,\.icon-btn,\.danger-btn,\.nav-btn\{min-height:44px/);
  assert.match(css,/\.nav-btn\{min-height:48px/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/\.sync-alert:focus-visible/);
  assert.match(trainingCss,/safe-area-inset-top/);
  assert.match(trainingCss,/\.v3-back-button\{[^}]*min-height:44px/);
});
