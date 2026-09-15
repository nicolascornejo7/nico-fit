export function requiredText(value,label,max=200){
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`${label}: texto requerido (máximo ${max}).`);
  return value.trim();
}

export function optionalNumber(value,label,{min=0,max=1000,integer=false,decimals=1}={}){
  if(value==null||value==='')return null;
  if(typeof value==='boolean'||(typeof value==='string'&&!value.trim()))throw new Error(`${label}: número inválido.`);
  const number=Number(value);
  if(!Number.isFinite(number)||number<min||number>max||(integer&&!Number.isInteger(number))||Math.abs(number*10**decimals-Math.round(number*10**decimals))>1e-7)throw new Error(`${label}: valor fuera de rango.`);
  return number;
}

export function validateSet(input,measurementKind){
  if(!['reps','seconds','mixed'].includes(measurementKind))throw new Error('Unidad de ejercicio inválida.');
  if(typeof input.is_completed!=='boolean')throw new Error('La marca de completada debe ser booleana.');
  const value={
    load_kg:optionalNumber(input.load_kg,'Carga',{decimals:3}),
    reps:optionalNumber(input.reps,'Reps',{min:1,max:500,integer:true}),
    duration_seconds:optionalNumber(input.duration_seconds,'Segundos',{min:1,max:86400,integer:true}),
    rir:optionalNumber(input.rir,'RIR',{max:5}),is_completed:input.is_completed
  };
  if(value.reps!=null&&value.duration_seconds!=null)throw new Error('Usá reps o segundos, no ambos.');
  if(measurementKind==='reps'&&value.duration_seconds!=null)throw new Error('Este ejercicio usa repeticiones.');
  if(measurementKind==='seconds'&&value.reps!=null)throw new Error('Este ejercicio usa segundos.');
  if(value.is_completed&&value.reps==null&&value.duration_seconds==null)throw new Error('Completá reps o segundos antes de marcar la serie.');
  if(value.load_kg==null&&value.reps==null&&value.duration_seconds==null&&value.rir==null)throw new Error('No se guarda una serie vacía.');
  return value;
}

export function validatePrescription(value={}){
  const mode=value.measurement_kind||'reps';
  if(!['reps','seconds','mixed'].includes(mode))throw new Error('Unidad inválida.');
  const result={
    ...structuredClone(value),measurement_kind:mode,
    sets:optionalNumber(value.sets??1,'Series objetivo',{min:1,max:100,integer:true}),
    min:optionalNumber(value.min,'Mínimo',{min:1,max:86400,integer:true}),
    max:optionalNumber(value.max,'Máximo',{min:1,max:86400,integer:true}),
    step:optionalNumber(value.step??0,'Incremento',{max:100,decimals:3})
  };
  if(result.min!=null&&result.max!=null&&result.min>result.max)throw new Error('El mínimo no puede superar el máximo.');
  return result;
}
