import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { runFilmShotPipeline } from '../server/filmShotPipeline.js';
import { applyCommand } from '../server/filmState.js';

test('ready videos overlap images, isolated failures and scoped retries use separate ten-slot queues', async () => {
  const project = {
    schemaVersion: 2, status: 'running', stage: 'images',
    shots: Array.from({length: 24}, (_, id) => ({id: String(id), revision: 1})),
  };
  const slow = Promise.withResolvers();
  const firstBatch = Promise.withResolvers();
  const videoFailure = Promise.withResolvers();
  const frameRetry = Promise.withResolvers();
  const runs = new Map();
  const running = {frame:0,video:0}, peak = {frame:0,video:0};
  let peakTotal = 0;

  async function generate(shot, kind) {
    const key = `${shot.id}:${kind}`;
    const attempts = (runs.get(key) || 0) + 1;
    runs.set(key, attempts);
    peak[kind] = Math.max(peak[kind], ++running[kind]);
    peakTotal = Math.max(peakTotal, running.frame + running.video);
    try {
      if (runs.size === 10) firstBatch.resolve();
      if (key === '0:frame') await slow.promise;
      else await sleep(15);
      if (key === '1:frame' && attempts === 1) throw Error('frame failed');
      if (key === '2:video' && attempts === 1) {
        videoFailure.resolve();
        throw Error('video failed');
      }
      if (key === '1:frame' && attempts === 2) frameRetry.resolve();
      shot[kind] = {file: key};
    } finally {
      running[kind]--;
    }
  }

  const pipeline = runFilmShotPipeline(project, {
    check() {}, save() {},
    image: (shot, index, kind) => generate(shot, kind),
    video: shot => generate(shot, 'video'),
  });
  try {
    await firstBatch.promise;
    assert.equal(peak.frame, 10);
    await videoFailure.promise;
    await sleep(0);
    assert.equal(project.shots[0].frame, undefined);
    assert.equal(project.shots[1].frameError, 'frame failed');
    assert.equal(project.shots[2].videoError, 'video failed');
    assert.equal(runs.has('1:video'), false);

    applyCommand(project, {id:'retry-image',type:'retry-shot',body:{id:'1',kind:'frame',revision:1}});
    assert.equal(project.shots[2].videoError, 'video failed');
    await frameRetry.promise;
    assert.equal(project.shots[0].frame, undefined);
  } finally {
    slow.resolve();
    await pipeline;
  }
  assert.equal(peak.frame, 10);
  assert.ok(peak.video > 0 && peak.video <= 10);
  assert.ok(peakTotal > 10);
  assert.equal(runs.get('1:frame'), 2);
  assert.equal(runs.get('1:video'), 1);
  assert.equal(runs.get('2:frame'), 1);
  assert.equal(runs.get('2:video'), 1);
  assert.equal(project.shots.filter(s => s.video).length, 23);
});

test('video retry keeps the frame, reuses accepted provider ID and never resets other failures', () => {
  const p = {
    schemaVersion:2, status:'failed',
    shots:[{id:'a', revision:1, frame:{file:'saved.png'}, videoError:'download failed', videoTask:'accepted'},
      {id:'b', revision:1, frameError:'server_timeout'}],
    tasks:[{id:'a:video:v1',status:'failed',providerId:'accepted'}],
  };
  applyCommand(p, {id:'retry-video',type:'retry-shot',body:{id:'a',kind:'video',revision:1}});
  assert.equal(p.status,'queued');
  assert.equal(p.shots[0].frame.file,'saved.png');
  assert.equal(p.tasks[0].providerId,'accepted');
  assert.equal(p.tasks[0].status,'waiting');
  assert.equal(p.shots[1].frameError,'server_timeout');
});


test('ten ready videos and ten images can all run at the same time', async () => {
  const release = Promise.withResolvers();
  const started = Promise.withResolvers();
  const counters = {frame:0,video:0};
  const p = {
    shots: Array.from({length:22}, (_, id) => ({
      id:String(id), revision:1, ...(id < 11 ? {frame:{file:'ready.png'}} : {}),
    })),
  };
  async function run(shot, kind) {
    counters[kind]++;
    if (counters.frame === 10 && counters.video === 10) started.resolve();
    await release.promise;
    shot[kind] = {file:'done'};
  }
  const pipeline = runFilmShotPipeline(p, {
    check() {}, save() {},
    image: (shot, index, kind) => run(shot, kind),
    video: shot => run(shot, 'video'),
  });
  try {
    await Promise.race([started.promise, sleep(250).then(() => {throw Error('queues did not overlap');})]);
    assert.deepEqual(counters, {frame:10,video:10});
  } finally {
    release.resolve();
    await pipeline;
  }
});
