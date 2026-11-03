// One shared snapshot is updated synchronously by this worker. Keep in-flight jobs
// alive after one failure, then stop dispatching new work and report that failure.
export async function filmPool(items, limit, run) {
  let cursor = 0, failure;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      const index = cursor++;
      try { await run(items[index], index); }
      catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
}
