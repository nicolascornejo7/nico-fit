export function productSyncStatus({authenticated=false,online=true,runtimeAuthorized=false,syncEnabled=true,queue=0,conflicts=0,failed=0,lastError=null}={}){
  if(!authenticated)return {kind:'local',text:'Solo local',reason:'signed_out'};
  if(!online)return {kind:'local',text:'Sin conexión · guardado local',reason:'offline'};
  if(!runtimeAuthorized)return {kind:'error',text:'Error de configuración de sincronización',reason:'runtime'};
  if(!syncEnabled)return {kind:'local',text:'Sincronización pausada',reason:'disabled'};
  if(conflicts>0)return {kind:'error',text:`${conflicts} conflicto${conflicts===1?'':'s'} de sincronización`,reason:'conflict'};
  if(failed>0)return {kind:'error',text:`${failed} ${failed===1?'operación fallida':'operaciones fallidas'} de sincronización`,reason:'failed'};
  if(lastError)return {kind:'error',text:'Error de sincronización',reason:'error'};
  if(queue>0)return {kind:'pending',text:'Pendiente de sincronizar',reason:'queue'};
  return {kind:'synced',text:'Sincronizado',reason:'clean'};
}
