import {stableClientUuid} from './import-v2.js';

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
  ['curl-biceps-barra','Curl de bíceps con barra','reps','Bíceps','upper'],
  ['curl-martillo','Curl martillo','reps','Bíceps','upper'],
  ['fondos-triceps','Fondos de tríceps','reps','Tríceps','upper'],
  ['extension-triceps-polea','Extensión de tríceps en polea','reps','Tríceps','upper'],
  ['plancha-pallof','Plancha / Pallof press','seconds','Core','core'],
  ['rueda-abdominal','Rueda abdominal','reps','Core','core']
].map(([stable_key,canonical_name,measurement_kind,category,body_region])=>Object.freeze({stable_key,canonical_name,measurement_kind,metadata:Object.freeze({source:'v3-base-catalog',category,body_region})})));

export const baseCatalogId=(userId,stableKey)=>stableClientUuid(`v3:base-catalog:${userId}:${stableKey}`);
