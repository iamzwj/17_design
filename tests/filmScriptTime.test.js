import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilmAgents, normalizeFilmScript, normalizeShots } from '../server/filmAgents.js';

const script = () => ({
  summary: '保留相对时间与原有剧情',
  scenes: [
    { id: 'S1', time: '三个月前·白天', action: '初次见面' },
    { id: 'S2', time: '三个月前·白天至傍晚（蒙太奇）', action: '工作过程' },
    { id: 'S3', time: '现在（加入后的短短三个月）·白天', action: '分享成长' },
  ],
});
const project = () => ({
  id: 'regression',
  story: '三个月前初次见面，现在分享成长。',
  settings: { style: '电影写实' },
  tasks: [],
  events: [],
});

test('normalizes daylight position without changing chronology, scenes or dialogue', () => {
  const original = script();
  const result = normalizeFilmScript(original);
  assert.deepEqual(result.scenes.map((scene) => scene.time), [
    '白天；三个月前',
    '白天至傍晚（蒙太奇）；三个月前',
    '白天；现在（加入后的短短三个月）',
  ]);
  assert.equal(original.scenes[0].time, '三个月前·白天');
  assert.equal(result.scenes[1].action, original.scenes[1].action);
  assert.deepEqual(normalizeFilmScript(result), result);
  assert.equal(normalizeFilmScript({ summary: '', scenes: [{ id: 'a', time: '时间：09:30；次日' }] }).scenes[0].time, '时间：09:30；次日');
});

test('rejects absent times and duplicate IDs with a specific scene error', () => {
  assert.throws(() => normalizeFilmScript({ summary: '', scenes: [{ id: 'a', time: '三个月前' }] }), /第1场缺少明确时段/);
  assert.throws(() => normalizeFilmScript({ summary: '', scenes: [{ id: 'a', time: '白天' }, { id: 'a', time: '夜晚' }] }), /第2场 ID/);
  assert.throws(() => normalizeFilmScript({ summary: '', scenes: [null] }), /第1场 ID/);
});

test('writer accepts chronological time prefixes through the regular model entry point', async () => {
  const p = project();
  let calls = 0;
  const agents = createFilmAgents({
    save() {},
    check() {},
    async api() {
      calls++;
      return { choices: [{ message: { content: JSON.stringify(script()) } }] };
    },
  });
  await agents.writer(p);
  assert.equal(calls, 1);
  assert.equal(p.script.scenes[0].time, '白天；三个月前');
  assert.equal(p.tasks[0].status, 'succeeded');
});

test('retry restores saved writer output without another model request and survives reloading', async () => {
  const p = project();
  p.tasks.push({ id: 'script:writer:v1', agent: 'writer', status: 'failed', input: { name: 'script' }, lastStructuredOutput: script() });
  let snapshot;
  const agents = createFilmAgents({
    save(value) { snapshot = JSON.stringify(value); },
    check() {},
    api() { throw Error('不得重新请求已保存的剧本'); },
  });
  await agents.writer(p);
  assert.equal(p.tasks[0].status, 'succeeded');
  assert.equal(p.tasks[0].error, null);
  assert.equal(p.script.scenes[2].time, '白天；现在（加入后的短短三个月）');
  const restored = JSON.parse(snapshot);
  await agents.writer(restored);
  assert.deepEqual(restored.script, p.script);
});

test('invalid saved script still uses the configured intelligent fallback', async () => {
  const p = project();
  p.tasks.push({ id: 'script:writer:v1', agent: 'writer', status: 'failed', input: { name: 'script' }, lastStructuredOutput: { summary: '', scenes: [] } });
  const models = [];
  const agents = createFilmAgents({
    save() {},
    check() {},
    async api(_path, body) {
      models.push(body.model);
      if (models.length === 1) throw Error('timeout');
      return { choices: [{ message: { content: JSON.stringify(script()) } }] };
    },
  });
  await agents.writer(p);
  assert.deepEqual(models, ['gpt-6.1-sol', 'gemini-3.1-pro']);
  assert.ok(p.script.scenes.length);
});

test('storyboard prompt retains chronology after the same normalization', () => {
  const p = { duration: 5, characters: [], scenes: [{ id: 'room', name: '室内' }], resources: [{ id: 'room-environment' }] };
  const shot = { id: 's1', sceneNumber: 1, time: '三个月前·白天', sceneId: 'room', characterIds: [], duration: 5 };
  for (const key of ['shotSize', 'angle', 'composition', 'action', 'emotion', 'light', 'camera', 'dialogue', 'ambience', 'continuity', 'firstFramePrompt', 'videoPrompt']) shot[key] = '';
  const [result] = normalizeShots([shot], p);
  assert.equal(result.time, '白天；三个月前');
  assert.match(result.prompt, /^白天；三个月前/);
});
