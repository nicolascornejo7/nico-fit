export const ROLLOUT_FLAG_NAMES=['v3_enabled','v3_storage_enabled','v3_signals_enabled','v3_routines_enabled','v3_training_enabled','v3_sync_enabled','v3_conflicts_enabled','v3_observability_enabled','v3_coach_enabled'];
export const EMPTY_FLAGS=Object.freeze(Object.fromEntries(ROLLOUT_FLAG_NAMES.map(name=>[name,false])));
const BUILD=/^nico-fit-v(\d+)$/;

export function buildNumber(value){const match=BUILD.exec(value||'');return match?Number(match[1]):null;}
export function validateRolloutConfig(row){
  if(!row||row.singleton_id!==true||!Number.isSafeInteger(row.config_version)||row.config_version<1||buildNumber(row.minimum_client_version)===null)throw new Error('Configuración de rollout inválida.');
  if(!Number.isFinite(Date.parse(row.updated_at)))throw new Error('Fecha de configuración inválida.');
  if(typeof row.maintenance_mode!=='boolean')throw new Error('Maintenance mode inválido.');
  for(const name of ROLLOUT_FLAG_NAMES)if(typeof row[name]!=='boolean')throw new Error(`Flag ${name} inválido.`);
  return Object.freeze({singleton_id:true,config_version:row.config_version,minimum_client_version:row.minimum_client_version,maintenance_mode:row.maintenance_mode,updated_at:new Date(row.updated_at).toISOString(),...Object.fromEntries(ROLLOUT_FLAG_NAMES.map(name=>[name,row[name]]))});
}

export function resolveRollout(config,{buildId,source='fallback',lastValidAt=null,fallbackMinimum=null,now=Date.now()}={}){
  const localBuild=buildNumber(buildId),minimum=buildNumber(config?.minimum_client_version??fallbackMinimum);
  const updateRequired=minimum!==null&&(localBuild===null||localBuild<minimum);
  const flags=Object.fromEntries(ROLLOUT_FLAG_NAMES.map(name=>[name,!!config&&!updateRequired&&!!config.v3_enabled&&!!config[name]]));
  const reason=updateRequired?'Actualización requerida: esta versión es anterior al mínimo permitido.':config?.maintenance_mode?'Mantenimiento: las operaciones remotas están pausadas.':!config?'No hay configuración remota válida; V3 permanece apagado.':!flags.v3_enabled?'V3 permanece desactivado.':!flags.v3_sync_enabled?'La sincronización V3 está pausada por el control remoto.':null;
  return {configVersion:config?.config_version??null,minimumClientVersion:config?.minimum_client_version??fallbackMinimum,maintenanceMode:!!config?.maintenance_mode,updateRequired,flags,remoteWritesAllowed:!!config&&!updateRequired&&!config.maintenance_mode&&flags.v3_sync_enabled,lastValidAt,cacheAgeMs:lastValidAt?Math.max(0,now-Date.parse(lastValidAt)):null,source,reason};
}
