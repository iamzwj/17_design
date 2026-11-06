import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFilmProject } from '../server/filmScheduler.js';
const pick = (projects, options = {}) => selectFilmProject(projects, { hasCommands: () => false, now: 100, ...options });
test('a paused project with unfinished jobs cannot starve a new script', () => {
  const paused = { id: 'old', status: 'pausing', schedulingPaused: true, activeJobs: [{ id: 'image' }] };
  const queued = { id: 'new', status: 'queued' };
  assert.equal(pick([paused, queued]), queued);
  assert.equal(pick([paused]), undefined);
});
test('resume commands remain actionable while scheduling is paused', () => {
  const paused = { id: 'old', status: 'paused', schedulingPaused: true };
  assert.equal(pick([paused], { hasCommands: () => true }), paused);
});
test('round robin permits later projects to run after an earlier project yields', () => {
  const projects = [{ id: 'a', status: 'queued' }, { id: 'b', status: 'running' }];
  assert.equal(pick(projects, { lastId: 'a' }).id, 'b');
  assert.equal(pick(projects, { lastId: 'b' }).id, 'a');
});
test('respects retry deadlines and paused flags even with stale running status', () => {
  assert.equal(pick([{ id: 'a', status: 'queued', nextRunAt: 101 }, { id: 'b', status: 'running', schedulingPaused: true }]), undefined);
});
