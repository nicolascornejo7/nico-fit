export function sessionMetrics(snapshot,{now=Date.now()}={}){
  const exercises=snapshot.exercises.filter(ex=>!ex.deleted_at),completed=exercises.flatMap(ex=>ex.sets.filter(set=>!set.deleted_at&&set.is_completed));
  const perExercise={};
  for(const exercise of exercises){
    const key=exercise.exercise_catalog_id,metric=perExercise[key]||{catalogId:key,name:exercise.exercise_name_snapshot,completedSets:0,volume:0,maxLoad:null,reps:0,durationSeconds:0,estimated1RM:null};
    for(const set of exercise.sets.filter(item=>!item.deleted_at&&item.is_completed)){
      metric.completedSets++;metric.volume+=(set.load_kg??0)*(set.reps??0);metric.reps+=set.reps??0;metric.durationSeconds+=set.duration_seconds??0;
      if(set.load_kg!=null)metric.maxLoad=Math.max(metric.maxLoad??0,set.load_kg);
      if(set.load_kg>0&&set.reps>0&&set.reps<=12)metric.estimated1RM=Math.max(metric.estimated1RM??0,set.load_kg*(1+set.reps/30));
    }
    perExercise[key]=metric;
  }
  const session=snapshot.session,end=session.ended_at?Date.parse(session.ended_at):now;
  return {
    volume:completed.reduce((sum,set)=>sum+(set.load_kg??0)*(set.reps??0),0),
    recordedReps:completed.reduce((sum,set)=>sum+(set.reps??0),0),
    completedSets:completed.length,exerciseDurationSeconds:completed.reduce((sum,set)=>sum+(set.duration_seconds??0),0),
    durationSeconds:Math.max(0,Math.floor((end-Date.parse(session.started_at))/1000)),rpe:session.rpe??null,perExercise
  };
}

export function estimatedPRs(history=[]){
  const result={};
  for(const snapshot of history.filter(item=>item.session.status==='completed'&&!item.session.deleted_at)){
    for(const [id,metric] of Object.entries(sessionMetrics(snapshot).perExercise)){
      if(metric.estimated1RM!=null)result[id]=Math.max(result[id]??0,metric.estimated1RM);
    }
  }
  return result;
}
