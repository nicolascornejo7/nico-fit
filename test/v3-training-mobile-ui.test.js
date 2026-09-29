import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('iPhone training header keeps Back inside safe areas with a 44px target',async()=>{
  const [css,ui]=await Promise.all([read('../v3-training.css'),read('../js/v3/training-ui.js')]);
  assert.match(css,/\.v3-training-screen\s*\{[^}]*safe-area-inset-top[^}]*safe-area-inset-right[^}]*safe-area-inset-bottom/);
  assert.match(css,/\.v3-training-header\{display:flex/);
  assert.match(css,/\.v3-back-button\{[^}]*min-width:44px[^}]*min-height:44px/);
  assert.doesNotMatch(css,/\.v3-back-button\{[^}]*position:absolute/);
  assert.match(ui,/v3-training-header/);
  assert.match(ui,/‹ Volver/);
  assert.match(ui,/aria-label','Volver al inicio/);
});

test('training start screen makes daily workout primary and keeps existing actions',async()=>{
  const ui=await read('../js/v3/training-ui.js');
  assert.match(ui,/v3-training-primary/);
  assert.match(ui,/Comenzar entrenamiento[\s\S]{0,180}createSession\(\{dayIndex,useRoutine:true\}\)/);
  assert.match(ui,/v3-free-workout/);
  assert.match(ui,/Comenzar musculación libre[\s\S]{0,220}createFreeWorkout/);
  assert.match(ui,/v3-custom-session/);
  assert.match(ui,/Crear sesión personalizada/);
});

test('clean sync and Coach details stay compact until requested',async()=>{
  const [ui,coach]=await Promise.all([read('../js/v3/training-ui.js'),read('../js/v3/coach-presentation.js')]);
  assert.match(ui,/clean\?'v3-sync-status is-clean':'card v3-sync-status'/);
  assert.match(ui,/clean\?'✓ Sincronizado'/);
  assert.match(coach,/node\('details'\)/);
  assert.match(coach,/summary','¿Por qué\?'/);
  assert.match(coach,/summary','Ver ajustes sugeridos'/);
});

test('mobile shell reserves room above bottom navigation and supports safe-area padding',async()=>{
  const css=await read('../v3-training.css');
  assert.match(css,/\.v3-training-shell\{[^}]*safe-area-inset-bottom/);
  assert.match(css,/@media\(max-width:650px\)[\s\S]*\.v3-training-shell\{[^}]*safe-area-inset-bottom/);
  assert.match(css,/\.v3-training-screen \.wide\{min-height:48px/);
});

test('compact series keeps values and completion primary while moving destructive actions to options',async()=>{
  const ui=await read('../js/v3/training-ui.js');
  assert.match(ui,/v3-set v3-set-compact/);
  assert.match(ui,/v3-set-values/);
  assert.match(ui,/Marcar completada/);
  assert.match(ui,/is_completed:!set\.is_completed/);
  assert.match(ui,/v3-set-menu/);
  assert.match(ui,/Editar serie/);
  assert.match(ui,/Eliminar serie/);
  const setRender=ui.slice(ui.indexOf('async renderSets'),ui.indexOf('async renderSummary'));
  assert.doesNotMatch(setRender,/set\.sync_status/);
});

test('exercise picker keeps basic add direct and prescription controls optional',async()=>{
  const ui=await read('../js/v3/training-ui.js');
  assert.match(ui,/v3-add-exercise/);
  assert.match(ui,/Ejercicio del catálogo/);
  assert.match(ui,/v3-exercise-advanced/);
  assert.match(ui,/Ajustes avanzados \(opcional\)/);
  assert.match(ui,/Descanso \(s\)/);
  assert.match(ui,/button\('Agregar'/);
  assert.match(ui,/v3-custom-exercise/);
});

test('football entry is available by selected date and match review follows that context',async()=>{
  const [app,index,css]=await Promise.all([read('../js/app.js'),read('../index.html'),read('../styles.css')]);
  assert.match(index,/<details id="footballQuickCard" class="card football-entry">/);
  assert.match(index,/id="footballDate" type="date"/);
  assert.match(app,/function footballContext\(date=\$\('footballDate'\)\.value\|\|currentContext\(\)\.dateKey\)/);
  assert.match(app,/date\.max=today/);
  assert.match(app,/local_date:ctx\.date/);
  assert.match(app,/footballContext\(\)\.sessionType!=='match'/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderFootball'),app.indexOf('function updateFootballLoad')),/\[1,3,6\]/);
  assert.match(css,/\.football-entry>summary\{[^}]*min-height:58px/);
});
