import { setTimeout as sleep } from 'node:timers/promises';

const CONCURRENCY_PER_MEDIA = 10;

// Only ready jobs occupy a slot. An image completion wakes the scheduler so
// its video can start while unrelated images are still running.
export async function runFilmShotPipeline(project, { check, save, image, video }) {
  const active = new Map();
  const scheduled = new Set();
  const ready = (shot, kind) => !shot[kind] && !shot[kind + 'Error'];
  const stageOpen = stage => !project.pausedStages?.[stage];

  function start(shot, index, kind) {
    const version = shot.revision || 1;
    const key = JSON.stringify([shot.id, version, kind, shot[kind + 'Retry'] || 0]);
    if (scheduled.has(key)) return 0;
    scheduled.add(key);
    const work = Promise.resolve().then(async () => {
      try {
        check(project);
        if (project.needsRerun || !project.shots.includes(shot) ||
            (shot.revision || 1) !== version || shot.paused || shot.stale ||
            !stageOpen(kind === 'video' ? 'videos' : 'images')) {
          scheduled.delete(key);
          return;
        }
        await (kind === 'video' ? video(shot, index) : image(shot, index, kind));
      } catch (error) {
        if (error.code === 'PAUSED' || (shot.revision || 1) !== version) return;
        shot[kind + 'Error'] ||= error.message;
        save(project);
      }
    }).finally(() => active.delete(shot.id));
    active.set(shot.id, {kind, work});
    return 1;
  }

  try {
    while (true) {
      check(project);
      if (!project.needsRerun) {
        for (const media of ['video', 'image']) {
          let running = [...active.values()].filter(job =>
            (job.kind === 'video' ? 'video' : 'image') === media).length;
          for (const [index, shot] of project.shots.entries()) {
            if (running >= CONCURRENCY_PER_MEDIA) break;
            if (active.has(shot.id) || shot.paused || shot.stale) continue;
            if (media === 'video') {
              if (stageOpen('videos') && shot.frame &&
                  (!shot.tailFramePrompt || shot.tail) && ready(shot, 'video')) running += start(shot, index, 'video');
            } else if (stageOpen('images')) {
              if (ready(shot, 'frame')) running += start(shot, index, 'frame');
              else if (shot.frame && shot.tailFramePrompt && ready(shot, 'tail')) running += start(shot, index, 'tail');
            }
          }
        }
      }
      if (!active.size) return;
      const jobs = [...active.values()];
      const stage = jobs.some(job => job.kind !== 'video') ? 'images' : 'videos';
      if (project.stage !== stage) {
        project.stage = stage;
        save(project);
      }
      // Also read retry/pause commands while every current request is polling.
      const tick = new AbortController();
      try {
        await Promise.race([...jobs.map(job => job.work), sleep(1000, undefined, {signal: tick.signal})]);
      } finally {
        tick.abort();
      }
    }
  } finally {
    await Promise.allSettled([...active.values()].map(job => job.work));
  }
}
