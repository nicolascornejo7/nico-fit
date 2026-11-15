import {stableClientUuid} from './import-v2.js';
import {PLYO_CATALOG} from './plyometrics.js';

// This is a small, local-first starter catalog. It has stable keys but does not
// prescribe a routine or infer a user's past training.
export const BASE_EXERCISES=Object.freeze([
  ['sentadilla-prensa','Sentadilla o prensa','reps','Piernas','legs'],
  ['peso-muerto-rumano','Peso muerto rumano','reps','Piernas','legs'],
  ['zancada-bulgara','Zancada búlgara','reps','Piernas','legs'],
  ['curl-femoral','Curl femoral','reps','Piernas','legs'],
  ['extension-cuadriceps','Extensión de cuádriceps','reps','Piernas','legs'],
  ['elevacion-gemelos','Elevación de gemelos','reps','Piernas','legs'],
  ['press-banca','Press banca','reps','Pecho','upper'],
  ['press-inclinado-mancuernas','Press inclinado con mancuernas','reps','Pecho','upper'],
  ['aperturas-mancuernas','Aperturas con mancuernas','reps','Pecho','upper'],
  ['remo-barra','Remo con barra','reps','Espalda','upper'],
  ['jalon-al-pecho','Jalón al pecho','reps','Espalda','upper'],
  ['remo-mancuerna','Remo con mancuerna','reps','Espalda','upper'],
  ['press-militar','Press militar','reps','Hombros','upper'],
  ['elevacion-lateral','Elevación lateral','reps','Hombros','upper'],
  ['pajaros-mancuernas','Pájaros con mancuernas','reps','Hombros','upper'],
  ['curl-biceps-barra','Curl de bíceps con barra','reps','Bíceps','upper'],
  ['curl-martillo','Curl martillo','reps','Bíceps','upper'],
  ['fondos-triceps','Fondos de tríceps','reps','Tríceps','upper'],
  ['extension-triceps-polea','Extensión de tríceps en polea','reps','Tríceps','upper'],
  ['plancha-pallof','Plancha / Pallof press','seconds','Core','core'],
  ['rueda-abdominal','Rueda abdominal','reps','Core','core'],
  ['hip-thrust','Hip thrust','reps','Piernas','legs'],
  ['sentadilla-goblet','Sentadilla goblet','reps','Piernas','legs'],
  ['step-up','Step-up al cajón','reps','Piernas','legs'],
  ['peso-muerto-hexagonal','Peso muerto con barra hexagonal','reps','Piernas','legs'],
  ['peso-muerto-unilateral','Peso muerto a una pierna','reps','Piernas','legs'],
  ['gemelos-sentado','Gemelos sentado','reps','Piernas','legs'],
  ['aductor-maquina','Aductores en máquina','reps','Piernas','legs'],
  ['abductor-maquina','Abductores en máquina','reps','Piernas','legs'],
  ['extension-lumbar','Extensión lumbar','reps','Espalda','core'],
  ['press-mancuernas','Press con mancuernas','reps','Pecho','upper'],
  ['flexiones','Flexiones de brazos','reps','Pecho','upper'],
  ['cruce-poleas','Cruce de poleas','reps','Pecho','upper'],
  ['remo-polea','Remo en polea baja','reps','Espalda','upper'],
  ['face-pull','Face pull','reps','Hombros','upper'],
  ['dominadas','Dominadas','reps','Espalda','upper'],
  ['dominadas-supinas','Dominadas supinas','reps','Espalda','upper'],
  ['press-arnold','Press Arnold','reps','Hombros','upper'],
  ['elevacion-lateral-polea','Elevación lateral en polea','reps','Hombros','upper'],
  ['press-frances','Press francés','reps','Tríceps','upper'],
  ['curl-predicador','Curl predicador','reps','Bíceps','upper'],
  ['dead-bug','Dead bug','reps','Core','core'],
  ['plancha-lateral','Plancha lateral','seconds','Core','core'],
  ['intervalos-cardio','Intervalos (bici o cinta)','seconds','Cardio','legs'],
  ...PLYO_CATALOG.map(([key,name,category])=>[key,name,'reps',category,'legs'])
].map(([stable_key,canonical_name,measurement_kind,category,body_region])=>Object.freeze({stable_key,canonical_name,measurement_kind,metadata:Object.freeze({source:'v3-base-catalog',category,body_region})})));

export const baseCatalogId=(userId,stableKey)=>stableClientUuid(`v3:base-catalog:${userId}:${stableKey}`);
