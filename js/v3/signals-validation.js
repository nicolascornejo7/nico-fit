import {dateStamp} from './coach-signals.js';
import {optionalNumber,requiredText} from './training-validation.js';

const number=(value,label,min,max,integer=false,required=false)=>{const result=optionalNumber(value,label,{min,max,integer});if(required&&result==null)throw new Error(`${label} obligatorio.`);return result;};
export function validateSignal(entity,input){
  if(!Number.isFinite(dateStamp(input.local_date)))throw new Error('Fecha local inválida.');
  const result={local_date:input.local_date};
  // Empty notes are valid; requiredText is reserved for non-empty text.
  result.notes=input.notes==null||input.notes===''?'':requiredText(input.notes,'Notas',4000);
  if(entity==='daily_readiness')Object.assign(result,{sleep:number(input.sleep,'Sueño',1,5,true,true),energy:number(input.energy,'Energía',1,5,true,true),freshness:number(input.freshness,'Frescura',1,5,true,true),pain:number(input.pain,'Dolor',0,10,true,true),pain_area:input.pain_area?requiredText(input.pain_area,'Zona de dolor',200):''});
  else if(entity==='football_sessions'){
    if(!['training','friendly','match'].includes(input.session_type))throw new Error('Tipo de fútbol inválido.');
    Object.assign(result,{session_type:input.session_type,duration_minutes:number(input.duration_minutes,'Duración',1,600,false,true),rpe:number(input.rpe,'RPE',1,10,false,true),minutes_played:number(input.minutes_played,'Minutos jugados',0,600,true)});
    if(result.minutes_played>result.duration_minutes)throw new Error('Minutos jugados exceden duración.');result.calculated_load=result.duration_minutes*result.rpe;
  }else if(entity==='match_reviews')Object.assign(result,{football_session_id:input.football_session_id??null,energy:number(input.energy,'Energía',1,5,true,true),legs:number(input.legs,'Piernas',1,5,true,true),performance:number(input.performance,'Rendimiento',1,5,true,true),rpe:number(input.rpe,'RPE',1,10),minutes_played:number(input.minutes_played,'Minutos',0,600,true)});
  else throw new Error('Entidad de señales inválida.');
  return result;
}
