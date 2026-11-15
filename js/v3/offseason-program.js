// Off-season program: 4 hypertrophy days (upper/lower x2) plus 2 cardio days.
// Used only while the week mode is "off_season"; it lives in its own routine
// templates, so in-season routines, their versions and history stay untouched.
const exercise=(stable_key,sets,min,max,target_rir,rest,step,notes='',measurement_kind='reps')=>({stable_key,sets,min,max,target_rir,rest,step,notes,measurement_kind});

export const OFF_SEASON_PROGRAM=Object.freeze({
  1:{label:'Fuera de temporada · Tren superior A',exercises:[
    exercise('press-banca',4,6,8,2,150,2.5,'Fuerza-hipertrofia · RIR 1–2'),
    exercise('remo-barra',4,6,10,2,120,2.5),
    exercise('dominadas',3,6,10,2,120,2.5,'Con lastre si pasás el rango'),
    exercise('press-militar',3,8,10,2,90,2),
    exercise('elevacion-lateral',3,12,20,1,60,1),
    exercise('curl-biceps-barra',2,8,12,1,60,1),
    exercise('extension-triceps-polea',2,10,15,1,60,1)
  ]},
  2:{label:'Fuera de temporada · Tren inferior A',exercises:[
    exercise('salto-cajon',3,4,4,null,90,0,'Plio de mantenimiento · antes de cargar'),
    exercise('sentadilla-prensa',4,6,8,2,180,2.5,'Fuerza-hipertrofia · RIR 1–2'),
    exercise('peso-muerto-rumano',3,8,10,2,150,2.5),
    exercise('zancada-bulgara',3,8,12,2,90,2,'Por pierna'),
    exercise('curl-femoral',3,10,12,1,75,2.5),
    exercise('elevacion-gemelos',4,10,15,1,60,2.5),
    exercise('plancha-pallof',3,30,45,null,60,0,'Técnica, sin fallo','seconds')
  ]},
  4:{label:'Fuera de temporada · Tren superior B',exercises:[
    exercise('press-inclinado-mancuernas',4,8,12,2,90,2),
    exercise('jalon-al-pecho',4,8,12,2,90,2.5),
    exercise('remo-polea',3,10,12,1,90,2.5),
    exercise('press-arnold',3,10,12,2,90,2),
    exercise('face-pull',3,12,15,1,60,1),
    exercise('curl-martillo',3,10,12,1,60,1),
    exercise('press-frances',3,10,12,1,60,1)
  ]},
  5:{label:'Fuera de temporada · Tren inferior B',exercises:[
    exercise('pogo-saltos',2,10,10,null,60,0,'Plio baja de mantenimiento'),
    exercise('hip-thrust',4,8,12,2,120,2.5),
    exercise('peso-muerto-hexagonal',3,5,8,2,150,2.5),
    exercise('step-up',3,10,12,2,90,2,'Por pierna'),
    exercise('extension-cuadriceps',3,12,15,1,60,2.5),
    exercise('gemelos-sentado',3,12,15,1,60,2.5),
    exercise('aductor-maquina',2,12,15,2,60,2.5,'Prevención de aductores'),
    exercise('dead-bug',3,8,10,null,45,0)
  ]}
});

// Week layout shown in Hoy and Semana while off-season.
export const OFF_SEASON_WEEK=Object.freeze({
  1:{name:'Lunes',type:'Gimnasio',label:'Tren superior A',intensity:'Media/Alta',exercises:[]},
  2:{name:'Martes',type:'Gimnasio',label:'Tren inferior A',intensity:'Alta',exercises:[]},
  3:{name:'Miércoles',type:'Cardio',label:'Cardio suave 30–45 min (RPE 5)',intensity:'Baja',exercises:[]},
  4:{name:'Jueves',type:'Gimnasio',label:'Tren superior B',intensity:'Media',exercises:[]},
  5:{name:'Viernes',type:'Gimnasio',label:'Tren inferior B',intensity:'Media/Alta',exercises:[]},
  6:{name:'Sábado',type:'Cardio',label:'Intervalos 4×4 min o fútbol recreativo',intensity:'Alta',exercises:[]},
  0:{name:'Domingo',type:'Descanso',label:'Descanso',intensity:'—',exercises:[]}
});

// Monday without team training (in-season): replace the team session's
// conditioning and add upper body that does not repeat Tuesday, with no leg
// strength work so Tuesday's leg routine stays complete.
export const SOLO_MONDAY_PROGRAM=Object.freeze({
  1:{label:'Lunes sin equipo · Condición física + tren superior',exercises:[
    exercise('intervalos-cardio',4,240,240,null,180,0,'4 min a RPE 8, con 3 min suaves entre medio','seconds'),
    exercise('remo-barra',3,8,10,2,120,2.5),
    exercise('remo-polea',3,10,12,2,90,2.5),
    exercise('press-militar',3,8,10,2,90,2),
    exercise('cruce-poleas',3,12,15,2,60,1),
    exercise('elevacion-lateral',3,12,20,1,60,1),
    exercise('curl-martillo',2,10,12,1,60,1),
    exercise('extension-triceps-polea',2,10,15,1,60,1),
    exercise('plancha-pallof',3,30,45,null,60,0,'Técnica, sin fallo','seconds'),
    exercise('plancha-lateral',2,20,30,null,45,0,'Por lado','seconds'),
    exercise('dead-bug',2,8,10,null,45,0)
  ]}
});
export const SOLO_MONDAY_DAY=Object.freeze({name:'Lunes',type:'Gimnasio',label:'Sin equipo: condición física + tren superior',intensity:'Media',exercises:[]});

export const OFF_SEASON_DAYS=Object.freeze([1,2,4,5]);
export const IN_SEASON_DAYS=Object.freeze([2,4,5]);
export const gymDaysFor=(mode,{mondaySolo=false}={})=>mode==='off_season'?OFF_SEASON_DAYS:mondaySolo?[1,...IN_SEASON_DAYS]:IN_SEASON_DAYS;
