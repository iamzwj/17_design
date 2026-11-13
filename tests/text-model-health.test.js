import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startTextModelHealth } from '../server/textModelHealth.js'

test('retries an earlier failed probe and exposes only successful models', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'text-health-'))
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format()
  fs.writeFileSync(path.join(dataDir, 'text-model-health.json'), JSON.stringify({ day, checkedAt: new Date(Date.now() - 120_000).toISOString(), available: [] }))
  let calls = 0
  const health = startTextModelHealth({ dataDir, complete: async ({ model }) => { calls++; if (model !== 'gemini-3.1-pro') throw new Error('timeout'); return 'OK' }, readText: text => text })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 4)
  assert.equal(health().allModels.length, 4)
  assert.equal(health().allModels.filter(model => model.disabled && model.status === '维护中').length, 3)
  assert.equal(health().allModels[0].disabled, false)
  assert.deepEqual(health().models.map(model => model.value), ['gemini-3.1-pro'])
  fs.rmSync(dataDir, { recursive: true, force: true })
})
