// Published default routine version 2. Version 1 remains sourced from plan.js,
// which is frozen: its deterministic ids are already synced, so never edit it.
// V3 stores one numeric target_rir; ranges use their conservative upper bound
// here and retain the full coaching cue in notes.
const exercise=(stable_key,sets,min,max,target_rir,rest,notes='',measurement_kind='reps')=>({
  stable_key,sets,min,max,target_rir,rest,notes,measurement_kind
});

// Load step (kg) per exercise and day. These are the exact values version 2 was
// published with (originally read from plan.js v1); explicit so v2 no longer
// depends on v1. Anything not listed progresses by 0 (no automatic load step).
export const V64_LOAD_STEPS=Object.freeze({
  2:{'sentadilla-prensa':2.5,'peso-muerto-rumano':2.5,'press-banca':2.5,'dominadas-jalon':2.5,'zancada-bulgara':2,'elevacion-gemelos':2.5},
  4:{'press-inclinado-mancuernas':2,'remo':2.5,'press-militar':2,'dominadas-jalon':2.5,'curl-femoral':2.5},
  5:{}
});
export const v64LoadStep=(dayIndex,stableKey)=>V64_LOAD_STEPS[dayIndex]?.[stableKey]??0;

export const WEEKLY_PROGRAM_V64=Object.freeze({
  2:{label:'Fuerza principal',exercises:[
    exercise('sentadilla-prensa',3,5,8,3,150,'RIR 2–3'),
    exercise('peso-muerto-rumano',2,6,8,3,150,'RIR 2–3'),
    exercise('press-banca',3,6,10,2,120),
    exercise('dominadas-jalon',3,6,10,2,90),
    exercise('zancada-bulgara',2,8,10,3,90,'Por pierna'),
    exercise('elevacion-gemelos',3,10,15,3,75,'RIR 2–3'),
    exercise('plancha-pallof',3,30,45,null,60,'Técnica, sin fallo','seconds')
  ]},
  4:{label:'Tren superior + hombros + prevención',exercises:[
    exercise('press-inclinado-mancuernas',3,8,12,3,90,'RIR 2–3'),
    exercise('remo',3,8,12,3,90,'RIR 2–3'),
    exercise('press-militar',2,8,10,3,90,'RIR 2–3'),
    exercise('dominadas-jalon',2,8,12,3,90,'RIR 2–3'),
    exercise('elevacion-lateral',3,12,20,3,60,'RIR 2–3'),
    exercise('pajaros-mancuernas',2,12,20,3,60,'RIR 2–3'),
    exercise('curl-biceps-barra',2,8,12,3,60,'RIR 2–3'),
    exercise('extension-triceps-polea',2,8,12,3,60,'RIR 2–3'),
    exercise('curl-femoral',2,8,12,3,75),
    exercise('copenhagen-plank',2,20,30,null,60,'Por lado · técnica, sin fallo','seconds')
  ]},
  5:{label:'Activación prepartido',exercises:[
    exercise('movilidad-prepartido',1,300,480,null,30,'Tobillo/cadera/aductores · técnica','seconds'),
    exercise('sentadilla-ligera',2,5,5,5,90,'RIR 4–5 · baja fatiga'),
    exercise('saltos-verticales',2,3,3,null,120,'Máxima calidad; detener ante caída de velocidad o técnica'),
    exercise('press-banca-ligero',1,5,5,5,75,'RIR 4–5 · baja fatiga'),
    exercise('remo',1,8,8,5,60,'RIR 4–5 · baja fatiga')
  ]}
});

// Routine version 3: adds plyometrics where they fit the match week. Tuesday
// (match in 4 days) opens with low/moderate jumps while fresh; Thursday (2
// days out) keeps only low/moderate contacts plus lateral work. Friday stays v2.
const withPlyo=(day,items)=>Object.freeze({...WEEKLY_PROGRAM_V64[day],exercises:Object.freeze([...items,...WEEKLY_PROGRAM_V64[day].exercises])});
export const WEEKLY_PROGRAM_V3=Object.freeze({
  2:withPlyo(2,[
    exercise('salto-cajon',3,4,4,null,90,'Plio baja · aterrizaje suave, subir y bajar caminando'),
    exercise('salto-longitud',3,3,3,null,120,'Plio media · máxima calidad, frenar estable')
  ]),
  4:withPlyo(4,[
    exercise('pogo-saltos',2,10,10,null,60,'Plio baja · tobillos rígidos, contacto corto'),
    exercise('saltos-laterales',2,3,3,null,75,'Plio media · por lado, frenar y estabilizar rodilla')
  ])
});
export const ROUTINE_PROGRAMS=Object.freeze([[2,WEEKLY_PROGRAM_V64],[3,WEEKLY_PROGRAM_V3]]);
export const latestRoutineVersion=dayIndex=>Math.max(...ROUTINE_PROGRAMS.filter(([,program])=>program[dayIndex]).map(([version])=>version));
