// Plate calculator: greedy per-side loading from the heaviest plate down.
export const DEFAULT_PLATES=Object.freeze([25,20,15,10,5,2.5,1.25]);
export const BAR_OPTIONS=Object.freeze([[20,'Barra olímpica 20 kg'],[15,'Barra 15 kg'],[10,'Barra corta 10 kg'],[0,'Sin barra (máquina)']]);
const BARBELL_EQUIPMENT=new Set(['barbell','trap_bar']);

export function usesBarbell(profile){return !!profile?.equipment?.some(item=>BARBELL_EQUIPMENT.has(item));}

export function platesPerSide(target,{bar=20,plates=DEFAULT_PLATES}={}){
  const total=Number(target);
  if(!Number.isFinite(total)||total<=0)return {valid:false,reason:'Ingresá un peso.'};
  if(total<bar)return {valid:false,reason:`El peso es menor que la barra (${bar} kg).`};
  let remaining=Math.round((total-bar)/2*1000)/1000;const perSide=[];
  for(const plate of [...plates].sort((a,b)=>b-a)){while(remaining+1e-9>=plate){perSide.push(plate);remaining=Math.round((remaining-plate)*1000)/1000;}}
  const loaded=Math.round((bar+perSide.reduce((sum,plate)=>sum+plate,0)*2)*1000)/1000;
  return {valid:true,bar,perSide,loaded,exact:remaining===0,missing:Math.round(remaining*2*1000)/1000};
}

export function describePlates(result){
  if(!result.valid)return result.reason;
  const counts=new Map();for(const plate of result.perSide)counts.set(plate,(counts.get(plate)??0)+1);
  const list=[...counts].map(([plate,count])=>`${count}×${String(plate).replace('.',',')}`).join(' + ');
  const base=result.perSide.length?`Por lado: ${list} kg`:'Solo la barra';
  return result.exact?base:`${base} · total ${String(result.loaded).replace('.',',')} kg (faltan ${String(result.missing).replace('.',',')} kg)`;
}
