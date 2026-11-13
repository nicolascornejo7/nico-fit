// In-house front/back muscle map (no third-party art): each exercise profile's
// primary muscles are drawn crimson and secondary muscles pink. Shapes are a
// stylised diagram, not anatomy; they only tell the athlete what is working.
import {exerciseProfile} from './exercise-recommendations.js';

export const MUSCLE_NAMES=Object.freeze({chest:'Pecho',upper_back:'Espalda alta',lats:'Dorsales',deltoids:'Hombros',front_deltoids:'Deltoides anterior',rear_deltoids:'Deltoides posterior',biceps:'Bíceps',brachialis:'Braquial',triceps:'Tríceps',forearms:'Antebrazos',core:'Core',obliques:'Oblicuos',erectors:'Lumbares',quadriceps:'Cuádriceps',hamstrings:'Isquios',glutes:'Glúteos',adductors:'Aductores',calves:'Gemelos',hips:'Cadera',ankles:'Tobillos'});

// Which drawn regions light up for each profile muscle.
const REGIONS=Object.freeze({chest:['chest'],upper_back:['traps'],lats:['lats'],deltoids:['front_delts','rear_delts'],front_deltoids:['front_delts'],rear_deltoids:['rear_delts'],biceps:['biceps'],brachialis:['biceps'],triceps:['triceps'],forearms:['forearms_front','forearms_back'],core:['abs'],obliques:['obliques'],erectors:['erectors'],quadriceps:['quads'],hamstrings:['hamstrings'],glutes:['glutes'],adductors:['adductors'],calves:['calves_front','calves_back'],hips:['adductors','glutes'],ankles:['calves_front']});

// [region, shape, attributes] mirrored left/right where it applies.
const pair=(region,cx,cy,rx,ry)=>[[region,'ellipse',{cx:50-cx,cy,rx,ry}],[region,'ellipse',{cx:50+cx,cy,rx,ry}]];
const FRONT=[
  ...pair('front_delts',20,42,7,6),...pair('chest',8,51,8,7),...pair('biceps',26,63,5,9),...pair('forearms_front',30,85,4.5,10),
  ['abs','rect',{x:43,y:59,width:14,height:34,rx:5}],...pair('obliques',11,76,3,10),
  ['adductors','ellipse',{cx:50,cy:106,rx:5,ry:8}],...pair('quads',9,127,7.5,19),...pair('calves_front',9,166,4.5,13)
];
const BACK=[
  ['traps','ellipse',{cx:50,cy:45,rx:13,ry:9}],...pair('rear_delts',20,42,7,6),...pair('lats',11,65,7,13),...pair('triceps',26,63,5,9),...pair('forearms_back',30,85,4.5,10),
  ['erectors','rect',{x:46,y:62,width:8,height:30,rx:4}],...pair('glutes',8,104,8.5,9),...pair('hamstrings',9,129,7.5,17),...pair('calves_back',9,164,6,13)
];
const SILHOUETTE=[['circle',{cx:50,cy:15,r:9}],['rect',{x:46,y:23,width:8,height:8,rx:3}],['rect',{x:31,y:34,width:38,height:62,rx:14}],['rect',{x:17,y:38,width:14,height:58,rx:7}],['rect',{x:69,y:38,width:14,height:58,rx:7}],['rect',{x:33,y:92,width:34,height:20,rx:10}],['rect',{x:32,y:104,width:16,height:86,rx:8}],['rect',{x:52,y:104,width:16,height:86,rx:8}]];

// Muscles a custom exercise can declare, with the body region the Coach uses.
export const CUSTOM_MUSCLES=Object.freeze(['chest','upper_back','lats','deltoids','rear_deltoids','biceps','triceps','forearms','core','erectors','quadriceps','hamstrings','glutes','adductors','calves']);
const LEG_MUSCLES=new Set(['quadriceps','hamstrings','glutes','adductors','calves']),CORE_MUSCLES=new Set(['core','erectors']);
export function customExerciseMetadata({primaryMuscle,secondaryMuscle}={}){
  if(!primaryMuscle)return {custom:true};
  if(!CUSTOM_MUSCLES.includes(primaryMuscle)||secondaryMuscle&&!CUSTOM_MUSCLES.includes(secondaryMuscle))throw new Error('Músculo inválido.');
  const body_region=LEG_MUSCLES.has(primaryMuscle)?'legs':CORE_MUSCLES.has(primaryMuscle)?'core':'upper';
  return {custom:true,category:MUSCLE_NAMES[primaryMuscle],body_region,movement_pattern:`custom:${primaryMuscle}`,primary_muscles:[primaryMuscle],secondary_muscles:secondaryMuscle&&secondaryMuscle!==primaryMuscle?[secondaryMuscle]:[],equipment:['unspecified'],laterality:'bilateral',role:'accessory',fatigue:2};
}

export const MUSCLE_COLORS=Object.freeze({primary:'#e5243b',secondary:'#ff8c98',idle:'#3a3a40',body:'#232327'});

export function muscleHighlights(catalogOrProfile){
  const profile=catalogOrProfile?.primary_muscles?catalogOrProfile:exerciseProfile(catalogOrProfile);
  if(!profile)return null;
  const regions=new Map();
  for(const muscle of profile.secondary_muscles||[])for(const region of REGIONS[muscle]||[])regions.set(region,'secondary');
  for(const muscle of profile.primary_muscles||[])for(const region of REGIONS[muscle]||[])regions.set(region,'primary');
  const names=list=>[...new Set((list||[]).map(muscle=>MUSCLE_NAMES[muscle]).filter(Boolean))];
  return {regions,primary:names(profile.primary_muscles),secondary:names(profile.secondary_muscles).filter(name=>!names(profile.primary_muscles).includes(name))};
}

function shape(doc,ns,tag,attrs,fill){const node=doc.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));node.setAttribute('fill',fill);return node;}

// Returns an <svg> (or null when the DOM cannot build SVG, e.g. in tests).
export function muscleMapSvg(catalogOrProfile,{doc=globalThis.document}={}){
  const highlights=muscleHighlights(catalogOrProfile);
  if(!highlights||typeof doc?.createElementNS!=='function')return null;
  const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 210 200');svg.setAttribute('class','v3-muscle-map');svg.setAttribute('role','img');
  svg.setAttribute('aria-label',`Músculos: ${highlights.primary.join(', ')||'sin datos'}${highlights.secondary.length?`; secundarios: ${highlights.secondary.join(', ')}`:''}`);
  for(const [offset,regions] of [[0,FRONT],[110,BACK]]){
    const group=doc.createElementNS(ns,'g');group.setAttribute('transform',`translate(${offset} 0)`);
    for(const [tag,attrs] of SILHOUETTE)group.append(shape(doc,ns,tag,attrs,MUSCLE_COLORS.body));
    for(const [region,tag,attrs] of regions){const level=highlights.regions.get(region);group.append(shape(doc,ns,tag,attrs,level?MUSCLE_COLORS[level]:MUSCLE_COLORS.idle));}
    svg.append(group);
  }
  return svg;
}
