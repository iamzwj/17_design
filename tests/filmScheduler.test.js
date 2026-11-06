import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilmDispatcher } from '../server/filmScheduler.js';
const tick = () => new Promise(r => setImmediate(r));
test('a waiting project never blocks another project or gets duplicate execution', async () => {
  let finish;
  const started = [], errors = [];
  const dispatch = createFilmDispatcher(async p => {
    started.push(p.id);
    if (p.id === 'old') await new Promise(r => { finish = r; });
  }, e => errors.push(e));
  const old = { id: 'old', status: 'running' };
  dispatch([old], () => false);
  await tick();
  dispatch([old, { id: 'new', status: 'queued' }], () => false);
  await tick();
  assert.deepEqual(started, ['old', 'new']);
  finish(); await tick();
  assert.deepEqual(errors, []);
});
test('paused recovery, resume commands and a new script all run independently', async () => {
  const started = [];
  const dispatch = createFilmDispatcher(p => { started.push(p.id); }, assert.fail);
  dispatch([
    { id: 'recover', status: 'pausing', schedulingPaused: true, tasks: [{ providerId: 'x', status: 'running' }] },
    { id: 'resume', status: 'paused', schedulingPaused: true },
    { id: 'new', status: 'queued' },
    { id: 'paused', status: 'paused', schedulingPaused: true },
    { id: 'later', status: 'queued', nextRunAt: 101 },
  ], p => p.id === 'resume', 100);
  await tick();
  assert.deepEqual(started, ['recover', 'resume', 'new']);
});
test('a rejected project releases its execution guard and cannot stop others', async () => {
  const errors = [], started = [];
  const dispatch = createFilmDispatcher(p => { started.push(p.id); if(p.id === 'bad')throw Error('failed'); }, e => errors.push(e.message));
  const projects = [{ id: 'bad', status: 'queued' }, { id: 'good', status: 'queued' }];
  dispatch(projects, () => false); await tick();
  dispatch(projects, () => false); await tick();
  assert.deepEqual(started, ['bad', 'good', 'bad', 'good']);
  assert.deepEqual(errors, ['failed', 'failed']);
});
