const number=value=>value===''||value==null?NaN:Number(value);
const inRange=(value,min,max)=>Number.isFinite(number(value))&&number(value)>=min&&number(value)<=max;
const integerInRange=(value,min,max)=>inRange(value,min,max)&&Number.isInteger(number(value));
const result=(valid,message='',value=null)=>({valid,message,value});

export function validateWorkout(exercise,sets=[]){
  const meaningful=sets.filter(set=>hasWorkoutInput(set));
  if(!String(exercise?.name||exercise||'').trim()||!meaningful.length)return result(false,'Cargá al menos una serie antes de guardar.');
  for(const [index,set] of meaningful.entries()){
    if(set.kg!==''&&!inRange(set.kg,0,1000))return result(false,`Serie ${index+1}: el peso debe estar entre 0 y 1000 kg.`);
    if(!integerInRange(set.reps,1,500))return result(false,`Serie ${index+1}: las repeticiones o segundos deben ser un entero entre 1 y 500.`);
    if(!inRange(set.rir,0,5))return result(false,`Serie ${index+1}: el RIR debe estar entre 0 y 5.`);
  }
  return result(true,'',{sets:meaningful.map(set=>({...set,kg:set.kg===''?'':Number(set.kg),reps:Number(set.reps),rir:Number(set.rir),done:!!set.done}))});
}

export function hasWorkoutInput(set){return !!set&&(set.done||(set.kg!==''&&set.kg!=null)||(set.reps!==''&&set.reps!=null)||(set.rir!==''&&set.rir!=null));}

export function validateReadiness(input){
  if(!integerInRange(input.sleep,1,5)||!integerInRange(input.energy,1,5)||!integerInRange(input.fatigue,1,5)||!integerInRange(input.pain,0,10))return result(false,'Sueño, energía y frescura deben estar entre 1 y 5; dolor entre 0 y 10.');
  return result(true,'',input);
}

export function validateFootball(input){
  if(!integerInRange(input.duration,1,600))return result(false,'La duración debe ser un número entero entre 1 y 600 minutos.');
  if(!inRange(input.rpe,1,10))return result(false,'El RPE debe estar entre 1 y 10.');
  if(!integerInRange(input.minutes,0,600))return result(false,'Los minutos jugados deben estar entre 0 y 600.');
  if(number(input.minutes)>number(input.duration))return result(false,'Los minutos jugados no pueden superar la duración de la sesión.');
  return result(true,'',input);
}

export function validateMatch(input){
  if(!integerInRange(input.energy,1,5)||!integerInRange(input.legs,1,5)||!integerInRange(input.performance,1,5))return result(false,'Energía, frescura de piernas y rendimiento deben estar entre 1 y 5.');
  return result(true,'',input);
}

export function validateSessionSummary(input){
  if(!integerInRange(input.duration,1,1440))return result(false,'La duración de la sesión debe estar entre 1 y 1440 minutos.');
  if(!inRange(input.rpe,1,10))return result(false,'El RPE de la sesión debe estar entre 1 y 10.');
  return result(true,'',input);
}
