import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { checkFrameIntegrity } from '../server/filmFrameIntegrity.js';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'film-scale-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const project = {id: 'film'};
  const dir = path.join(root, project.id);
  fs.mkdirSync(dir);
  await sharp({create: {width: 30, height: 30, channels: 3, background: 'gray'}})
    .png().toFile(path.join(dir, 'tail.png'));
  return {root, project, shot: {id: 's1', revision: 1, tail: {file: 'tail.png'}, tailFramePrompt: '两人在厢式车旁搬货'}};
}

test('visible scale distortion repairs only the affected shot and respects the retry cap', async t => {
  const {root, project, shot} = await fixture(t);
  const commands = [];
  const review = {status: 'reject', summary: '人物与车轮落点接近，但蹲着的人高过厢式车车顶'};
  const dependencies = {
    root, check() {}, save() {}, event() {},
    applyCommand(_, command) { commands.push(command); },
    async api(_, body) {
      assert.match(body.messages[0].content[0].text, /脚底与轮胎接地点判断景深/);
      return {choices: [{message: {content: JSON.stringify(review)}}]};
    },
  };
  await assert.rejects(checkFrameIntegrity(project, shot, 'tail', dependencies), /人高过厢式车车顶/);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].body.id, shot.id);
  assert.match(commands[0].body.patch.tailFramePrompt, /两人在厢式车旁搬货.*人高过厢式车车顶/);
  assert.equal(commands[0].body.patch.firstFramePrompt, undefined);
  shot.revision++;
  await assert.rejects(checkFrameIntegrity(project, shot, 'tail', dependencies));
  assert.equal(commands.length, 1);
});

test('a frame approved under the old policy is rechecked and uncertainty is recorded without regeneration', async t => {
  const {root, project, shot} = await fixture(t);
  shot.tailIntegrity = {file: 'tail.png', status: 'pass'};
  let calls = 0;
  const dependencies = {
    root, check() {}, save() {}, event() {},
    applyCommand() { assert.fail('Uncertainty must not regenerate the shot'); },
    async api() {
      calls++;
      return {choices: [{message: {content: '{"status":"uncertain","summary":"车轮被遮挡，无法判断距离"}'}}]};
    },
  };
  await checkFrameIntegrity(project, shot, 'tail', dependencies);
  await checkFrameIntegrity(project, shot, 'tail', dependencies);
  assert.equal(calls, 1);
  assert.equal(shot.tailIntegrity.status, 'uncertain');
});
