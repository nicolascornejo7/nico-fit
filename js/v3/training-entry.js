import {isV3TrainingEnabled,isV3LocalStorageEnabled} from './feature-flags.js';
import {mayStartNewWork} from '../pwa-update-gate.js';
import {rolloutReady} from './rollout-boot.js';
import {rolloutAllowsLocalTraining} from './rollout-state.js';
import {cachedV3Identity} from './offline-auth.js';
await rolloutReady;

// Online Auth events and the SDK's persisted offline identity share the same user ID.
{
  const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href='./v3-training.css';document.head.append(stylesheet);
  const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent='Entrenar V3';
  button.hidden=!isV3TrainingEnabled();document.addEventListener('nico-fit:rollout-change',()=>{button.hidden=!isV3TrainingEnabled();});
  document.querySelector('.top-actions').append(button);
  const root=document.createElement('section');root.className='v3-training-screen hidden';root.setAttribute('aria-label','Entrenamiento V3');document.body.append(root);
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
  const background=[...document.querySelectorAll('.app-shell,.bottom-nav,#restOverlay,#sessionSummary')];
  const setBackgroundInert=value=>background.forEach(node=>{node.inert=value;});
  let userId=globalThis.navigator?.onLine===false?cachedV3Identity()?.id||null:null,generation=0,ui=null,repository=null,opening=false;
  const offlineStatus=document.createElement('span');offlineStatus.setAttribute('role','status');offlineStatus.textContent='';button.after(offlineStatus);
  const renderIdentity=()=>{button.title=userId?(globalThis.navigator?.onLine===false?'Offline · sesión local':'Abrir entrenamiento V3 local'):'Iniciá sesión para usar V3';offlineStatus.textContent=userId&&globalThis.navigator?.onLine===false?'Offline · sesión local':'';};
  renderIdentity();
  globalThis.window?.addEventListener('offline',()=>{userId ||= cachedV3Identity()?.id||null;renderIdentity();});
  globalThis.window?.addEventListener('online',renderIdentity);
  for(const id of ['loginBtn','signupBtn'])document.getElementById(id)?.addEventListener('click',event=>{if(globalThis.navigator?.onLine!==false)return;event.stopImmediatePropagation();document.getElementById('authMessage').textContent=userId?'Offline · sesión local disponible en Entrenar V3.':'Sin conexión. Iniciá sesión cuando vuelva la red.';},true);
  document.addEventListener('nico-fit:pwa-safety-request',event=>{event.detail.critical ||= opening||!!ui?.busy;event.detail.userId ||= userId;});
  const close=()=>{
    generation++;root.classList.add('hidden');setBackgroundInert(false);
    const flush=ui?.engine.flush();ui?.destroy();ui=null;const prior=repository;repository=null;
    if(prior)Promise.resolve(flush).finally(()=>prior.close());button.focus();
  };
  document.addEventListener('nico-fit:v3-panel-open',event=>{if(event.detail!=='training'&&ui)close();});
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){close();return;}
    if(event.key!=='Tab')return;
    const focusable=[...root.querySelectorAll('button,input,select,textarea,summary')].filter(node=>{const closed=node.closest('details:not([open])');return !node.disabled&&node.offsetParent!==null&&(!closed||closed.querySelector(':scope > summary')===node);});
    const first=focusable[0],last=focusable.at(-1);if(!first){event.preventDefault();return;}
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  document.addEventListener('nico-fit:auth',event=>{
    const next=event.detail?.userId||(globalThis.navigator?.onLine===false?cachedV3Identity()?.id:null);if(next!==userId){close();userId=next;}renderIdentity();
  });
  document.dispatchEvent(new CustomEvent('nico-fit:auth-request'));
  button.addEventListener('click',async()=>{
    if(opening)return;
    if(!mayStartNewWork()){window.alert('Actualizá o recargá esta pestaña antes de iniciar trabajo nuevo.');return;}
    if(!rolloutAllowsLocalTraining()||!isV3TrainingEnabled()||!isV3LocalStorageEnabled()){window.alert('Habilitá explícitamente los flags de entrenamiento y almacenamiento local V3.');return;}
    if(!userId){window.alert('Iniciá sesión online antes de abrir el entrenamiento V3.');return;}
    opening=true;const expectedUser=userId,token=++generation;
    try{
      const [{V3LocalRepository},{V3TrainingEngine},{V3TrainingUI},{syncV3Repository}]=await Promise.all([import('./repository.js'),import('./training-engine.js'),import('./training-ui.js'),import('./sync-runtime.js')]);
      const opened=await V3LocalRepository.open({userId:expectedUser});
      if(token!==generation||expectedUser!==userId){opened.close();return;}
      document.dispatchEvent(new CustomEvent('nico-fit:v3-panel-open',{detail:'training'}));repository=opened;const engine=new V3TrainingEngine({repository});
      ui=new V3TrainingUI({root,engine,onClose:close,syncNow:()=>syncV3Repository(opened)});root.classList.remove('hidden');setBackgroundInert(true);await ui.mount();
    }catch(error){if(token===generation){close();window.alert(error.message);}}
    finally{opening=false;}
  });
}
