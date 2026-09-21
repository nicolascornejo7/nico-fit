import {appBuildId} from '../pwa-version.js';
import {V3RolloutControl} from './rollout-control.js';

const banner=document.createElement('aside');banner.className='rollout-banner';banner.hidden=true;banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
const title=document.createElement('strong'),message=document.createElement('p'),update=document.createElement('button');update.type='button';update.textContent='Buscar actualización';update.className='primary';
banner.append(title,message,update);document.body.append(banner);
update.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('nico-fit:pwa-apply-update')));
const control=new V3RolloutControl({buildId:appBuildId(),onChange:state=>{
  banner.hidden=!state.updateRequired&&!state.maintenanceMode;
  title.textContent=state.updateRequired?'Actualización requerida':'Nico Fit en mantenimiento';
  message.textContent=state.reason||'';update.hidden=!state.updateRequired;
  document.dispatchEvent(new CustomEvent('nico-fit:rollout-change',{detail:state}));
}});
export const rolloutReady=control.start().catch(()=>control.snapshot());
export {control as rolloutControl};
