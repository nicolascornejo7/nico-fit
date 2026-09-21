import {isV3ObservabilityEnabled,isV3LocalStorageEnabled} from './feature-flags.js';
import {v3ObservabilityRuntime} from './observability-runtime.js';
import {mayStartNewWork} from '../pwa-update-gate.js';
if(isV3ObservabilityEnabled()){
  const css=document.createElement('link');css.rel='stylesheet';css.href='./v3-training.css';document.head.append(css);
  const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent='Estado V3';document.querySelector('.top-actions').append(button);
  const root=document.createElement('section');root.className='v3-training-screen hidden';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Estado operativo V3');document.body.append(root);
  const background=[...document.querySelectorAll('.app-shell,.bottom-nav,#restOverlay,#sessionSummary')];let userId=null,repository=null,ui=null,generation=0,opening=false;
  document.addEventListener('nico-fit:pwa-safety-request',event=>{event.detail.critical ||= opening||!!ui?.busy;event.detail.userId ||= userId;});
  const close=()=>{generation++;root.classList.add('hidden');background.forEach(node=>node.inert=false);const pending=ui?.inFlight;ui?.destroy();ui=null;const prior=repository;repository=null;if(prior)Promise.resolve(pending).finally(()=>prior.close());button.focus();};
  document.addEventListener('nico-fit:v3-panel-open',event=>{if(event.detail!=='observability'&&ui)close();});
  document.addEventListener('nico-fit:auth',event=>{const next=event.detail?.userId||null;if(next!==userId){close();userId=next;}});
  document.dispatchEvent(new CustomEvent('nico-fit:auth-request'));
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){close();return;}if(event.key!=='Tab')return;const nodes=[...root.querySelectorAll('button,input,select,textarea,summary')].filter(node=>{const closed=node.closest('details:not([open])');return !node.disabled&&!node.hidden&&node.offsetParent!==null&&(!closed||closed.querySelector(':scope > summary')===node);}),first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();return;}if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
  button.onclick=async()=>{
    if(opening)return;if(!mayStartNewWork()){window.alert('Actualizá esta pestaña antes de iniciar un sync V3.');return;}if(!userId||!isV3ObservabilityEnabled()||!isV3LocalStorageEnabled()){window.alert('Iniciá sesión y habilitá explícitamente almacenamiento local y observabilidad V3.');return;}
    opening=true;const owner=userId,token=++generation;
    try{const [{V3LocalRepository},{V3ObservabilityService},{V3ObservabilityUI}]=await Promise.all([import('./repository.js'),import('./observability-service.js'),import('./observability-ui.js')]);const opened=await V3LocalRepository.open({userId:owner});if(token!==generation||owner!==userId){opened.close();return;}
      document.dispatchEvent(new CustomEvent('nico-fit:v3-panel-open',{detail:'observability'}));repository=opened;ui=new V3ObservabilityUI({root,service:new V3ObservabilityService({repository,...v3ObservabilityRuntime(owner)}),onClose:close});root.classList.remove('hidden');background.forEach(node=>node.inert=true);await ui.mount();
    }catch{if(token===generation){close();window.alert('No se pudo abrir el diagnóstico local V3.');}}finally{opening=false;}
  };
}
