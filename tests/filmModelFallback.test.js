import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('film planning skips maintenance models and allows five minutes per request', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'film-model-fallback-'));
  process.env.DIEFA_DATA_DIR = dataDir;
  try {
    const { createFilmAgents } = await import('../server/filmAgents.js');
    const calls = [];
    const project = { id: 'test', story: 'A story', settings: { style: 'film' }, tasks: [], events: [], simplePlanningFallback: true };
    const agents = createFilmAgents({
      save() {}, check() {},
      async api(_path, body, timeout) {
        calls.push({ model: body.model, timeout });
        if (calls.length < 3) throw Error('模型维护中');
        return { choices: [{ message: { content: JSON.stringify({ summary: 'Story', scenes: [{ id: 's1', time: '白天', action: 'Action' }] }) } }] };
      },
    });
    await agents.writer(project);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(({ timeout }) => timeout === 300000));
    assert.equal(project.script.scenes.length, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
