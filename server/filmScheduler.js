// Paused projects may still have provider jobs to recover, but must never
// occupy the execution queue ahead of a newly submitted project.
export function selectFilmProject(projects, { lastId, hasCommands, now = Date.now() }) {
  const start = projects.findIndex(p => p.id === lastId) + 1;
  const ordered = [...projects.slice(start), ...projects.slice(0, start)];
  return ordered.find(p => hasCommands(p)) || ordered.find(p =>
    !p.schedulingPaused && ['queued', 'running'].includes(p.status) &&
    (!p.nextRunAt || p.nextRunAt <= now));
}
