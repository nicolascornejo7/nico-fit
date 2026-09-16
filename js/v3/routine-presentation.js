// Minimal read-only view, reusable by the future editor. All dynamic text uses DOM APIs.
const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=String(text);return el;};
export function routineIdentityCard(snapshot,identity=null){
  const card=node('section','');card.className='card';card.setAttribute('aria-label','Identidad histórica de rutina');
  card.append(node('h3','Rutina usada'),node('p',`${snapshot.name} · versión ${snapshot.routine_version}`),node('p',`ID lógico: ${snapshot.routine_id}`),node('p',`Estado del template: ${identity?.state??'histórico'}`));
  const details=node('details','');details.append(node('summary','Prescripción histórica'),node('pre',JSON.stringify(snapshot,null,2)));card.append(details);return card;
}
export function routineListView(rows){
  const section=node('section','');section.className='card';section.setAttribute('aria-label','Rutinas V3 disponibles');section.append(node('h3','Rutinas V3'));
  const list=node('ul','');for(const template of rows){const row=node('li',`${template.name} · ${template.is_active?'activa':'inactiva'} · ${template.conflicts.length?'conflicto pendiente':'sin conflictos abiertos'}`);row.append(node('p',`ID: ${template.id}`),node('p',`Versiones: ${template.versions.map(version=>version.version_number).join(', ')||'ninguna'}`));list.append(row);}section.append(list);return section;
}
