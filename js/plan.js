export const plan = {
  1:{name:'Lunes',type:'Fútbol',label:'Entrenamiento con el equipo',intensity:'Media/Alta',exercises:[]},
  2:{name:'Martes',type:'Gimnasio',label:'Fuerza principal',intensity:'Alta',exercises:[
    {id:'sentadilla-prensa',name:'Sentadilla o prensa',rx:'3 × 5–8',sets:3,min:5,max:8,rest:150,step:2.5},
    {id:'peso-muerto-rumano',name:'Peso muerto rumano',rx:'3 × 6–8',sets:3,min:6,max:8,rest:150,step:2.5},
    {id:'press-banca',name:'Press banca',rx:'3 × 6–10',sets:3,min:6,max:10,rest:120,step:2.5},
    {id:'dominadas-jalon',name:'Dominadas o jalón',rx:'3 × 6–10',sets:3,min:6,max:10,rest:90,step:2.5},
    {id:'zancada-bulgara',name:'Zancada búlgara',rx:'3 × 8 por pierna',sets:3,min:8,max:10,rest:90,step:2},
    {id:'elevacion-gemelos',name:'Elevación de gemelos',rx:'3 × 10–15',sets:3,min:10,max:15,rest:75,step:2.5},
    {id:'plancha-pallof',name:'Plancha / Pallof press',rx:'3 × 30–45 s',sets:3,min:30,max:45,rest:60,step:0}
  ]},
  3:{name:'Miércoles',type:'Fútbol',label:'Práctica amistosa F11',intensity:'Alta',exercises:[]},
  4:{name:'Jueves',type:'Gimnasio',label:'Tren superior + prevención',intensity:'Media',exercises:[
    {id:'press-inclinado-mancuernas',name:'Press inclinado con mancuernas',rx:'3 × 8–12',sets:3,min:8,max:12,rest:90,step:2},
    {id:'remo',name:'Remo',rx:'3 × 8–12',sets:3,min:8,max:12,rest:90,step:2.5},
    {id:'press-militar',name:'Press militar',rx:'3 × 8–10',sets:3,min:8,max:10,rest:90,step:2},
    {id:'dominadas-jalon',name:'Dominadas / jalón',rx:'3 × 8–12',sets:3,min:8,max:12,rest:90,step:2.5},
    {id:'curl-femoral',name:'Curl femoral',rx:'2 × 8–12',sets:2,min:8,max:12,rest:75,step:2.5},
    {id:'copenhagen-plank',name:'Copenhagen plank',rx:'2 × 20–30 s por lado',sets:2,min:20,max:30,rest:60,step:0},
    {id:'nordic-curl',name:'Nordic curl',rx:'2 × 4–6',sets:2,min:4,max:6,rest:90,step:0},
    {id:'core',name:'Core',rx:'2 × 10–15',sets:2,min:10,max:15,rest:60,step:0}
  ]},
  5:{name:'Viernes',type:'Gimnasio',label:'Activación prepartido',intensity:'Baja',exercises:[
    {id:'movilidad-prepartido',name:'Movilidad tobillo/cadera/aductores',rx:'5–8 min',sets:1,min:5,max:8,rest:30,step:0},
    {id:'sentadilla-ligera',name:'Sentadilla ligera',rx:'2 × 5',sets:2,min:5,max:5,rest:90,step:0},
    {id:'peso-muerto-rumano-ligero',name:'Peso muerto rumano ligero',rx:'2 × 6',sets:2,min:6,max:6,rest:90,step:0},
    {id:'saltos-verticales',name:'Saltos verticales',rx:'3 × 3',sets:3,min:3,max:3,rest:75,step:0},
    {id:'press-banca-ligero',name:'Press banca ligero',rx:'2 × 5',sets:2,min:5,max:5,rest:75,step:0},
    {id:'remo',name:'Remo',rx:'2 × 8',sets:2,min:8,max:8,rest:60,step:0},
    {id:'elevacion-gemelos',name:'Gemelos',rx:'2 × 10',sets:2,min:10,max:10,rest:60,step:0},
    {id:'core',name:'Core',rx:'2 series',sets:2,min:8,max:12,rest:45,step:0}
  ]},
  6:{name:'Sábado',type:'Partido',label:'Partido Fútbol 11',intensity:'Máxima',exercises:[]},
  0:{name:'Domingo',type:'Descanso',label:'Descanso',intensity:'—',exercises:[]}
};

export function localDateKey(d=new Date()) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
export function daysUntilSaturday(d=new Date()) { return (6 - d.getDay() + 7) % 7; }
