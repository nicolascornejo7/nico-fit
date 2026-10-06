import test from 'node:test';
import assert from 'node:assert/strict';
import {plan} from '../js/plan.js';
import {BASE_EXERCISES} from '../js/v3/base-exercise-catalog.js';
import {exerciseProfile,recommendedAlternatives,compatiblePrescription} from '../js/v3/exercise-recommendations.js';

const keys=[...new Set([...BASE_EXERCISES.map(item=>item.stable_key),...[2,4,5].flatMap(day=>plan[day].exercises.map(item=>item.id))])];
const catalog=keys.map((stable_key,index)=>({id:String(index),stable_key,canonical_name:stable_key,measurement_kind:['plancha-pallof','copenhagen-plank','movilidad-prepartido'].includes(stable_key)?'seconds':'reps',metadata:{source:'existing-v3'}}));
const item=key=>catalog.find(row=>row.stable_key===key);

test('all existing stable catalog keys have explicit profiles and recommendations stay within matching patterns',()=>{
  assert.equal(keys.length,30);
  for(const current of catalog){
    const profile=exerciseProfile(current);assert.ok(profile,`missing profile: ${current.stable_key}`);
    assert.ok(profile.movement_pattern&&profile.primary_muscles.length&&profile.equipment.length&&profile.laterality&&profile.role&&profile.fatigue);
    const choices=recommendedAlternatives(current,catalog);assert.ok(choices.length<=3);
    for(const {exercise,reason} of choices){
      const other=exerciseProfile(exercise);
      assert.equal(other.movement_pattern,profile.movement_pattern);
      assert.ok(other.primary_muscles.some(muscle=>profile.primary_muscles.includes(muscle)));
      assert.match(reason,/Mismo patrón/);
    }
  }
});

test('Romanian deadlift prefers its hinge variant and never generic leg exercises',()=>{
  const choices=recommendedAlternatives(item('peso-muerto-rumano'),catalog);
  assert.deepEqual(choices.map(choice=>choice.exercise.stable_key),['peso-muerto-rumano-ligero']);
  assert.match(choices[0].reason,/isquios\/glúteos/);
});

test('rows and presses prioritize equivalent movement and useful equipment differences',()=>{
  assert.deepEqual(recommendedAlternatives(item('remo-barra'),catalog).map(row=>row.exercise.stable_key),['remo-mancuerna','remo']);
  assert.deepEqual(recommendedAlternatives(item('press-banca'),catalog).map(row=>row.exercise.stable_key),['press-inclinado-mancuernas','press-banca-ligero']);
  assert.equal(compatiblePrescription(item('press-banca'),item('press-inclinado-mancuernas')),true);
  assert.equal(compatiblePrescription(item('peso-muerto-rumano'),item('peso-muerto-rumano-ligero')),false);
});

test('unknown custom exercises do not acquire text-based recommendations',()=>{
  const custom={id:'custom',stable_key:'custom:unknown',canonical_name:'Peso muerto casero',measurement_kind:'reps',metadata:{custom:true}};
  assert.deepEqual(recommendedAlternatives(custom,catalog),[]);
  assert.equal(compatiblePrescription(custom,item('peso-muerto-rumano')),false);
});
