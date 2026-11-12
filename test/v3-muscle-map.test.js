import test from 'node:test';
import assert from 'node:assert/strict';
import {EXERCISE_PROFILES} from '../js/v3/exercise-recommendations.js';
import {muscleHighlights,muscleMapSvg,MUSCLE_COLORS,MUSCLE_NAMES} from '../js/v3/muscle-map.js';

class Node{constructor(tag){this.tag=tag;this.attrs={};this.children=[];}setAttribute(key,value){this.attrs[key]=value;}append(...nodes){this.children.push(...nodes);}}
const svgDoc={createElementNS:(_ns,tag)=>new Node(tag)};
const all=node=>node.children.flatMap(child=>[child,...all(child)]);

test('every profiled exercise lights at least one primary region and names its muscles in Spanish',()=>{
  for(const [key,profile] of Object.entries(EXERCISE_PROFILES)){
    const result=muscleHighlights({stable_key:key});
    assert.ok(result,`no highlights for ${key}`);
    assert.ok([...result.regions.values()].includes('primary'),`no primary region drawn for ${key}`);
    for(const muscle of profile.primary_muscles)assert.ok(MUSCLE_NAMES[muscle],`missing Spanish name for ${muscle}`);
    assert.ok(result.primary.length>0);
  }
  assert.equal(muscleHighlights({stable_key:'custom:unknown'}),null);
});

test('primary wins over secondary and secondary names exclude primaries',()=>{
  const result=muscleHighlights({primary_muscles:['chest'],secondary_muscles:['triceps','front_deltoids','chest']});
  assert.equal(result.regions.get('chest'),'primary');assert.equal(result.regions.get('triceps'),'secondary');
  assert.deepEqual(result.primary,['Pecho']);assert.deepEqual(result.secondary,['Tríceps','Deltoides anterior']);
});

test('the SVG draws front and back figures with primary and secondary fills and an accessible label',()=>{
  const svg=muscleMapSvg({stable_key:'press-banca'},{doc:svgDoc});
  assert.equal(svg.tag,'svg');assert.equal(svg.attrs.role,'img');assert.match(svg.attrs['aria-label'],/Pecho/);assert.match(svg.attrs['aria-label'],/Tríceps/);
  assert.equal(svg.children.length,2);
  const fills=all(svg).map(node=>node.attrs.fill);
  assert.ok(fills.includes(MUSCLE_COLORS.primary));assert.ok(fills.includes(MUSCLE_COLORS.secondary));
  assert.equal(muscleMapSvg({stable_key:'press-banca'},{doc:{}}),null);
});
