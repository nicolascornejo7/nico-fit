import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('progress presents one selected area at a time and keeps unified history expandable',async()=>{
  const [index,app,css]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../js/app.js',import.meta.url),'utf8'),readFile(new URL('../styles.css',import.meta.url),'utf8')]);
  for(const area of ['strength','readiness','football'])assert.match(index,new RegExp(`data-progress-area="${area}"`));
  assert.match(index,/id="progressStrengthPanel"/);assert.match(index,/id="progressReadinessPanel"/);assert.match(index,/id="progressFootballPanel"/);assert.match(index,/id="historyOlder"/);
  assert.match(app,/function renderProgressArea\(\)/);assert.match(app,/classList\.toggle\('hidden',!active\)/);assert.match(app,/function renderProgressHistory\(model\)/);assert.match(app,/recentTimeline\(model\)/);
  assert.match(css,/\.progress-areas\{display:grid;grid-template-columns:repeat\(3,1fr\)/);assert.match(css,/\.progress-history-more summary\{min-height:44px/);
});
