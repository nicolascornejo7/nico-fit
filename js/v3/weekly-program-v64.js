// Published default routine version 2. Version 1 remains sourced from plan.js.
// V3 stores one numeric target_rir; ranges use their conservative upper bound
// here and retain the full coaching cue in notes.
const exercise=(stable_key,sets,min,max,target_rir,rest,notes='',measurement_kind='reps')=>({
  stable_key,sets,min,max,target_rir,rest,notes,measurement_kind
});

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
