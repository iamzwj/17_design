import test from 'node:test';
import assert from 'node:assert/strict';
import { isFilmRateLimit } from '../server/filmGenerationRecovery.js';
import { applyCommand } from '../server/filmState.js';

function project(error, providerId) {
  return {
    schemaVersion: 2, status: 'failed',
    shots: [{ id: 'shot_05', revision: 1, frameError: error, frameSubmitting: true }],
    tasks: [{ id: 'shot_05:frame:v1', status: 'needs-input', submitting: true, error, providerId }],
  };
}
const retry = { id: 'retry', type: 'retry-shot', body: { id: 'shot_05', revision: 1, kind: 'frame' } };

test('explicit provider rate rejection can retry legacy records without an accepted task', () => {
  const p = project('生成提交未确认：操作过于频繁，请稍后再试');
  applyCommand(p, retry);
  assert.equal(p.tasks[0].submitting, false);
  assert.equal(p.shots[0].frameSubmitting, false);
  assert.equal(p.shots[0].frameError, null);
  assert.equal(p.tasks[0].status, 'waiting');
});

test('ambiguous submissions remain protected and accepted provider IDs are retained', () => {
  assert.throws(() => applyCommand(project('生成提交未确认：连接超时'), retry), /提交结果未知/);
  const p = project('上游仍在制作', 'accepted');
  applyCommand(p, retry);
  assert.equal(p.tasks[0].providerId, 'accepted');
});

test('classifies only explicit rate limits for automatic resubmission', () => {
  assert.equal(isFilmRateLimit({status: 429}), true);
  assert.equal(isFilmRateLimit({upstreamCode: 429}), true);
  assert.equal(isFilmRateLimit({status: 502, message: 'fetch failed'}), false);
});
