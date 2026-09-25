export function buildPwaUpdateDiagnostic(state,{buildId='unknown',now=()=>new Date()}={}){
  const safety=state?.safety||{};
  return {
    schemaVersion:1,
    build:String(buildId),
    capturedAt:now().toISOString(),
    pendingUpdate:!!state?.pending,
    staleTab:!!state?.stale,
    deferred:!!state?.deferred,
    prepared:!!state?.prepared,
    canUpdate:!!state?.canUpdate,
    safety:{
      safe:!!safety.safe,
      blockers:{...(safety.blockers||{})},
      observations:{...(safety.observations||{})},
      reasons:[...(safety.reasons||[])]
    },
    version:{
      appBuildId:state?.version?.appBuildId||null,
      activeBuildId:state?.version?.activeBuildId||null,
      waitingBuildId:state?.version?.waitingBuildId||null,
      mismatch:!!state?.version?.mismatch
    }
  };
}
