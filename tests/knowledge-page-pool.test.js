import test from 'node:test'
import assert from 'node:assert/strict'
import { processPagePool } from '../server/knowledge/pagePool.js'
test('failure waits for already running pages and does not start untouched pages', async () => {
  let release, settled = false
  const gate = new Promise((r) => { release = r }), started = [], saved = []
  const operation = processPagePool([1, 2, 3], async (page) => {
    started.push(page)
    if (page === 1) throw new Error('temporary failure')
    await gate
    saved.push(page)
  }, 2)
  operation.catch(() => { settled = true })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(started, [1, 2]); assert.equal(settled, false)
  release()
  await assert.rejects(operation, /temporary failure/)
  assert.deepEqual(saved, [2]); assert.deepEqual(started, [1, 2])
})
