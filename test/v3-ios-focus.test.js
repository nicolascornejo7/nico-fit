import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('iOS focus controls use a non-zooming text size and a versioned shell',async()=>{
  const [index,inventory,styles,training,worker]=await Promise.all([
    readFile(new URL('../index.html',import.meta.url),'utf8'),
    readFile(new URL('../local-device-inventory.html',import.meta.url),'utf8'),
    readFile(new URL('../styles.css',import.meta.url),'utf8'),
    readFile(new URL('../v3-training.css',import.meta.url),'utf8'),
    readFile(new URL('../sw.js',import.meta.url),'utf8')
  ]);
  for(const html of [index,inventory]){
    assert.match(html,/name="viewport" content="width=device-width,\s*initial-scale=1(?:\.0)?(?:,\s*viewport-fit=cover)?/i);
    assert.doesNotMatch(html,/user-scalable|maximum-scale/i);
  }
  assert.match(styles,/html\{[^}]*-webkit-text-size-adjust:100%/);
  assert.match(styles,/input:not\(\[type="range"\]\):not\(\[type="checkbox"\]\),select,textarea\{font-size:17px/);
  assert.match(training,/\.v3-training-screen input:not\(\[type="range"\]\):not\(\[type="checkbox"\]\).*font-size:17px/);
  assert.match(index,/nico-fit-build" content="nico-fit-v45/);
  assert.match(worker,/const BUILD_ID='nico-fit-v45'/);
});
