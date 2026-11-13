import test from 'node:test';
import assert from 'node:assert/strict';
import {startingLoad} from '../js/v3/starting-load.js';

test('starting load follows Coach reductions and blocks, then the progression rule, then the last load',()=>{
  assert.deepEqual(startingLoad({progression:{kg:62.5},lastLoad:60}),{kind:'progress',load:62.5});
  assert.deepEqual(startingLoad({progression:{kg:60},lastLoad:60}),{kind:'last',load:60});
  assert.deepEqual(startingLoad({progression:{kg:''},lastLoad:null}),{kind:'last',load:null});
  assert.deepEqual(startingLoad({progression:{kg:62.5},lastLoad:60,coach:{action:'reduce_load',suggestedLoad:54}}),{kind:'coach',load:54});
  assert.deepEqual(startingLoad({progression:{kg:62.5},lastLoad:60,coach:{action:'activation',suggestedLoad:48}}),{kind:'coach',load:48});
  assert.deepEqual(startingLoad({progression:{kg:62.5},lastLoad:60,coach:{action:'avoid_leg_progression',suggestedLoad:60}}),{kind:'last',load:60});
  assert.deepEqual(startingLoad({progression:{kg:62.5},lastLoad:60,coach:{action:'deload',suggestedLoad:60}}),{kind:'last',load:60});
  assert.deepEqual(startingLoad({progression:{kg:60},lastLoad:60,coach:{action:'progress_load',suggestedLoad:62.5}}),{kind:'progress',load:62.5});
});
