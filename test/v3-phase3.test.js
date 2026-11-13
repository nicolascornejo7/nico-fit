import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {platesPerSide,describePlates,usesBarbell} from '../js/v3/plates.js';
import {customExerciseMetadata,muscleHighlights} from '../js/v3/muscle-map.js';
import {exerciseProfile} from '../js/v3/exercise-recommendations.js';
import {exerciseFamily} from '../js/v3/exercise-family.js';
import {weeklyMuscleVolume} from '../js/v3/hypertrophy.js';
import {V3LocalRepository} from '../js/v3/repository.js';
import {V3TrainingEngine} from '../js/v3/training-engine.js';
import {buildExport,setsCsv} from '../js/v3/export.js';
import {installRolloutControl} from '../js/v3/rollout-state.js';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('plate calculator loads per side from the heaviest plate and reports what it cannot match',()=>{
  assert.deepEqual(platesPerSide(100).perSide,[25,15]);
  assert.equal(describePlates(platesPerSide(100)),'Por lado: 1×25 + 1×15 kg');
  assert.deepEqual(platesPerSide(62.5).perSide,[20,1.25]);
  assert.equal(platesPerSide(20).perSide.length,0);assert.equal(describePlates(platesPerSide(20)),'Solo la barra');
  const odd=platesPerSide(21);assert.equal(odd.exact,false);assert.equal(odd.missing,1);assert.match(describePlates(odd),/faltan 1 kg/);
  assert.equal(platesPerSide(15).valid,false);assert.equal(platesPerSide('').valid,false);
  assert.deepEqual(platesPerSide(50,{bar:0}).perSide,[25]);
  assert.equal(usesBarbell(exerciseProfile({stable_key:'press-banca'})),true);
  assert.equal(usesBarbell(exerciseProfile({stable_key:'curl-martillo'})),false);
});

test('custom exercise metadata is a valid explicit profile that drives family, muscle map and volume',()=>{
  const metadata=customExerciseMetadata({primaryMuscle:'glutes',secondaryMuscle:'hamstrings'});
  const catalog={id:'c1',stable_key:'custom:c1',canonical_name:'Patada de glúteo',measurement_kind:'reps',metadata};
  const profile=exerciseProfile(catalog);
  assert.deepEqual(profile.primary_muscles,['glutes']);assert.deepEqual(profile.secondary_muscles,['hamstrings']);
  assert.equal(exerciseFamily(catalog),'legs');
  assert.deepEqual(muscleHighlights(catalog).primary,['Glúteos']);
  const history=[{session:{id:'s',session_date:'2026-11-10',status:'completed'},exercises:[{id:'e',exercise_catalog_id:'c1',exercise_name_snapshot:'Patada',catalog,sets:[{id:'x',position:0,reps:12,rir:2,is_completed:true},{id:'y',position:1,reps:12,rir:2,is_completed:true}]}]}];
  const week=weeklyMuscleVolume(history,{date:'2026-11-12'});
  assert.equal(week.muscles.find(row=>row.muscle==='glutes').sets,2);assert.equal(week.muscles.find(row=>row.muscle==='hamstrings').sets,1);
  assert.deepEqual(customExerciseMetadata({}),{custom:true});
  assert.throws(()=>customExerciseMetadata({primaryMuscle:'nose'}),/Músculo inválido/);
  assert.equal(customExerciseMetadata({primaryMuscle:'chest',secondaryMuscle:'chest'}).secondary_muscles.length,0);
  assert.equal(customExerciseMetadata({primaryMuscle:'erectors'}).body_region,'core');
});

test('engine stores muscles on a new custom exercise and export produces JSON and CSV without internal fields',async()=>{
  const reset=installRolloutControl({snapshot:()=>({updateRequired:false,remoteWritesAllowed:true,flags:{v3_enabled:true,v3_storage_enabled:true,v3_training_enabled:true,v3_routines_enabled:false,v3_coach_enabled:false}}),refreshIfDue:async()=>{}});
  const repository=await V3LocalRepository.open({indexedDB:new IDBFactory(),userId:USER,featureEnabled:true});
  try{
    const engine=new V3TrainingEngine({repository,featureEnabled:true,routinesEnabled:false,now:()=>new Date('2026-11-12T12:00:00Z')});
    const created=await engine.createCustomExercise({name:'Patada de glúteo, polea',primaryMuscle:'glutes',secondaryMuscle:'hamstrings'});
    assert.deepEqual(created.metadata.primary_muscles,['glutes']);
    await engine.createFreeWorkout({date:'2026-11-12'});await engine.addExercise(created.id);
    const snapshot=await engine.snapshot(),exercise=snapshot.exercises.at(-1);
    await engine.saveSet(exercise.id,{load_kg:'15',reps:'12',duration_seconds:null,rir:'2',is_completed:true},{position:0});
    await repository.markBootstrapHydrated();
    const data=await buildExport(repository,{now:new Date('2026-11-12T13:00:00Z')});
    assert.equal(data.app,'Nico Fit');assert.equal(data.workouts.length,1);
    const set=data.workouts[0].exercises.at(-1).sets[0];
    assert.equal(Number(set.load_kg),15);assert.ok(!Object.keys(set).some(key=>/^(sync_|remote_|local_|_)/.test(key)));
    const csv=setsCsv(data),lines=csv.trim().split('\r\n');
    assert.ok(csv.startsWith('﻿fecha,sesion,tipo'));
    assert.match(lines.at(-1),/^2026-11-12,/);assert.match(lines.at(-1),/"Patada de glúteo, polea",1,15,12,,2,sí$/);
  }finally{reset();repository.close();}
});
