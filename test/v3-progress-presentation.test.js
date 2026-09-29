import test from 'node:test';
import assert from 'node:assert/strict';
import {footballSummary,readinessSummary,recentTimeline,strengthSummary,trend} from '../js/v3/progress-presentation.js';

test('strength summary isolates the selected stable identity and states its trend',()=>{
  const exercises=[{identity:'v2:exercise:press',date:'2026-09-01',maxLoad:60,volume:600},{identity:'v2:exercise:press',date:'2026-09-08',maxLoad:65,volume:650},{identity:'v3:exercise:press',date:'2026-09-09',maxLoad:200,volume:2000}];
  const summary=strengthSummary(exercises,'v2:exercise:press');
  assert.equal(summary.best,65);assert.equal(summary.volume,1250);assert.equal(summary.trend.key,'up');assert.equal(summary.rows.length,2);
});

test('readiness exposes each metric without reinterpreting its source values',()=>{
  const readiness=[{date:'2026-09-01',value:60,sleep:3,energy:3,freshness:3,pain:4},{date:'2026-09-08',value:80,sleep:5,energy:4,freshness:4,pain:1}];
  const sleep=readinessSummary(readiness,'sleep'),pain=readinessSummary(readiness,'pain');
  assert.deepEqual(sleep.rows.map(row=>row.value),[3,5]);assert.equal(sleep.trend.key,'up');assert.deepEqual(pain.rows.map(row=>row.value),[4,1]);assert.equal(pain.trend.key,'down');
});

test('football and timeline keep same-day gym, football and review as distinct events',()=>{
  const summary=footballSummary([{date:'2026-09-20',title:'Partido',load:540}],[{date:'2026-09-20',legs:3,performance:4}]);
  assert.equal(summary.load,540);assert.equal(summary.latestReview.performance,4);
  const timeline=recentTimeline({sessions:[{id:'v2:session:same',date:'2026-09-20',title:'Gym'}],football:summary.sessions,matches:summary.reviews});
  assert.equal(timeline.recent.length,3);assert.deepEqual(new Set(timeline.recent.map(row=>row.kind)),new Set(['session','football','match']));
});

test('empty progress areas are useful and do not manufacture a trend',()=>{
  assert.equal(trend([]).key,'insufficient');assert.equal(strengthSummary([],null).best,0);assert.equal(readinessSummary([],'energy').latest,null);assert.equal(footballSummary([],[]).sessions.length,0);
});
