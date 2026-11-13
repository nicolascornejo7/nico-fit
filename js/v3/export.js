// Personal data export: a full JSON backup and a CSV of every logged set.
// Reads only the local V3 repository; never writes or calls the server.
const INTERNAL=/^(sync_|remote_|local_|_)/;
const clean=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!INTERNAL.test(key)));
const live=row=>!row.deleted_at;

export async function buildExport(repository,{now=new Date()}={}){
  const [sessions,catalog,readiness,football,matches]=await Promise.all([
    repository.listSessions(),repository.listRecords('exercise_catalog'),repository.listRecords('daily_readiness'),repository.listRecords('football_sessions'),repository.listRecords('match_reviews')
  ]);
  const workouts=[];
  for(const session of sessions.filter(live)){
    const exercises=(await repository.listChildren('session_exercises',session.id)).filter(live).sort((a,b)=>a.position-b.position);
    for(const exercise of exercises)exercise.sets=(await repository.listChildren('exercise_sets',exercise.id)).filter(live).sort((a,b)=>a.position-b.position).map(clean);
    workouts.push({...clean(session),exercises:exercises.map(exercise=>({...clean(exercise),sets:exercise.sets}))});
  }
  workouts.sort((a,b)=>String(a.session_date).localeCompare(String(b.session_date))||String(a.started_at).localeCompare(String(b.started_at)));
  return {app:'Nico Fit',format:1,exportedAt:now.toISOString(),workouts,exercises:catalog.filter(live).map(clean),readiness:readiness.filter(live).map(clean),football:football.filter(live).map(clean),matchReviews:matches.filter(live).map(clean)};
}

const CSV_HEADER=['fecha','sesion','tipo','estado','rpe_sesion','ejercicio','serie','kg','reps','segundos','rir','completada'];
const cell=value=>{if(value==null)return '';const text=String(value);return /[",;\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};

export function setsCsv(data){
  const lines=[CSV_HEADER.join(',')];
  for(const workout of data.workouts)for(const exercise of workout.exercises)for(const set of exercise.sets){
    lines.push([workout.session_date,workout.label,workout.session_type,workout.status,workout.rpe,exercise.exercise_name_snapshot,set.position+1,set.load_kg,set.reps,set.duration_seconds,set.rir,set.is_completed?'sí':'no'].map(cell).join(','));
  }
  return '﻿'+lines.join('\r\n')+'\r\n';
}

export function downloadFile(name,content,type,{doc=globalThis.document,url=globalThis.URL}={}){
  const blob=new Blob([content],{type}),href=url.createObjectURL(blob),link=doc.createElement('a');
  link.href=href;link.download=name;link.rel='noopener';doc.body.append(link);link.click();link.remove();
  setTimeout(()=>url.revokeObjectURL(href),1000);
}
