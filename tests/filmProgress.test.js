import test from 'node:test';
import assert from 'node:assert/strict';
import { filmProgress, filmEvent, filmShotState, filmTaskName } from '../shared/filmProgress.js';
test('progress reflects real outputs, including invalidated and paused work', () => {
  const p = { status:'running', stage:'plan', assets:[], shots:[] };
  assert.equal(filmProgress(p).completed, 0);
  p.plan = {}; p.stage = 'quality'; p.assets = [{ image: {} }];
  p.shots = [{ frame: {}, video:{file:'v2'}, review:{file:'v1'} }];
  assert.equal(filmProgress(p).completed, 4);
  assert.equal(filmProgress(p).active.done, 0);
  p.status = 'failed';
  assert.equal(filmProgress(p).working, false);
  p.shots[0].review.file = 'v2'; p.output = 'final.mp4';
  assert.equal(filmProgress(p).completed, 6);
  filmEvent(p, 'same', '实际记录', 1); filmEvent(p, 'same', '实际记录', 2);
  assert.equal(p.events.length, 1);
  assert.equal(JSON.parse(JSON.stringify(p)).events[0].at, 1);
});

test('each shot exposes pending, generating, failed and playable states', () => {
  const p={status:'running',stage:'videos',activeJobs:[{id:'videos:0',stage:'videos'}]};
  assert.equal(filmShotState(p,{frame:{}},0).label,'视频生成中');
  assert.equal(filmShotState(p,{frame:{}},1).label,'等待生成视频');
  assert.equal(filmShotState(p,{video:{}},0).state,'complete');
  assert.equal(filmShotState(p,{videoError:'拒绝'},1).state,'error');
  p.status='cancelled'; assert.equal(filmShotState(p,{frame:{}},0).label,'已暂停');
});

test('task names keep the one-click-film prefix and use the director title', () => {
  assert.equal(filmTaskName({title:'用户长篇输入'}),'一键成片 · 导演命名中');
  assert.equal(filmTaskName({plan:{},title:'社区的一束光'}),'一键成片 · 社区的一束光');
});
