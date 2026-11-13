import test from 'node:test';
import assert from 'node:assert/strict';
import {stat,readFile} from 'node:fs/promises';
import {BASE_EXERCISES} from '../js/v3/base-exercise-catalog.js';
import {EXERCISE_PROFILES} from '../js/v3/exercise-recommendations.js';
import {exercisePhotos} from '../js/v3/exercise-photos.js';

test('every catalog and routine exercise has bundled start and end photos',async()=>{
  const keys=new Set([...BASE_EXERCISES.map(row=>row.stable_key),...Object.keys(EXERCISE_PROFILES)]);
  for(const key of keys){
    const photos=exercisePhotos({stable_key:key});assert.ok(photos,`no photo mapping for ${key}`);
    for(const path of [photos.start,photos.end]){
      const file=new URL(`../${path.replace(/^\.\//,'')}`,import.meta.url),info=await stat(file);
      assert.ok(info.size>2000&&info.size<200000,`${path} has unexpected size ${info.size}`);
      const head=(await readFile(file)).subarray(0,3);assert.deepEqual([...head],[0xff,0xd8,0xff],`${path} is not a JPEG`);
    }
  }
  assert.equal(exercisePhotos({stable_key:'custom:abc'}),null);
});

test('photos are not precached by the service worker and carry their attribution',async()=>{
  const [worker,readme]=await Promise.all([readFile(new URL('../sw.js',import.meta.url),'utf8'),readFile(new URL('../exercises-img/README.md',import.meta.url),'utf8')]);
  assert.doesNotMatch(worker,/exercises-img/);
  assert.match(readme,/free-exercise-db/);assert.match(readme,/Unlicense/);
});
