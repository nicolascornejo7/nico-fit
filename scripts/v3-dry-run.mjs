import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=new URL('../',import.meta.url);
const file=path=>readFile(new URL(path,root),'utf8');
const sql={
  bootstrap:await file('supabase/test-v3-local-bootstrap.sql'),
  migration:await file('supabase/migration-v3-schema.sql'),
  schemaTests:await file('supabase/test-v3-schema.sql'),
  idempotency:await file('supabase/test-v3-idempotency.psql'),
  fixtures:await file('supabase/test-v3-v2-fixtures.sql'),
  backfillSessions:await file('supabase/backfill-v2-sessions.sql'),
  backfillWorkouts:await file('supabase/backfill-v2-workouts.sql'),
  rollback:await file('supabase/rollback-v3-schema.sql')
};

const report={engine:'',steps:[],beforeBackfill:null,afterBackfill:null,afterSecondBackfill:null,afterRollback:null};
async function step(name,action){
  const started=performance.now();
  try{
    const result=await action();
    const detail=Array.isArray(result) ? `${result.length} SQL statements executed` : result;
    report.steps.push({name,status:'passed',durationMs:Math.round(performance.now()-started),detail});
    return result;
  }
  catch(error){report.steps.push({name,status:'failed',durationMs:Math.round(performance.now()-started),error:error.message});throw error;}
}
async function createDatabase(){const db=new PGlite();await db.waitReady;await db.exec(sql.bootstrap);return db;}
async function count(db,query){return Number((await db.query(query)).rows[0].count);}
async function executeIdempotencyPsql(db,source){
  let statement='';
  let includes=0;
  for(const rawLine of source.split(/\r?\n/)){
    const line=rawLine.trim();
    if(!line)continue;
    if(line.startsWith('\\set ')){
      assert.equal(line,'\\set ON_ERROR_STOP on');
      continue;
    }
    if(line.startsWith('\\ir ')){
      assert.equal(statement,'');
      assert.equal(line,'\\ir migration-v3-schema.sql');
      await db.exec(sql.migration);
      includes+=1;
      continue;
    }
    if(line.startsWith('\\echo '))continue;
    statement+=`${rawLine}\n`;
    if(line.endsWith(';')){
      await db.exec(statement);
      statement='';
    }
  }
  assert.equal(statement,'');
  assert.equal(includes,2);
}
async function counts(db){return {
  v2:{
    sessions:await count(db,'select count(*) from public.workout_sessions'),
    workouts:await count(db,'select count(*) from public.workouts'),
    tombstones:await count(db,'select count(*) from public.sync_tombstones')
  },
  v3:{
    sessions:await count(db,'select count(*) from nico_fit_v3.workout_sessions'),
    sessionExercises:await count(db,'select count(*) from nico_fit_v3.session_exercises'),
    sets:await count(db,'select count(*) from nico_fit_v3.exercise_sets'),
    sessionMaps:await count(db,'select count(*) from nico_fit_v3.v2_workout_session_map'),
    workoutMaps:await count(db,'select count(*) from nico_fit_v3.v2_workout_map'),
    setMaps:await count(db,'select count(*) from nico_fit_v3.v2_set_map')
  }
};}
async function statuses(db,table){return (await db.query(`select migration_status, count(*)::integer as count from nico_fit_v3.${table} group by migration_status order by migration_status`)).rows;}

let db;
try{
  db=await createDatabase();
  report.engine=(await db.query('select version()')).rows[0].version;

  await step('apply migration-v3-schema.sql',()=>db.exec(sql.migration));
  await step('execute test-v3-schema.sql',()=>db.exec(sql.schemaTests));

  await step('execute test-v3-idempotency.psql',async()=>{
    const isolated=await createDatabase();
    try{
      await executeIdempotencyPsql(isolated,sql.idempotency);
      assert.equal(await count(isolated,"select count(*) from information_schema.schemata where schema_name='nico_fit_v3'"),0);
    }finally{await isolated.close();}
    return 'psql directives interpreted; migration applied twice and rolled back';
  });

  await step('load synthetic V2 fixtures',()=>db.exec(sql.fixtures));
  report.beforeBackfill=await counts(db);

  await step('execute backfill-v2-sessions.sql',()=>db.exec(sql.backfillSessions));
  await step('execute backfill-v2-workouts.sql',()=>db.exec(sql.backfillWorkouts));
  report.afterBackfill=await counts(db);
  report.afterBackfill.statuses={
    sessions:await statuses(db,'v2_workout_session_map'),
    workouts:await statuses(db,'v2_workout_map'),
    sets:await statuses(db,'v2_set_map')
  };

  await step('verify backfill classifications and edge cases',async()=>{
    assert.deepEqual(report.beforeBackfill.v2,{sessions:10,workouts:9,tombstones:2});
    assert.deepEqual(report.afterBackfill.v3,{sessions:9,sessionExercises:6,sets:8,sessionMaps:9,workoutMaps:8,setMaps:8});
    assert.equal(await count(db,"select count(*) from nico_fit_v3.v2_workout_session_map where migration_status='migrated'"),8);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.v2_workout_session_map where migration_status='pending_review'"),1);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.v2_workout_map where migration_status='pending_review'"),6);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.v2_workout_map where migration_status='skipped'"),2);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.v2_set_map where migration_status='migrated'"),6);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.v2_set_map where migration_status='pending_review'"),2);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.session_exercises where session_id=md5('nico-fit-v3:v2-session:104')::uuid and exercise_catalog_id='c0000000-0000-4000-8000-000000000002'"),2);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.v2_workout_map where v2_workout_id=1002 and migration_status='skipped'"),1);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.v2_workout_session_map where v2_session_id=106"),0);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.v2_workout_map where v2_workout_id=1007"),0);
    assert.equal(await count(db,"select count(*) from nico_fit_v3.exercise_sets s join nico_fit_v3.v2_set_map m on m.v3_set_id=s.id where m.v2_workout_id=1008 and s.reps is null and s.duration_seconds is null and not s.is_completed"),1);
    return 'normal, multiple sessions, repeated exercise, incomplete, ambiguous and tombstone cases verified';
  });

  await step('re-run both backfills',async()=>{await db.exec(sql.backfillSessions);await db.exec(sql.backfillWorkouts);});
  report.afterSecondBackfill=await counts(db);
  await step('verify backfill idempotency',async()=>assert.deepEqual(report.afterSecondBackfill,{
    v2:report.afterBackfill.v2,v3:report.afterBackfill.v3
  }));

  await step('re-run RLS, version and soft-delete tests after backfill',()=>db.exec(sql.schemaTests));

  const v2BeforeRollback=report.afterSecondBackfill.v2;
  await step('execute rollback-v3-schema.sql',()=>db.exec(sql.rollback));
  report.afterRollback={
    v2:{
      sessions:await count(db,'select count(*) from public.workout_sessions'),
      workouts:await count(db,'select count(*) from public.workouts'),
      tombstones:await count(db,'select count(*) from public.sync_tombstones')
    },
    v3Schema:await count(db,"select count(*) from information_schema.schemata where schema_name='nico_fit_v3'")
  };
  await step('verify rollback leaves V2 intact',async()=>{
    assert.deepEqual(report.afterRollback.v2,v2BeforeRollback);assert.equal(report.afterRollback.v3Schema,0);
  });

  await step('recreate V3 after rollback',()=>db.exec(sql.migration));
  await step('execute V3 tests after recreation',()=>db.exec(sql.schemaTests));
  await step('verify V3 recreation',async()=>assert.equal(await count(db,"select count(*) from information_schema.tables where table_schema='nico_fit_v3' and table_name in ('workout_sessions','session_exercises','exercise_sets','exercise_catalog')"),4));

  console.log(JSON.stringify(report,null,2));
}catch(error){
  console.error(JSON.stringify(report,null,2));
  console.error(error);
  process.exitCode=1;
}finally{if(db)await db.close();}
