const LEGS=new Set(['sentadilla-prensa','peso-muerto-rumano','zancada-bulgara','elevacion-gemelos','curl-femoral','copenhagen-plank','nordic-curl','sentadilla-ligera','peso-muerto-rumano-ligero','saltos-verticales','movilidad-prepartido']);

// A conservative classification used only by Coach signals. It is intentionally
// not a muscle model and unknown/custom exercises remain unknown.
export function exerciseFamily(catalog){
  const region=catalog?.metadata?.body_region;
  if(['legs','upper','core'].includes(region))return region;
  return LEGS.has(catalog?.stable_key)?'legs':'unknown';
}

export const isLegExercise=catalog=>exerciseFamily(catalog)==='legs';
