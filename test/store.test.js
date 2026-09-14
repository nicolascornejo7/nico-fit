import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTombstones,emptyData,loadLocalData,saveLocalData,storageKey} from '../js/store.js';

function memoryStorage(){
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}

test('local data is isolated by authenticated user',()=>{
  global.localStorage=memoryStorage();
  const a={...emptyData(),readiness:[{date:'2026-09-13',sleep:5}]};
  const b={...emptyData(),readiness:[{date:'2026-09-13',sleep:2}]};
  saveLocalData(a,'user-a');saveLocalData(b,'user-b');
  assert.equal(loadLocalData('user-a').readiness[0].sleep,5);
  assert.equal(loadLocalData('user-b').readiness[0].sleep,2);
  assert.notEqual(storageKey('user-a'),storageKey('user-b'));
});

test('legacy unscoped data is visible only to the guest profile',()=>{
  global.localStorage=memoryStorage();
  localStorage.setItem('gymFutbolAppV2',JSON.stringify({...emptyData(),matches:[{date:'2026-09-13'}]}));
  assert.equal(loadLocalData('guest').matches.length,1);
  assert.equal(loadLocalData('user-a').matches.length,0);
});

test('a tombstone prevents a stale record from being merged back',()=>{
  const stale={date:'2026-09-13',sleep:5,updatedAt:'2026-09-13T10:00:00.000Z'};
  const result=applyTombstones({...emptyData(),readiness:[stale],tombstones:[{entity:'readiness',recordKey:stale.date,deletedAt:'2026-09-13T11:00:00.000Z'}]});
  assert.deepEqual(result.readiness,[]);
});

test('delete-all marker rejects old rows but permits records created later',()=>{
  const result=applyTombstones({...emptyData(),readiness:[
    {date:'old',updatedAt:'2026-09-13T10:00:00.000Z'},
    {date:'new',updatedAt:'2026-09-13T12:00:00.000Z'}
  ],tombstones:[{entity:'*',recordKey:'2026-09-13T11:00:00.000Z',deletedAt:'2026-09-13T11:00:00.000Z'}]});
  assert.deepEqual(result.readiness.map(x=>x.date),['new']);
});
