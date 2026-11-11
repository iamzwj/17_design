// Only an explicit rejection permits resubmitting without a provider task ID.
export function isFilmRateLimit(error) {
  return error?.status === 429 || error?.upstreamCode === 429 ||
    /操作过于频繁，请稍后再试/.test(error?.message || '');
}

export function clearRejectedFilmSubmission(task, slot, kind) {
  if (!task || task.providerId || !isFilmRateLimit({ message: task.error })) return;
  task.submitting = false;
  slot[kind + 'Submitting'] = false;
}
