import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {V3TrainingUI} from '../js/v3/training-ui.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';

class Element{
  constructor(tag){this.tag=tag;this.children=[];this.value='';this.hidden=false;this.listeners={};this.textContent='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,listener){this.listeners[name]=listener;}
  get options(){return this.children.filter(child=>child.tag==='option');}
  click(){return this.listeners.click?.();}
}
const find=(root,predicate)=>predicate(root)?root:root.children.map(child=>find(child,predicate)).find(Boolean);

test('free workout renders V3 catalog, adds a selected exercise and completes an inline set',async()=>{
  installRolloutControl({snapshot:()=>({updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true}}),refreshIfDue:async()=>{}});
  const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',featureEnabled:true});
  try{
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:false,now:()=>new Date('2026-09-30T12:00:00Z')});
    await engine.createFreeWorkout({date:'2026-09-30'});
    const ui=new V3TrainingUI({root:new Element('section'),engine,onClose:()=>{}});
    ui.run=task=>task();ui.message=new Element('p');
    const first=new Element('section');
    await ui.renderExercises(first,await engine.snapshot(),engine.getState());
    const picker=find(first,node=>node.tag==='select'&&node['aria-label']==='Ejercicio del catálogo');
    assert.ok(picker?.options.length>0);
    const target=picker.options.find(option=>option.textContent.includes('Press banca'))||picker.options[0];
    picker.value=target.value;
    await find(first,node=>node.tag==='button'&&node.textContent==='Agregar').click();
    let snapshot=await engine.snapshot();assert.equal(snapshot.exercises.length,1);assert.equal(snapshot.exercises[0].exercise_catalog_id,target.value);
    const second=new Element('section');await ui.renderExercises(second,snapshot,engine.getState());
    find(second,node=>node['aria-label']==='Serie 1: kg').value='60';
    find(second,node=>node['aria-label']==='Serie 1: reps').value='8';
    await find(second,node=>node.tag==='button'&&node['aria-label']?.startsWith('Completar serie 1')).click();
    snapshot=await engine.snapshot();assert.equal(snapshot.exercises[0].sets.length,1);assert.equal(snapshot.exercises[0].sets[0].is_completed,true);
  }finally{repository.close();globalThis.document=previous;}
});
