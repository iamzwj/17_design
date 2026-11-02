import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreviewQueue } from '../src/knowledgePreviewQueue.js'
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('large manuals use at most two preview connections and discard cancelled queued pages', async () => {
  const enqueue = createPreviewQueue(2), controllers = [], releases = []
  let started = 0, active = 0, peak = 0
  const tasks = Array.from({ length: 89 }, (_, page) => {
    const controller = new AbortController(); controllers.push(controller)
    return enqueue(() => new Promise((resolve, reject) => {
      started++; active++; peak = Math.max(peak, active)
      const done = () => { active--; resolve(page) }
      releases.push(done)
      controller.signal.addEventListener('abort', () => { active--; reject(controller.signal.reason) }, { once: true })
    }), controller.signal).catch((e) => e.name)
  })
  await tick()
  assert.equal(started, 2)
  controllers.slice(2).forEach((c) => c.abort())
  releases.forEach((release) => release())
  const result = await Promise.all(tasks)
  assert.deepEqual(result.slice(0, 2), [0, 1])
  assert.ok(result.slice(2).every((r) => r === 'AbortError'))
  assert.equal(started, 2); assert.equal(peak, 2)
})

test('leaving a page aborts running previews and frees slots for the next document', async () => {
  const enqueue = createPreviewQueue(2), controller = new AbortController()
  const pending = Array.from({ length: 2 }, () => enqueue(() => new Promise((resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  }), controller.signal).catch((e) => e.name))
  await tick()
  const next = enqueue(async () => 'next document')
  controller.abort()
  assert.deepEqual(await Promise.all(pending), ['AbortError', 'AbortError'])
  assert.equal(await next, 'next document')
})

test('failed or already-cancelled previews do not stall later work', async () => {
  const enqueue = createPreviewQueue(1), controller = new AbortController()
  controller.abort()
  await assert.rejects(enqueue(() => assert.fail('must not start'), controller.signal), { name: 'AbortError' })
  const failed = enqueue(() => { throw new Error('network failure') })
  const next = enqueue(async () => 'loaded')
  await assert.rejects(failed, /network failure/)
  assert.equal(await next, 'loaded')
})
