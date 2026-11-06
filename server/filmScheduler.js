export function createFilmDispatcher(run, onError) {
  const active = new Set();
  return (projects, hasCommands, now = Date.now()) => {
    for (const p of projects) {
      if (active.has(p.id)) continue;
      const runnable = !p.schedulingPaused && ['queued', 'running'].includes(p.status) &&
        (!p.nextRunAt || p.nextRunAt <= now);
      const recovering = p.tasks?.some(t => t.providerId && ['running', 'failed'].includes(t.status));
      if (!runnable && !recovering && !hasCommands(p)) continue;
      active.add(p.id);
      Promise.resolve().then(() => run(p)).catch(onError).finally(() => active.delete(p.id));
    }
  };
}
