const node=(tag,text)=>{const element=document.createElement(tag);if(tag==='button'){element.type='button';element.className='ghost';}if(text!=null)element.textContent=text;return element;};
const labels={defer:'Posponer decisión',keep_local:'Conservar local',accept_remote:'Aceptar remoto',keep_both:'Crear otra sesión de fútbol independiente'};
const states={open:'Pendiente de decisión',resolution_pending:'Decisión pendiente de sync',resolved:'Resuelto'};
const counter=rows=>`${rows.filter(row=>row.status==='open').length} conflictos abiertos · ${rows.filter(row=>row.status==='resolution_pending').length} decisiones pendientes de sync · ${rows.filter(row=>row.status==='resolved').length} resueltos`;
export class V3ConflictUI{
  constructor({root,service,onClose}){Object.assign(this,{root,service,onClose});this.destroyed=false;}
  destroy(){this.destroyed=true;}
  async mount(){
    this.root.replaceChildren();const heading=node('h1','Conflictos V3'),close=node('button','Cerrar'),refresh=node('button','Actualizar lista'),list=node('div'),status=node('p');status.setAttribute('role','status');
    close.onclick=this.onClose;refresh.onclick=()=>this.refresh(list,status);this.root.append(heading,close,refresh,status,list);await this.refresh(list,status);close.focus();
  }
  async refresh(list,status){
    try{const rows=await this.service.list();if(this.destroyed)return;list.replaceChildren();status.textContent=counter(rows);
      for(const row of rows){const detail=node('details'),summary=node('summary',`${row.entity} · ${row.date} · ${states[row.status]||row.status}`),reason=node('p',`${row.explanation} Origen: ${row.origin}. ID: ${row.record_id}`),sides=node('div');sides.className='v3-conflict-sides';
        for(const [label,payload] of [['Local actual',row.local],['Remoto conocido',row.remote]]){const side=node('section');side.append(node('h3',label),node('pre',JSON.stringify(payload,null,2)));sides.append(side);}
        detail.append(summary,reason,sides);
        if(row.status==='open'){
          const label=node('label','Decisión explícita '),select=node('select');for(const strategy of row.strategies){const option=node('option',labels[strategy]);option.value=strategy;select.append(option);}label.append(select);
          const noteLabel=node('label','Nota para la trazabilidad '),note=node('textarea');note.maxLength=2000;noteLabel.append(note);const confirm=node('button','Confirmar decisión'),message=node('p');message.setAttribute('role','status');
          detail.append(node('p','Conservar local queda pendiente de confirmación del servidor. Aceptar remoto reemplaza la copia local y archiva sus operaciones. Crear otra sesión no copia sus reviews. Un conflicto de una sesión activa puede requerir finalizarla o posponer.'),label,noteLabel,confirm,message);
          confirm.onclick=async()=>{confirm.disabled=true;try{await this.service.resolve(row,select.value,{note:note.value});if(this.destroyed)return;message.textContent='Decisión registrada. La auditoría completa está disponible al actualizar la lista.';select.disabled=true;note.disabled=true;const current=await this.service.list();if(this.destroyed)return;status.textContent=counter(current);const updated=current.find(item=>item.conflict_id===row.conflict_id);summary.textContent=`${row.entity} · ${row.date} · ${states[updated?.status]||row.status}`;summary.focus();}catch(error){if(this.destroyed)return;message.textContent=error.message.includes('Affected active session')?'Este conflicto afecta la sesión activa. Finalizala localmente o posponé antes de aceptar remoto.':error.message;confirm.disabled=false;confirm.focus();}};
        }
        detail.append(node('pre',JSON.stringify({decisions:row.decisions,operations:row.operationStates},null,2)));list.append(detail);
      }
    }catch(error){if(!this.destroyed)status.textContent=error.message;}
  }
}
