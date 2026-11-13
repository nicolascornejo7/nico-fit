// Routine editor: edits the latest version of a routine as an in-memory draft
// and saves it as a NEW version (history and past sessions stay untouched).
// Saving an edit marks the routine as customized, so app-published program
// versions stop being layered on top of it.

const DEFAULT_RX={reps:{sets:3,min:8,max:12,target_rir:2,rest:90,step:2.5},seconds:{sets:3,min:30,max:45,target_rir:null,rest:60,step:0}};

export function draftFromVersion(graph){
  return graph.exercises.map(row=>{const rx=row.prescription_snapshot;return {exercise_catalog_id:row.exercise_catalog_id,exercise_name_snapshot:row.exercise_name_snapshot,measurement_kind:rx.measurement_kind,sets:rx.sets,min:rx.min,max:rx.max,target_rir:rx.target_rir??null,rest:rx.rest??null,step:rx.step??0,notes:rx.notes??''};});
}

export function draftRowFor(catalog){
  const kind=catalog.measurement_kind==='seconds'?'seconds':'reps';
  return {exercise_catalog_id:catalog.id,exercise_name_snapshot:catalog.canonical_name,measurement_kind:kind,...DEFAULT_RX[kind],notes:''};
}

const number=(value,label,{allowNull=false}={})=>{
  if(value===''||value==null){if(allowNull)return null;throw new Error(`${label}: falta un valor.`);}
  const parsed=Number(String(value).replace(',','.'));if(!Number.isFinite(parsed)||parsed<0)throw new Error(`${label}: valor inválido.`);return parsed;
};

// Draft rows → the exercises payload createVersion expects.
export function draftToExercises(draft){
  if(!draft.length)throw new Error('La rutina necesita al menos un ejercicio.');
  return draft.map(row=>{
    const name=row.exercise_name_snapshot,sets=number(row.sets,`${name} · series`),min=number(row.min,`${name} · mínimo`),max=number(row.max,`${name} · máximo`);
    if(!Number.isInteger(sets)||sets<1||sets>20)throw new Error(`${name}: entre 1 y 20 series.`);
    if(min>max)throw new Error(`${name}: el mínimo no puede superar al máximo.`);
    const target_rir=number(row.target_rir,`${name} · RIR`,{allowNull:true});if(target_rir!=null&&target_rir>5)throw new Error(`${name}: RIR entre 0 y 5.`);
    return {exercise_catalog_id:row.exercise_catalog_id,exercise_name_snapshot:name,prescription_snapshot:{sets,min,max,target_rir,rest:number(row.rest,`${name} · descanso`,{allowNull:true}),step:row.step??0,measurement_kind:row.measurement_kind,notes:row.notes??''}};
  });
}

export function moveRow(draft,index,delta){
  const target=index+delta;if(target<0||target>=draft.length)return draft;
  const next=[...draft];[next[index],next[target]]=[next[target],next[index]];return next;
}

export class RoutineEditor{
  constructor({service,catalog,run,onClose,rerender}){Object.assign(this,{service,catalog,run,onClose,rerender});this.templateId=null;this.draft=null;this.notice='';}

  async open(templateId){const graph=await this.service.latest(templateId);this.templateId=templateId;this.version=graph.version.version_number;this.name=graph.template.name;this.draft=draftFromVersion(graph);this.notice='';}

  async render(shell){
    const doc=globalThis.document,el=(tag,text,className)=>{const node=doc.createElement(tag);if(text!=null)node.textContent=String(text);if(className)node.className=className;return node;};
    const button=(text,onClick,className='ghost')=>{const node=el('button',text,className);node.type='button';node.addEventListener('click',onClick);return node;};
    const card=el('section',null,'card v3-routine-editor');shell.append(card);
    const head=el('div',null,'v3-editor-head');head.append(el('h3',this.draft?`Editar: ${this.name}`:'Mis rutinas'),button('Cerrar',()=>this.onClose()));card.append(head);
    if(this.notice){const notice=el('p',this.notice,'advice');notice.setAttribute('role','status');card.append(notice);}
    if(!this.draft){
      card.append(el('p','Elegí una rutina. Al guardar se crea una versión nueva: tus sesiones anteriores no cambian.','muted'));
      const templates=(await this.service.list()).filter(row=>row.is_active&&!row.deleted_at);
      for(const template of templates){const latest=template.versions.find(row=>!row.deleted_at);card.append(button(`${template.name} · versión ${latest?.version_number??'—'}`,()=>this.run(()=>this.open(template.id)),'ghost wide v3-editor-pick'));}
      return;
    }
    card.append(el('p',`Basada en la versión ${this.version}. Guardar crea la versión ${this.version+1}.`,'muted'));
    const list=el('div',null,'v3-editor-list');card.append(list);
    this.draft.forEach((row,index)=>{
      const item=el('div',null,'v3-editor-row');list.append(item);
      const title=el('div',null,'v3-editor-title');title.append(el('strong',`${index+1}. ${row.exercise_name_snapshot}`));
      const tools=el('div',null,'v3-editor-tools');
      const up=button('↑',()=>{this.draft=moveRow(this.draft,index,-1);this.rerender();});up.setAttribute('aria-label',`Subir ${row.exercise_name_snapshot}`);up.disabled=index===0;
      const down=button('↓',()=>{this.draft=moveRow(this.draft,index,1);this.rerender();});down.setAttribute('aria-label',`Bajar ${row.exercise_name_snapshot}`);down.disabled=index===this.draft.length-1;
      const remove=button('✕',()=>{this.draft=this.draft.filter((_,position)=>position!==index);this.rerender();},'ghost danger-lite');remove.setAttribute('aria-label',`Quitar ${row.exercise_name_snapshot}`);
      tools.append(up,down,remove);title.append(tools);item.append(title);
      const fields=el('div',null,'v3-editor-fields');item.append(fields);
      const unit=row.measurement_kind==='seconds'?'seg':'reps';
      for(const [key,label] of [['sets','Series'],['min',`Mín ${unit}`],['max',`Máx ${unit}`],['target_rir','RIR'],['rest','Desc. s']]){
        const wrapper=el('label',null,'v3-inline-field'),input=el('input');input.type='number';input.inputMode='decimal';input.min='0';input.value=row[key]??'';input.setAttribute('aria-label',`${row.exercise_name_snapshot}: ${label}`);
        input.addEventListener('input',()=>{row[key]=input.value;});wrapper.append(el('span',label),input);fields.append(wrapper);
      }
    });
    const add=el('div',null,'v3-editor-add');card.append(add);
    const select=doc.createElement('select');select.setAttribute('aria-label','Ejercicio para agregar');
    for(const item of [...this.catalog].sort((a,b)=>String(a.metadata?.category??'').localeCompare(String(b.metadata?.category??''))||a.canonical_name.localeCompare(b.canonical_name))){const option=doc.createElement('option');option.value=item.id;option.textContent=`${item.metadata?.category?`${item.metadata.category} · `:''}${item.canonical_name}`;select.append(option);}
    add.append(select,button('Agregar ejercicio',()=>{const item=this.catalog.find(row=>row.id===select.value);if(item){this.draft=[...this.draft,draftRowFor(item)];this.rerender();}}));
    const actions=el('div',null,'v3-editor-actions');card.append(actions);
    actions.append(button(`Guardar versión ${this.version+1}`,()=>this.run(async()=>{
      const exercises=draftToExercises(this.draft),saved=await this.service.createVersion(this.templateId,{exercises});
      this.version=saved.version.version_number;this.draft=draftFromVersion(saved);this.notice=`Guardada la versión ${this.version}. Es la que vas a entrenar a partir de ahora.`;
    }),'primary wide'),button('Descartar cambios',()=>this.run(()=>this.open(this.templateId)),'ghost wide'),button('Elegir otra rutina',()=>{this.draft=null;this.templateId=null;this.notice='';this.rerender();},'ghost wide'));
  }
}
