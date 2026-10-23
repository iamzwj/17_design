import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { installSkills, normalizeSkillResult, validateSkillMarkdown } from '../server/skills.js'
import { createSkillCompletion } from '../server/skillCompletion.js'

const rawSkill = JSON.stringify({ title: '活动方案审核', summary: '根据页码定位活动方案中的落地问题', slug: 'review-event-plan', body: '# 活动方案审核\n\n阅读用户提供的方案，按严重程度和页码给出意见，区分必改问题和可选建议。' })
const markdown = normalizeSkillResult('generate', rawSkill).markdown
const delay = () => new Promise((resolve) => setTimeout(resolve, 30))
async function boot(dataDir, complete = async () => ({ content: rawSkill, model: 'test-model' })) {
  const app = express(); app.use(express.json({ limit: '1mb' }))
  installSkills(app, { dataDir, complete, requireAuth(req, res, next) { const id = req.headers['x-user']; if (!id) return res.status(401).json({ error: 'login' }); req.user = { id, email: `${id}@example.test` }; next() } })
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r))
  return { server, async call(route = '', body, user = 'alice', method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/skills${route}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-User': user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, data: response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer()) }
  }, async close() { server.closeAllConnections(); await new Promise((r) => server.close(r)) } }
}
test('Skill drafts, publication snapshots, authorship, revision conflicts, version history and downloads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-skills-test-')); const api = await boot(dir)
  try {
    assert.equal((await api.call('', undefined, null)).status, 401)
    let skill = (await api.call('', {})).data.skill
    assert.equal((await api.call('', undefined, 'bob')).data.skills.length, 0)
    assert.equal((await api.call('?mine=1')).data.skills.length, 1)
    assert.equal((await api.call(`/${skill.id}`, skill, 'bob', 'PUT')).status, 404)
    skill = (await api.call(`/${skill.id}`, { ...skill, title: '审核', purpose: '审核方案', summary: '找问题', markdown }, 'alice', 'PUT')).data.skill
    assert.equal((await api.call(`/${skill.id}/publish`, { revision: 1 })).status, 409)
    skill = (await api.call(`/${skill.id}/publish`, { revision: skill.revision })).data.skill
    const publicSkill = (await api.call('', undefined, 'bob')).data.skills[0]
    assert.equal((await api.call('?mine=1', undefined, 'bob')).data.skills.length, 0)
    assert.equal(publicSkill.title, '审核'); assert.equal(publicSkill.history, undefined); assert.equal(publicSkill.purpose, undefined)
    assert.equal((await api.call(`/${skill.id}/download`, undefined, 'bob')).data, markdown)
    skill = (await api.call(`/${skill.id}`, { ...skill, title: '未发布修改', markdown: markdown + '\n新规则' }, 'alice', 'PUT')).data.skill
    assert.equal(skill.history.length, 1); assert.equal(skill.history[0].markdown, markdown)
    assert.equal((await api.call('', undefined, 'bob')).data.skills[0].title, '审核')
    assert.equal((await api.call(`/${skill.id}/download?draft=1`, undefined, 'bob')).data, markdown)
    assert.equal((await api.call(`/${skill.id}/download?draft=1`)).data, markdown + '\n新规则')
    skill = (await api.call(`/${skill.id}/unpublish`, { revision: skill.revision })).data.skill
    assert.equal((await api.call('', undefined, 'bob')).data.skills.length, 0)
    assert.equal((await api.call(`/${skill.id}/download`, undefined, 'bob')).status, 404)
    assert.equal((await api.call('?mine=1', undefined, 'bob')).data.skills.length, 0)
    const incomplete = (await api.call(`/${skill.id}`, { ...skill, markdown: 'unfinished' }, 'alice', 'PUT')).data.skill
    assert.equal((await api.call(`/${skill.id}/publish`, { revision: incomplete.revision })).status, 400)
  } finally { await api.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
test('AI tasks persist input before response, deduplicate, keep results private, recover after restart and preserve draft on failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-skills-jobs-'))
  let calls = 0, release
  let api = await boot(dir, async () => { calls++; await new Promise((r) => { release = r }); return { content: '{"questions":["请提供输入和理想结果"]}', model: 'primary' } })
  try {
    let skill = (await api.call('', {})).data.skill
    skill = (await api.call(`/${skill.id}`, { ...skill, purpose: '审核活动方案' }, 'alice', 'PUT')).data.skill
    const request = { mode: 'guide', requestId: randomUUID(), revision: skill.revision }
    assert.equal((await api.call(`/${skill.id}/tasks`, request)).status, 202)
    assert.equal((await api.call(`/${skill.id}/tasks`, request)).status, 200)
    assert.equal(calls, 1)
    assert.equal((await api.call(`/${skill.id}/tasks`, { ...request, requestId: randomUUID() })).status, 409)
    assert.equal((await api.call('/tasks', undefined, 'bob')).data.tasks.length, 0)
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'skills.json')))
    assert.equal(persisted.tasks[0].input.purpose, '审核活动方案')
    release(); await delay()
    const task = (await api.call('/tasks')).data.tasks[0]
    assert.equal(task.status, 'succeeded'); assert.equal(task.result.questions.length, 1); assert.equal(task.input, undefined)
    await api.close()
    persisted.tasks = [{ ...persisted.tasks[0], id: randomUUID(), mode: 'generate', status: 'running', input: { purpose: '恢复生成', mode: 'generate' } }]
    fs.writeFileSync(path.join(dir, 'skills.json'), JSON.stringify(persisted))
    api = await boot(dir); await delay()
    assert.equal((await api.call('/tasks')).data.tasks[0].result.markdown, markdown)
    // Generating creates a proposal, never silently overwrites the saved document.
    assert.equal((await api.call('?mine=1')).data.skills[0].markdown, '')
    await api.close(); api = await boot(dir, async () => { throw new Error('provider unavailable') })
    const failed = { mode: 'generate', requestId: randomUUID(), revision: skill.revision }
    await api.call(`/${skill.id}/tasks`, failed); await delay()
    assert.equal((await api.call('/tasks')).data.tasks.find((t) => t.id === failed.requestId).status, 'failed')
    assert.equal((await api.call('?mine=1')).data.skills[0].purpose, '审核活动方案')
  } finally { await api.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
test('Skill model fallback handles primary timeout and invalid output, while preserving real AI output', async () => {
  for (const first of ['timeout', 'invalid']) {
    const seen = []
    const complete = createSkillCompletion({ models: ['primary', 'fallback'], text: (data) => data.content, request: async (_url, body) => {
      seen.push(body.model)
      if (body.model === 'primary') { if (first === 'timeout') throw new Error('timeout'); return { content: 'invalid JSON' } }
      return { content: rawSkill, model: 'fallback' }
    } })
    const result = await complete([], 'generate')
    assert.deepEqual(seen, ['primary', 'fallback']); assert.equal(result.model, 'fallback'); assert.equal(result.content, rawSkill)
  }
  const unavailable = createSkillCompletion({ models: ['primary', 'fallback'], text: () => '', request: async () => { throw new Error('unavailable') } })
  await assert.rejects(unavailable([], 'generate'), /unavailable/)
  assert.throws(() => validateSkillMarkdown('---\nname: Bad Name\ndescription: bad\n---\nbody'))
  assert.throws(() => normalizeSkillResult('guide', '{"questions":[1]}'))
})

test('Markdown import preserves the original file, supports YAML metadata, remains private and can be edited, published and downloaded', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-skill-import-')); const api = await boot(dir)
  const original = '\uFEFF---\r\nname: imported-review\r\ndescription: >-\r\n  审核活动方案，\r\n  并给出明确意见。\r\nmetadata:\r\n  version: 1\r\nallowed-tools: Read\r\n---\r\n\r\n# 我自己的审核方法\r\n\r\n保持名称、数据和事实。\r\n'
  try {
    assert.equal((await api.call('/import', { fileName: 'SKILL.md', markdown: original }, null)).status, 401)
    const imported = await api.call('/import', { fileName: 'SKILL.MD', markdown: original })
    assert.equal(imported.status, 201); assert.equal(imported.data.warning, '')
    let skill = imported.data.skill
    assert.equal(skill.title, '我自己的审核方法'); assert.equal(skill.summary, '审核活动方案， 并给出明确意见。')
    assert.equal(skill.markdown, original); assert.equal(skill.publishedAt, null)
    assert.equal((await api.call('', undefined, 'bob')).data.skills.length, 0)
    assert.equal((await api.call(`/${skill.id}/download?draft=1`)).data, original)
    assert.equal((await api.call(`/${skill.id}/download?draft=1`, undefined, 'bob')).status, 404)
    skill = (await api.call(`/${skill.id}`, { ...skill, markdown: original + '\r\n按页码列出问题。' }, 'alice', 'PUT')).data.skill
    assert.equal(skill.history[0].markdown, original)
    await api.call(`/${skill.id}/publish`, { revision: skill.revision })
    assert.equal((await api.call(`/${skill.id}/download`, undefined, 'bob')).data, original + '\r\n按页码列出问题。')
    const plain = await api.call('/import', { fileName: '个人经验.md', markdown: '# 个人经验\n\n请按这份方法处理。\n' })
    assert.equal(plain.status, 201); assert.equal(plain.data.skill.title, '个人经验'); assert.ok(plain.data.warning)
    assert.equal((await api.call(`/${plain.data.skill.id}/publish`, { revision: plain.data.skill.revision })).status, 400)
    for (const body of [{ fileName: 'bad.txt', markdown: original }, { fileName: 'empty.md', markdown: ' ' }, { fileName: 'binary.md', markdown: '\0test' }, { fileName: 'big.md', markdown: 'a'.repeat(60001) }, { fileName: 'invalid.md', markdown: '---\nname: [broken\ndescription: desc\n---\nbody' }]) {
      assert.equal((await api.call('/import', body)).status, 400)
    }
    assert.equal((await api.call('?mine=1')).data.skills.length, 2)
  } finally { await api.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
