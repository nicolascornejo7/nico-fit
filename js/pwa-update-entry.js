import {PwaUpdateCoordinator} from './pwa-update-coordinator.js';
import {collectPwaUpdateSafety} from './pwa-update-safety.js';
import {trackPwaFormDrafts,hasPwaFormDrafts,clearPwaFormDrafts} from './pwa-form-drafts.js';
import {appBuildId} from './pwa-version.js';
import {buildPwaUpdateDiagnostic} from './pwa-update-diagnostic.js';

trackPwaFormDrafts();
document.addEventListener('nico-fit:pwa-draft-saved',event=>clearPwaFormDrafts(event.detail?.fields||[]));

async function safety(){
  const detail={critical:false,userId:null};
  document.dispatchEvent(new CustomEvent('nico-fit:pwa-safety-request',{detail}));
  return collectPwaUpdateSafety({userId:detail.userId,critical:detail.critical,dirty:hasPwaFormDrafts()});
}

function element(tag,text,className){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
const panel=element('aside','','pwa-update-panel');panel.hidden=true;panel.setAttribute('aria-labelledby','pwaUpdateTitle');
const title=element('strong','Actualización de Nico Fit disponible');title.id='pwaUpdateTitle';
const description=element('p','','pwa-update-description');description.setAttribute('role','status');description.setAttribute('aria-live','polite');
const actions=element('div','','pwa-update-actions');
const reminder=element('button','Actualización pendiente','pwa-update-reminder');reminder.type='button';reminder.hidden=true;
const update=element('button','Actualizar ahora');update.type='button';update.className='primary';
const later=element('button','Después');later.type='button';later.className='ghost';
const diagnostic=element('details','','pwa-update-diagnostic'),diagnosticTitle=element('summary','Diagnóstico de bloqueo');
const diagnosticText=element('textarea');diagnosticText.readOnly=true;diagnosticText.rows=10;diagnosticText.setAttribute('aria-label','Snapshot de seguridad de actualización');
const copyDiagnostic=element('button','Copiar diagnóstico','ghost');copyDiagnostic.type='button';
diagnostic.append(diagnosticTitle,diagnosticText,copyDiagnostic);actions.append(update,later);panel.append(title,description,diagnostic,actions);document.body.append(panel,reminder);

let coordinator;
function render(state){
  if(!state)return;
  diagnosticText.value=JSON.stringify(buildPwaUpdateDiagnostic(state,{buildId:appBuildId()}),null,2);
  reminder.hidden=!(state.pending&&state.deferred&&!state.stale);
  panel.hidden=!(state.pending||state.stale)||state.deferred&&!state.stale;
  if(panel.hidden)return;
  const reason=state.reasons[0];
  description.textContent=reason|| (state.stale?'Esta pestaña usa una versión anterior. Guardá tu trabajo y actualizá.':'La nueva versión está lista. Se conservarán los datos locales.');
  update.disabled=!state.canUpdate;
  update.setAttribute('aria-describedby','pwaUpdateDescription');description.id='pwaUpdateDescription';
  update.textContent=state.stale&&!state.pending?'Recargar versión actual':'Actualizar ahora';
}
copyDiagnostic.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(diagnosticText.value);copyDiagnostic.textContent='Copiado';}
  catch{diagnostic.open=true;diagnosticText.focus();diagnosticText.select();copyDiagnostic.textContent='Seleccionado';}
});
update.addEventListener('click',async()=>{
  update.disabled=true;description.textContent='Verificando sesiones y otras pestañas…';
  const result=await coordinator.apply();
  if(!result.applied){description.textContent=result.reason;await coordinator.refresh();}
});
later.addEventListener('click',()=>coordinator.defer());
reminder.addEventListener('click',()=>{coordinator.deferred=false;coordinator.refresh().then(()=>update.focus());});
document.addEventListener('nico-fit:pwa-apply-update',async()=>{
  if(!coordinator)return;
  try{await coordinator.registration.update();await coordinator.refresh();await coordinator.apply();}catch{await coordinator.refresh();}
});

if('serviceWorker'in navigator){
  window.addEventListener('load',async()=>{
    try{
      const registration=await navigator.serviceWorker.register('./sw.js');
      coordinator=new PwaUpdateCoordinator({registration,readSafety:safety,onState:render});
      await coordinator.start();
    }catch(error){console.warn('No se pudo comprobar la actualización PWA.',error);}
  });
}
