import test from 'node:test';
import assert from 'node:assert/strict';
import { filmActiveJobSummary } from '../shared/filmActiveJobs.js';

test('active film jobs are grouped for one compact live-progress entry', () => {
  const project = {
    status: 'running',
    stage: 'videos',
    shots: [{ video: {} }, { frame: {} }, { frame: {} }, { frame: {} }],
    activeJobs: [
      { id: 'video:2', stage: 'videos' },
      { id: 'video:3', stage: 'videos' },
      { id: 'frame:4', stage: 'frames' },
    ],
  };
  assert.deepEqual(filmActiveJobSummary(project), [
    { stage: 'videos', label: '视频镜头', count: 2, progress: [1, 4] },
    { stage: 'frames', label: '分镜图片', count: 1, progress: [3, 4] },
  ]);
});

test('active work text follows real task stages and deduplicates split frame stages', async () => {
  const {filmActiveWorkLabel} = await import('../shared/filmActiveJobs.js');
  for (const [stage, name] of Object.entries({storyboard:'分镜',characters:'角色',script:'剧本',scenes:'场景'})) {
    assert.equal(filmActiveWorkLabel({status:'running', activeJobs:[{stage}]}), `正在制作${name}`);
  }
  assert.equal(filmActiveWorkLabel({status:'running',activeJobs:[{stage:'frames'},{stage:'images'}]}),'正在制作分镜');
});
