import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {V3TrainingUI} from '../js/v3/training-ui.js';
import {V3CoachService} from '../js/v3/coach-service.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';

class Element{
  constructor(tag,document){Object.assign(this,{tag,document,children:[],listeners:{},dataset:{},value:'',hidden:false,textContent:'',className:'',disabled:false});}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,listener){this.listeners[name]=listener;}
  get options(){return this.children.filter(child=>child.tag==='option');}
  getBoundingClientRect(){return {top:this.document.nodes().indexOf(this)*24-this.document.viewport.scrollY};}
  focus(options={}){this.document.activeElement=this;if(!options.preventScroll)this.document.viewport.scrollY+=this.getBoundingClientRect().top;}
  scrollIntoView(){this.document.viewport.scrollY+=this.getBoundingClientRect().top-300;}
  click(){return this.listeners.click?.({currentTarget:this});}
  querySelectorAll(selector){const names=selector.split(',').map(item=>item.trim());return this.document.descendants(this).filter(node=>names.some(name=>name.startsWith('.')?node.className.split(' ').includes(name.slice(1)):node.tag===name));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}

function mobileDocument(){
  const viewport={innerWidth:390,innerHeight:844,scrollY:0,scrollBy(_x,y){this.scrollY+=y;},addEventListener(){},removeEventListener(){}};
  const doc={viewport,createElement(tag){return new Element(tag,doc);},descendants(parent){return parent.children.flatMap(child=>[child,...doc.descendants(child)]);},nodes(){return [doc.root,...doc.descendants(doc.root)];}};
  doc.root=doc.createElement('main');return doc;
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const byClass=(node,name)=>descendants(node).filter(child=>child.className.split(' ').includes(name));
const byLabel=(node,label)=>descendants(node).find(child=>child['aria-label']===label);

test('completing sets in the first, middle and final exercise keeps the tapped row in the mobile viewport',async()=>{
  installRolloutControl({snapshot:()=>({updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_routines_enabled:true,v3_coach_enabled:false}}),refreshIfDue:async()=>{}});
  const previousDocument=globalThis.document,previousWindow=globalThis.window,doc=mobileDocument();
  globalThis.document=doc;globalThis.window=doc.viewport;
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',featureEnabled:true});
  try{
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now:()=>new Date('2026-09-15T12:00:00Z')});
    const started=await engine.createSession();assert.equal(started.exercises.length,7);await repository.markBootstrapHydrated();
    const ui=new V3TrainingUI({root:doc.root,engine,onClose:()=>{}});await ui.render();
    for(const index of [0,3,6]){
      const card=byClass(doc.root,'v3-exercise-card')[index],row=byClass(card,'v3-inline-set')[0];
      byLabel(row,'Serie 1: kg').value='50';
      byLabel(row,'Serie 1: '+(started.exercises[index].prescription_snapshot.measurement_kind==='seconds'?'seg':'reps')).value='8';
      doc.viewport.scrollY=Math.max(0,row.getBoundingClientRect().top+doc.viewport.scrollY-280);
      const before=row.getBoundingClientRect().top;
      await descendants(row).find(node=>node['aria-label']?.startsWith('Completar serie 1')).click();
      const next=byClass(byClass(doc.root,'v3-exercise-card')[index],'v3-inline-set')[0];
      assert.ok(Math.abs(next.getBoundingClientRect().top-before)<=1,`exercise ${index+1} moved from ${before} to ${next.getBoundingClientRect().top}`);
      assert.equal((await engine.snapshot()).exercises[index].sets[0].is_completed,true);
      assert.ok(engine.restRemaining()>0);
    }
    let finalCard=byClass(doc.root,'v3-exercise-card')[6],finalRow=byClass(finalCard,'v3-inline-set')[0];
    byLabel(finalRow,'Serie 1: seg').value='10';
    const editTop=finalRow.getBoundingClientRect().top;
    await descendants(finalRow).find(node=>node.textContent==='Guardar cambios').click();
    finalCard=byClass(doc.root,'v3-exercise-card')[6];finalRow=byClass(finalCard,'v3-inline-set')[0];
    assert.equal(finalRow.getBoundingClientRect().top,editTop);
    assert.equal((await engine.snapshot()).exercises[6].sets[0].duration_seconds,10);
    const addSet=byClass(finalCard,'v3-add-set')[0],addTop=addSet.getBoundingClientRect().top;
    await addSet.click();
    finalCard=byClass(doc.root,'v3-exercise-card')[6];
    assert.equal(byClass(finalCard,'v3-inline-set').length,4);
    assert.equal(byClass(finalCard,'v3-add-set')[0].getBoundingClientRect().top,addTop);
    const restButton=descendants(doc.root).find(node=>node.textContent==='Omitir');
    const cardTop=finalCard.getBoundingClientRect().top;
    await restButton.click();
    assert.equal(byClass(doc.root,'v3-exercise-card')[6].getBoundingClientRect().top,cardTop);
    assert.equal(engine.restRemaining(),0);
    ui.destroy();
    const reopened=new V3TrainingUI({root:doc.root,engine,onClose:()=>{}});await reopened.mount();
    const current=byClass(doc.root,'v3-exercise-card')[6];
    assert.ok(current.getBoundingClientRect().top>=0&&current.getBoundingClientRect().top<doc.viewport.innerHeight);
    reopened.destroy();
  }finally{repository.close();globalThis.document=previousDocument;globalThis.window=previousWindow;}
});

test('replacement opens recommendations without writes, exposes the full catalog on request, and records the chosen exercise',async()=>{
  installRolloutControl({snapshot:()=>({updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_routines_enabled:true,v3_coach_enabled:false}}),refreshIfDue:async()=>{}});
  const previousDocument=globalThis.document,previousWindow=globalThis.window,doc=mobileDocument();
  globalThis.document=doc;globalThis.window=doc.viewport;
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',featureEnabled:true});
  try{
    const now=()=>new Date('2026-09-15T12:00:00Z');
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:true,now});
    const started=await engine.createSession();await repository.markBootstrapHydrated();
    const ui=new V3TrainingUI({root:doc.root,engine,onClose:()=>{}});await ui.render();
    const bench=started.exercises.find(item=>item.catalog?.stable_key==='press-banca');
    const card=byClass(doc.root,'v3-exercise-card').find(node=>node.dataset.exerciseId===bench.id);
    doc.viewport.scrollY=card.getBoundingClientRect().top+doc.viewport.scrollY-280;
    const before=(await repository.listOperations()).length;
    await descendants(card).find(node=>node.textContent==='Cambiar ejercicio').click();
    const choices=byClass(card,'v3-recommended-option');
    assert.ok(choices.length>0&&choices.length<=3);
    assert.equal(choices[0].textContent,'Press inclinado con mancuernas');
    assert.ok(choices[0].children[0].textContent.includes('Mismo patrón'));
    const full=byClass(card,'v3-browse-exercises')[0];assert.equal(full.hidden,true);
    await descendants(card).find(node=>node.textContent==='Buscar otro ejercicio').click();
    assert.equal(full.hidden,false);
    assert.equal(descendants(full).find(node=>node.tag==='select').options.length,(await engine.catalog()).length);
    assert.equal((await repository.listOperations()).length,before);
    const top=card.getBoundingClientRect().top;
    await choices[0].click();
    const updated=(await engine.snapshot()).exercises.find(item=>item.id===bench.id);
    assert.equal(updated.catalog.stable_key,'press-inclinado-mancuernas');
    assert.equal(updated.prescription_snapshot.replaced_exercise_name,'Press banca');
    assert.equal(byClass(doc.root,'v3-exercise-card').find(node=>node.dataset.exerciseId===bench.id).getBoundingClientRect().top,top);
    assert.ok(descendants(doc.root).some(node=>node.textContent==='En lugar de: Press banca'));
    assert.equal((await engine.snapshot()).session.routine_snapshot.exercises.find(item=>item.exercise_catalog_id===bench.exercise_catalog_id).exercise_name_snapshot,'Press banca');
    await engine.saveSet(updated.id,{load_kg:40,reps:8,rir:2,is_completed:true},{position:0,startRest:true});
    const completed=await engine.finishSession({rpe:7});
    assert.equal((await engine.metrics(completed.session.id)).perExercise[updated.exercise_catalog_id]?.completedSets,1);
    const coach=await new V3CoachService({engine,featureEnabled:true,now,readContext:async()=>({readiness:[],football:[],matches:[],warnings:[],hasConflicts:false})}).today(completed);
    assert.ok(coach.signals.history.some(item=>item.exercises.some(ex=>ex.exercise_catalog_id===updated.exercise_catalog_id&&ex.sets[0]?.is_completed)));
    ui.destroy();
  }finally{repository.close();globalThis.document=previousDocument;globalThis.window=previousWindow;}
});
