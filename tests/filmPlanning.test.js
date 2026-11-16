import test from 'node:test';
import assert from 'node:assert/strict';
import { runFilmPlanning } from '../server/filmPlanning.js';

test('failed simple planning preserves the project and switches to the existing director', async () => {
  const project={simpleFilmWorkflow:true,story:'原始故事'}; const called=[];
  const agents={async simplePlan(){called.push('simple');throw Error('timeout');},async director(p){called.push('director');assert.equal(p.story,'原始故事');}};
  await runFilmPlanning(project,{agents,check(){},save(){},event(){}});
  assert.deepEqual(called,['simple','director']);
  assert.equal(project.simplePlanningFallback,true);
  assert.equal(project.simpleFilmWorkflow,true);
});

test('pause or cancellation does not start the fallback', async () => {
  const project={simpleFilmWorkflow:true};let started=false;
  const agents={async simplePlan(){throw Error('timeout');},async director(){started=true;}};
  await assert.rejects(runFilmPlanning(project,{agents,check(){throw Error('paused');},save(){},event(){}}),/paused/);
  assert.equal(started,false);
  assert.equal(project.simplePlanningFallback,undefined);
});
