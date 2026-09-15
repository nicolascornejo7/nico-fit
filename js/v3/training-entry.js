import {isV3TrainingEnabled,isV3LocalStorageEnabled} from './feature-flags.js';

// Auth is supplied by V2 coordination. This entry never creates a Supabase client.
if(isV3TrainingEnabled()){
  const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href='./v3-training.css';document.head.append(stylesheet);
  const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent='Entrenar V3';
  document.querySelector('.top-actions').append(button);
  const root=document.createElement('section');root.className='v3-training-screen hidden';root.setAttribute('aria-label','Entrenamiento V3');document.body.append(root);
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
  const background=[...document.querySelectorAll('.app-shell,.bottom-nav,#restOverlay,#sessionSummary')];
  const setBackgroundInert=value=>background.forEach(node=>{node.inert=value;});
  let userId=null,generation=0,ui=null,repository=null,opening=false;
  const close=()=>{
    generation++;root.classList.add('hidden');setBackgroundInert(false);
    const flush=ui?.engine.flush();ui?.destroy();ui=null;const prior=repository;repository=null;
    if(prior)Promise.resolve(flush).finally(()=>prior.close());button.focus();
  };
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){close();return;}
    if(event.key!=='Tab')return;
    const focusable=[...root.querySelectorAll('button,input,select,textarea')].filter(node=>!node.disabled&&node.offsetParent!==null);
    const first=focusable[0],last=focusable.at(-1);if(!first){event.preventDefault();return;}
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  document.addEventListener('nico-fit:auth',event=>{
    const next=event.detail?.userId||null;if(next!==userId){close();userId=next;}button.title=next?'Abrir entrenamiento V3 local':'Iniciá sesión en V2 para usar V3';
  });
  document.dispatchEvent(new CustomEvent('nico-fit:auth-request'));
  button.addEventListener('click',async()=>{
    if(opening)return;
    if(!isV3TrainingEnabled()||!isV3LocalStorageEnabled()){window.alert('Habilitá explícitamente los flags de entrenamiento y almacenamiento local V3.');return;}
    if(!userId){window.alert('Iniciá sesión en V2 antes de abrir el entrenamiento V3.');return;}
    opening=true;const expectedUser=userId,token=++generation;
    try{
      const [{V3LocalRepository},{V3TrainingEngine},{V3TrainingUI}]=await Promise.all([import('./repository.js'),import('./training-engine.js'),import('./training-ui.js')]);
      const opened=await V3LocalRepository.open({userId:expectedUser});
      if(token!==generation||expectedUser!==userId){opened.close();return;}
      repository=opened;const engine=new V3TrainingEngine({repository});
      ui=new V3TrainingUI({root,engine,onClose:close});root.classList.remove('hidden');setBackgroundInert(true);await ui.mount();
    }catch(error){if(token===generation){close();window.alert(error.message);}}
    finally{opening=false;}
  });
}
