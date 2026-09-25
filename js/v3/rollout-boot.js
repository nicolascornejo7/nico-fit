import {appBuildId} from '../pwa-version.js';
import {V3RolloutControl} from './rollout-control.js';

const banner=document.createElement('aside');banner.className='rollout-banner';banner.hidden=true;banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
const title=document.createElement('strong'),message=document.createElement('p'),update=document.createElement('button');update.type='button';update.textContent='Buscar actualización';update.className='primary';
banner.append(title,message,update);
// The banner is normal layout content so it reserves space above the header
// instead of covering the V3 entry action on narrow standalone PWAs.
const appShell=document.querySelector('.app-shell');
if(appShell)appShell.before(banner);else document.body.prepend(banner);
update.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('nico-fit:pwa-apply-update')));
const control=new V3RolloutControl({buildId:appBuildId(),onChange:state=>{
  banner.hidden=!state.updateRequired&&!state.maintenanceMode;
  title.textContent=state.updateRequired?'Actualización requerida':'Nico Fit en mantenimiento';
  message.textContent=state.reason||'';update.hidden=!state.updateRequired;
  document.dispatchEvent(new CustomEvent('nico-fit:rollout-change',{detail:state}));
}});
export const rolloutReady=control.start().catch(()=>control.snapshot());
window.addEventListener('online',()=>control.refresh({force:true}).catch(()=>{}));
export {control as rolloutControl};
