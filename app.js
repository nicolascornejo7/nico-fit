const plan = {
  1:{name:'Lunes',type:'Fútbol',label:'Entrenamiento con el equipo',intensity:'Media/Alta',exercises:[]},
  2:{name:'Martes',type:'Gimnasio',label:'Fuerza principal',intensity:'Alta',exercises:[
    ['Sentadilla o prensa','3–4 × 5–8'],['Peso muerto rumano','3 × 6–8'],['Press banca','3 × 6–10'],['Dominadas o jalón','3 × 6–10'],['Zancada búlgara','3 × 8 por pierna'],['Elevación de gemelos','3 × 10–15'],['Plancha / Pallof press','3 × 30–45 s']
  ]},
  3:{name:'Miércoles',type:'Fútbol',label:'Práctica amistosa F11',intensity:'Alta',exercises:[]},
  4:{name:'Jueves',type:'Gimnasio',label:'Tren superior + prevención',intensity:'Media',exercises:[
    ['Press inclinado con mancuernas','3 × 8–12'],['Remo','3 × 8–12'],['Press militar','3 × 8–10'],['Dominadas / jalón','3 × 8–12'],['Curl femoral','2–3 × 8–12'],['Copenhagen plank','2–3 × 20–30 s por lado'],['Nordic curl','2 × 4–6'],['Core','2–3 series']
  ]},
  5:{name:'Viernes',type:'Gimnasio',label:'Activación prepartido',intensity:'Baja',exercises:[
    ['Movilidad tobillo/cadera/aductores','5–8 min'],['Sentadilla ligera','2 × 5'],['Peso muerto rumano ligero','2 × 6'],['Saltos verticales','3 × 3'],['Press banca ligero','2–3 × 5'],['Remo','2 × 8'],['Gemelos','2 × 10'],['Core','2 series']
  ]},
  6:{name:'Sábado',type:'Partido',label:'Partido Fútbol 11',intensity:'Máxima',exercises:[]},
  0:{name:'Domingo',type:'Descanso',label:'Descanso',intensity:'—',exercises:[]}
};
const storeKey='gymFutbolAppV1';
let data=JSON.parse(localStorage.getItem(storeKey)||'{"readiness":[],"workouts":[],"matches":[]}');
const today=new Date(); const day=today.getDay(); const todayPlan=plan[day];
const dateKey=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
function save(){localStorage.setItem(storeKey,JSON.stringify(data)); renderStats();}
function renderToday(){document.getElementById('todayCard').innerHTML=`<p class="eyebrow">HOY · ${todayPlan.name.toUpperCase()}</p><h2 style="margin:6px 0">${todayPlan.label}</h2><p class="muted">${todayPlan.type} · Intensidad ${todayPlan.intensity}</p>`;}
function renderWeek(){const order=[1,2,3,4,5,6,0];document.getElementById('weekGrid').innerHTML=order.map(d=>`<div class="day ${d===day?'active':''}"><strong>${plan[d].name}</strong><span>${plan[d].label}</span></div>`).join('');}
function renderWorkout(){const sec=document.getElementById('workoutSection'); const list=document.getElementById('exerciseList');
  document.getElementById('workoutTitle').textContent=todayPlan.type==='Gimnasio'?todayPlan.label:'Entrenamiento de hoy';document.getElementById('workoutTag').textContent=todayPlan.intensity;
  if(todayPlan.type!=='Gimnasio'){list.innerHTML=`<p class="muted">Hoy no hay rutina de gimnasio cargada. Registrá tu estado y priorizá la sesión de ${todayPlan.type.toLowerCase()}.</p>`;return;}
  list.innerHTML=todayPlan.exercises.map((e,i)=>`<div class="exercise" data-ex="${i}"><h3>${e[0]}</h3><div class="prescription">Objetivo: ${e[1]} · Dejando 1–3 repeticiones en reserva.</div>${[1,2,3].map(s=>`<div class="set-row"><span>S${s}</span><input type="number" step="0.5" placeholder="kg" data-f="kg"><input type="number" placeholder="reps" data-f="reps"><input type="number" min="0" max="5" placeholder="RIR" data-f="rir"><button type="button" onclick="this.textContent='✓'">✓</button></div>`).join('')}<button class="ghost exercise-done" onclick="finishExercise(${i})">Guardar ejercicio</button></div>`).join('');}
window.finishExercise=function(i){const box=document.querySelector(`[data-ex="${i}"]`);const rows=[...box.querySelectorAll('.set-row')].map(r=>{const ins=r.querySelectorAll('input');return {kg:ins[0].value,reps:ins[1].value,rir:ins[2].value};});data.workouts.push({date:dateKey,day:todayPlan.name,exercise:todayPlan.exercises[i][0],sets:rows});box.classList.add('done');save();}
function bindRange(id){const el=document.getElementById(id),v=document.getElementById(id+'Val'); if(el&&v)el.addEventListener('input',()=>v.textContent=el.value)}
['sleep','energy','fatigue','pain','matchEnergy','legs','performance'].forEach(bindRange);
document.getElementById('saveReadiness').onclick=()=>{const rec={date:dateKey,sleep:+sleep.value,energy:+energy.value,fatigue:+fatigue.value,pain:+pain.value};data.readiness=data.readiness.filter(x=>x.date!==dateKey);data.readiness.push(rec);const score=(rec.sleep+rec.energy+(6-rec.fatigue))/3;let msg='Estado adecuado: mantené el plan previsto.';if(rec.pain>=5)msg='Hay dolor relevante: evitá forzar la zona y considerá una evaluación profesional si persiste.';else if(score<2.5)msg='Fatiga alta: hoy conviene reducir aproximadamente 20–30% el volumen o priorizar recuperación.';else if(score<3.3)msg='Estado intermedio: mantené intensidad moderada y evitá llegar al fallo.';document.getElementById('readinessAdvice').textContent=msg;save();}
if(day===6){document.getElementById('matchSection').classList.remove('hidden');}
document.getElementById('saveMatch').onclick=()=>{data.matches=data.matches.filter(x=>x.date!==dateKey);data.matches.push({date:dateKey,energy:+matchEnergy.value,legs:+legs.value,performance:+performance.value,notes:matchNotes.value});save();alert('Partido guardado');}
document.getElementById('resetBtn').onclick=()=>{if(confirm('¿Borrar todos los registros guardados en este dispositivo?')){localStorage.removeItem(storeKey);location.reload();}}
function renderStats(){document.getElementById('workoutCount').textContent=data.workouts.length;document.getElementById('matchCount').textContent=data.matches.length;const avg=data.readiness.length?(data.readiness.reduce((a,r)=>a+(r.sleep+r.energy+(6-r.fatigue))/3,0)/data.readiness.length).toFixed(1):'—';document.getElementById('avgReadiness').textContent=avg;const items=[...data.matches.map(m=>({date:m.date,title:'Partido',detail:`Piernas ${m.legs}/5 · Rendimiento ${m.performance}/5`})),...data.workouts.map(w=>({date:w.date,title:w.exercise,detail:w.day}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);document.getElementById('history').innerHTML=items.length?items.map(x=>`<div class="history-item"><strong>${x.title}</strong><span>${x.date} · ${x.detail}</span></div>`).join(''):'<p class="muted">Todavía no hay registros.</p>';}
renderToday();renderWeek();renderWorkout();renderStats();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker no disponible:', err));
  });
}
