// Leave browser connections available for navigation and small API requests.
export function createPreviewQueue(limit = 2) {
  let active = 0
  const waiting = []
  function drain() {
    while (active < limit && waiting.length) {
      const item = waiting.shift()
      item.signal?.removeEventListener('abort', item.cancel)
      if (item.signal?.aborted) { item.reject(item.signal.reason); continue }
      active++
      Promise.resolve().then(item.load).then(item.resolve, item.reject).finally(() => { active--; drain() })
    }
  }
  return (load, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const item = { load, signal, resolve, reject, cancel: () => {
      const index = waiting.indexOf(item)
      if (index >= 0) { waiting.splice(index, 1); reject(signal.reason) }
    } }
    waiting.push(item)
    signal?.addEventListener('abort', item.cancel, { once: true })
    drain()
  })
}
