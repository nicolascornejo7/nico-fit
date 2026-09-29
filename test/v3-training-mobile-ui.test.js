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
