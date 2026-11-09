import test from 'node:test';
import assert from 'node:assert/strict';
import { filmPool } from '../server/filmPool.js';
test('dispatches five at once and respects the concurrency bound', async () => {
  let active=0, peak=0, finished=0;
  await filmPool(Array.from({length:23}),5, async () => {
    active++; peak=Math.max(peak,active);
    await new Promise(r=>setTimeout(r,10));
    active--; finished++;
  });
  assert.equal(peak,5); assert.equal(active,0); assert.equal(finished,23);
});
test('a failure stops new submissions and waits for submitted jobs to settle', async () => {
  const completed=[]; let started=0;
  await assert.rejects(filmPool(Array.from({length:25}),5,async (_,i) => {
    started++;
    if(i===0) throw Error('provider error');
    await new Promise(r=>setTimeout(r,10)); completed.push(i);
  }), /provider error/);
  assert.equal(started,5); assert.equal(completed.length,4);
});
