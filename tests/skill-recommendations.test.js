import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSkillRecommendations } from '../server/skillRecommendations.js'
test('recommendations rank verified usable rules, deduplicate requests and persist metadata only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-recs-')), cacheFile = path.join(dir, 'cache.json')
  let calls = 0
  const candidates = [{ name: 'poster-one', source: 'a/skills', installs: 50, fit: { targets: ['image'] } }, { name: 'video-two', source: 'a/skills', installs: 500, fit: { targets: ['video'] } }, { name: 'image-cli', source: 'a/skills', installs: 10000, fit: { targets: ['image'] } }, { name: 'frontend', source: 'a/skills', installs: 99999, fit: { targets: [] } }]
  const options = { cacheFile, search: async () => { calls++; return candidates }, inspect: async (record) => ({ ...record, markdown: 'PRIVATE_MD_BODY', compatibility: { usable: record.name !== 'image-cli' }, sha256: 'hash', commit: 'a'.repeat(40) }) }
  try {
    const store = createSkillRecommendations(options)
    assert.equal(store.get().status, 'running'); store.get()
    const result = await store.wait()
    assert.equal(calls, 8); assert.equal(result.status, 'ready')
    assert.deepEqual(result.skills.map((s) => s.name), ['video-two', 'poster-one'])
    assert.ok(!fs.readFileSync(cacheFile, 'utf8').includes('PRIVATE_MD_BODY'))
    assert.equal(createSkillRecommendations({ ...options, search: () => { throw new Error('must use cached results') } }).get().skills.length, 2)
    let time = Date.now() + 13 * 3600000
    const stale = createSkillRecommendations({ ...options, now: () => time, search: async () => { throw new Error('offline') } })
    assert.equal(stale.get().skills.length, 2); await stale.wait(); assert.equal(stale.get().status, 'ready'); assert.equal(stale.get().stale, true)
    time += 1
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a release includes a verified ranked starter list so first visit is not empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-rec-seed-'))
  try {
    const store = createSkillRecommendations({ cacheFile: path.join(dir, 'absent.json'), seedFile: new URL('../server/skillRecommendations.seed.json', import.meta.url), search: async () => [], inspect: async () => null })
    const skills = store.peek()
    assert.ok(skills.length > 0)
    assert.ok(skills.every((skill) => skill.compatibility.usable && skill.fit.targets.length && !Object.hasOwn(skill, 'markdown') && /^[a-f0-9]{40}$/.test(skill.commit)))
    assert.deepEqual(skills.map((s) => s.installs), skills.map((s) => s.installs).sort((a, b) => b - a))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
