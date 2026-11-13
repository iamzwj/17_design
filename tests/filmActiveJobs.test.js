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
