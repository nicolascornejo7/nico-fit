// Explicit profiles for the stable V3 catalog keys. Existing synced catalog
// rows have only source/category/region metadata, so this read-only client map
// also characterizes them without editing the catalog or queuing sync writes.
const profile=(movement_pattern,primary_muscles,secondary_muscles,equipment,laterality,role,fatigue)=>Object.freeze({
  movement_pattern,primary_muscles,secondary_muscles,equipment,laterality,role,fatigue
});

export const EXERCISE_PROFILES=Object.freeze({
  'sentadilla-prensa':profile('knee_dominant',['quadriceps','glutes'],['hamstrings'],['barbell','machine'],'bilateral','main_strength',3),
  'sentadilla-ligera':profile('knee_dominant',['quadriceps','glutes'],['hamstrings'],['barbell','bodyweight'],'bilateral','activation',1),
  'zancada-bulgara':profile('knee_dominant',['quadriceps','glutes'],['hamstrings'],['dumbbell','bodyweight'],'unilateral','main_strength',2),
  'extension-cuadriceps':profile('knee_extension',['quadriceps'],[],['machine'],'bilateral','accessory',1),
  'peso-muerto-rumano':profile('hip_hinge',['hamstrings','glutes'],['erectors'],['barbell'],'bilateral','main_strength',3),
  'peso-muerto-rumano-ligero':profile('hip_hinge',['hamstrings','glutes'],['erectors'],['barbell','dumbbell'],'bilateral','activation',1),
  'curl-femoral':profile('knee_flexion',['hamstrings'],['calves'],['machine'],'bilateral','accessory',1),
  'nordic-curl':profile('knee_flexion',['hamstrings'],['calves'],['bodyweight'],'bilateral','prevention',3),
  'elevacion-gemelos':profile('calf_raise',['calves'],[],['machine','dumbbell','bodyweight'],'bilateral','accessory',1),
  'press-banca':profile('horizontal_press',['chest'],['triceps','front_deltoids'],['barbell'],'bilateral','main_strength',2),
  'press-banca-ligero':profile('horizontal_press',['chest'],['triceps','front_deltoids'],['barbell'],'bilateral','activation',1),
  'press-inclinado-mancuernas':profile('horizontal_press',['chest'],['front_deltoids','triceps'],['dumbbell'],'bilateral','main_strength',2),
  'aperturas-mancuernas':profile('chest_fly',['chest'],['front_deltoids'],['dumbbell'],'bilateral','accessory',1),
  'remo':profile('horizontal_pull',['upper_back','lats'],['biceps'],['unspecified'],'bilateral','main_strength',2),
  'remo-barra':profile('horizontal_pull',['upper_back','lats'],['biceps','erectors'],['barbell'],'bilateral','main_strength',2),
  'remo-mancuerna':profile('horizontal_pull',['upper_back','lats'],['biceps'],['dumbbell'],'unilateral','main_strength',2),
  'dominadas-jalon':profile('vertical_pull',['lats','upper_back'],['biceps'],['bodyweight','machine'],'bilateral','main_strength',2),
  'jalon-al-pecho':profile('vertical_pull',['lats','upper_back'],['biceps'],['machine'],'bilateral','main_strength',2),
  'press-militar':profile('vertical_press',['deltoids'],['triceps'],['barbell','dumbbell'],'bilateral','main_strength',2),
  'elevacion-lateral':profile('shoulder_abduction',['deltoids'],[],['dumbbell'],'bilateral','accessory',1),
  'pajaros-mancuernas':profile('horizontal_abduction',['rear_deltoids'],['upper_back'],['dumbbell'],'bilateral','accessory',1),
  'curl-biceps-barra':profile('elbow_flexion',['biceps'],['forearms'],['barbell'],'bilateral','accessory',1),
  'curl-martillo':profile('elbow_flexion',['biceps'],['brachialis','forearms'],['dumbbell'],'bilateral','accessory',1),
  'fondos-triceps':profile('dip',['triceps'],['chest','front_deltoids'],['bodyweight'],'bilateral','accessory',2),
  'extension-triceps-polea':profile('elbow_extension',['triceps'],[],['cable'],'bilateral','accessory',1),
  'plancha-pallof':profile('core_stability',['core'],['obliques'],['mat','cable'],'bilateral','prevention',1),
  'rueda-abdominal':profile('anti_extension',['core'],['lats'],['ab_wheel'],'bilateral','accessory',2),
  'core':profile('general_core',['core'],[],['unspecified'],'bilateral','accessory',1),
  'copenhagen-plank':profile('adductor_stability',['adductors'],['core'],['bodyweight'],'unilateral','prevention',2),
  'movilidad-prepartido':profile('mobility',['hips','ankles','adductors'],[],['bodyweight'],'bilateral','activation',1),
  'saltos-verticales':profile('vertical_jump',['quadriceps','glutes'],['calves'],['bodyweight'],'bilateral','power',2)
});

const muscleLabels={quadriceps:'cuádriceps',glutes:'glúteos',hamstrings:'isquios',chest:'pecho',lats:'dorsales',upper_back:'espalda alta',rear_deltoids:'deltoide posterior',biceps:'bíceps',triceps:'tríceps',deltoids:'hombros',calves:'gemelos',core:'core',adductors:'aductores'};
const explicitProfile=metadata=>metadata&&typeof metadata.movement_pattern==='string'&&Array.isArray(metadata.primary_muscles)&&metadata.primary_muscles.length&&Array.isArray(metadata.secondary_muscles)&&Array.isArray(metadata.equipment)&&['bilateral','unilateral'].includes(metadata.laterality)&&typeof metadata.role==='string'&&[1,2,3].includes(metadata.fatigue)?metadata:null;

export function exerciseProfile(item){return explicitProfile(item?.metadata)||EXERCISE_PROFILES[item?.stable_key]||null;}

function sharedPrimary(a,b){return a.primary_muscles.filter(muscle=>b.primary_muscles.includes(muscle));}
function equivalent(a,b){return a?.movement_pattern===b?.movement_pattern&&!!sharedPrimary(a,b).length;}
export function compatiblePrescription(current,alternative){
  const a=exerciseProfile(current),b=exerciseProfile(alternative);
  return !!a&&!!b&&equivalent(a,b)&&a.role===b.role&&a.laterality===b.laterality&&Math.abs(a.fatigue-b.fatigue)<=1&&current.measurement_kind===alternative.measurement_kind;
}

export function recommendedAlternatives(current,catalog){
  const source=exerciseProfile(current);if(!source)return [];
  return catalog.filter(item=>item.id!==current?.id&&!item.deleted_at&&item.measurement_kind===current.measurement_kind)
    .map(item=>{const candidate=exerciseProfile(item);if(!candidate||!equivalent(source,candidate))return null;
      const shared=sharedPrimary(source,candidate),muscleMatch=shared.length/Math.max(source.primary_muscles.length,candidate.primary_muscles.length);
      if(muscleMatch<0.5)return null;
      const alternateEquipment=!source.equipment.includes('unspecified')&&!candidate.equipment.includes('unspecified')&&!candidate.equipment.some(value=>source.equipment.includes(value));
      const score=100*muscleMatch+20*Number(source.role===candidate.role)+8*Number(source.laterality===candidate.laterality)+8*(3-Math.abs(source.fatigue-candidate.fatigue))+10*Number(alternateEquipment);
      return {exercise:item,score,reason:`Mismo patrón · ${shared.map(value=>muscleLabels[value]||value).join('/')}${alternateEquipment?' · otro equipo':''}`};
    }).filter(Boolean).sort((a,b)=>b.score-a.score||a.exercise.canonical_name.localeCompare(b.exercise.canonical_name,'es')).slice(0,3);
}
