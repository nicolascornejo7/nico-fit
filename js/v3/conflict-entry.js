import {isV3ConflictsEnabled,isV3LocalStorageEnabled} from './feature-flags.js';
import {mayStartNewWork} from '../pwa-update-gate.js';
if(isV3ConflictsEnabled()){
  const css=document.createElement('link');css.rel='stylesheet';css.href='./v3-training.css';document.head.append(css);
  const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent='Conflictos V3';document.querySelector('.top-actions').append(button);
  const root=document.createElement('section');root.className='v3-training-screen hidden';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Conflictos V3');document.body.append(root);
  const background=[...document.querySelectorAll('.app-shell,.bottom-nav,#restOverlay,#sessionSummary')];let userId=null,repository=null,ui=null,generation=0,opening=false;
  document.addEventListener('nico-fit:pwa-safety-request',event=>{event.detail.critical ||= opening||!!ui?.busy;event.detail.userId ||= userId;});
  const close=()=>{generation++;root.classList.add('hidden');background.forEach(node=>node.inert=false);ui?.destroy();ui=null;repository?.close();repository=null;button.focus();};
  document.addEventListener('nico-fit:v3-panel-open',event=>{if(event.detail!=='conflicts'&&ui)close();});
  document.addEventListener('nico-fit:auth',event=>{const next=event.detail?.userId||null;if(next!==userId){close();userId=next;}});
  document.dispatchEvent(new CustomEvent('nico-fit:auth-request'));
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){close();return;}if(event.key!=='Tab')return;const nodes=[...root.querySelectorAll('button,input,select,textarea,summary')].filter(node=>{const closed=node.closest('details:not([open])');return !node.disabled&&node.offsetParent!==null&&(!closed||closed.querySelector(':scope > summary')===node);}),first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();return;}if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
  button.onclick=async()=>{
    if(opening)return;if(!mayStartNewWork()){window.alert('Actualizá esta pestaña antes de resolver conflictos.');return;}if(!userId||!isV3ConflictsEnabled()||!isV3LocalStorageEnabled()){window.alert('Iniciá sesión y habilitá explícitamente almacenamiento local y conflictos V3.');return;}
    opening=true;const owner=userId,token=++generation;
    try{const [{V3LocalRepository},{V3ConflictService},{V3ConflictUI}]=await Promise.all([import('./repository.js'),import('./conflict-service.js'),import('./conflict-ui.js')]);const opened=await V3LocalRepository.open({userId:owner});if(token!==generation||owner!==userId){opened.close();return;}
      document.dispatchEvent(new CustomEvent('nico-fit:v3-panel-open',{detail:'conflicts'}));repository=opened;ui=new V3ConflictUI({root,service:new V3ConflictService({repository}),onClose:close});root.classList.remove('hidden');background.forEach(node=>node.inert=true);await ui.mount();
    }catch(error){if(token===generation){close();window.alert(error.message);}}finally{opening=false;}
  };
}
