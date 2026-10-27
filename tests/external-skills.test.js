import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { externalSkillFit } from '../shared/externalSkillFit.js'
import { installExternalSkills, externalSkillCompatibility } from '../server/externalSkills.js'

test('external installs are owner-only, pinned, hash checked and contain no server Markdown', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-skills-'))
  let markdown = '---\nname: poster-rules\ndescription: 海报规则\n---\n\n只使用紫色纸雕材质。', commit = 'a'.repeat(40)
  let transientFailure = true, rawUnavailable = false
  const urls = [], app = express(); app.use(express.json())
  const library = installExternalSkills(app, { dataDir: dir, requireAuth(req, res, next) { if (!req.headers['x-user']) return res.status(401).json({ error: 'login' }); req.user = { id: req.headers['x-user'] }; next() }, fetchImpl: async (url) => {
    urls.push(url)
    if (transientFailure) { transientFailure = false; throw new DOMException('timeout', 'TimeoutError') }
    if (rawUnavailable && url.includes('raw.githubusercontent.com')) throw new DOMException('timeout', 'TimeoutError')
    if (url.includes('/contents/')) return Response.json({ type: 'file', encoding: 'base64', size: Buffer.byteLength(markdown), content: Buffer.from(markdown).toString('base64') })
    const data = url.includes('skills.sh') ? { skills: [{ name: 'poster-rules', source: 'example/skills', installs: 123 }, { name: 'evil', source: 'https://bad.test' }] } : url.endsWith('/commits/HEAD') ? { sha: commit } : url.includes('/git/trees/') ? { tree: [{ path: 'skills/poster-rules/SKILL.md', type: 'blob', mode: '100644' }] } : null
    return new Response(data ? JSON.stringify(data) : markdown, { headers: { 'content-type': data ? 'application/json' : 'text/plain' } })
  } })
  app.use((e, _req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r))
  async function call(route, body, user = 'alice', method = body === undefined ? 'GET' : 'POST') { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/skills/external${route}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-User': user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json() } }
  try {
    assert.equal((await call('/installed', undefined, null)).status, 401)
    assert.equal((await call('/search?q=poster')).data.skills.length, 1)
    assert.equal((await call('/preview', { source: '../../evil', name: 'poster-rules' })).status, 400)
    let preview = (await call('/preview', { source: 'example/skills', name: 'poster-rules' })).data.preview
    assert.equal(preview.compatibility.usable, true)
    assert.equal((await call('/installed', { previewId: preview.previewId }, 'bob')).status, 409)
    const installed = (await call('/installed', { previewId: preview.previewId })).data
    assert.equal(installed.markdown, markdown)
    assert.equal((await call('/installed', undefined, 'bob')).data.skills.length, 0)
    assert.equal((await call(`/${installed.skill.id}/download`, undefined, 'bob')).status, 404)
    assert.equal((await call(`/${installed.skill.id}`, undefined, 'bob', 'DELETE')).status, 404)
    assert.throws(() => library.resolve({ id: 'alice' }, installed.skill.id, 'image'), /本机缺少/)
    assert.throws(() => library.resolve({ id: 'alice' }, installed.skill.id, 'image', { markdown: markdown + 'tamper' }), /损坏/)
    assert.equal(library.resolve({ id: 'alice' }, installed.skill.id, 'image', { markdown }).markdown, markdown)
    const disk = fs.readFileSync(path.join(dir, 'external-skill-installs.json'), 'utf8')
    assert.ok(!disk.includes('紫色纸雕')); assert.ok(!disk.includes('markdown'))
    assert.equal((await call(`/${installed.skill.id}/download`)).data.markdown, markdown)
    assert.ok(urls.at(-1).includes('/' + 'a'.repeat(40) + '/'))
    rawUnavailable = true
    assert.equal((await call(`/${installed.skill.id}/download`)).data.markdown, markdown, 'same pinned version remains downloadable when raw domain is unavailable')
    markdown += '\n新版本'; commit = 'b'.repeat(40)
    assert.equal((await call(`/${installed.skill.id}/download`)).status, 409)
    preview = (await call('/preview', { source: 'example/skills', name: 'poster-rules' })).data.preview
    assert.notEqual((await call('/installed', { previewId: preview.previewId })).data.skill.id, installed.skill.id)
    assert.equal((await call('/installed')).data.skills.length, 2)
    assert.equal(externalSkillCompatibility(markdown, ['SKILL.md', 'scripts/run.py']).usable, false)
    assert.equal(externalSkillCompatibility(markdown + '\nnpx run-tool').usable, false)
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('purpose filters restrict generator targets and distinguish related references from executable rules', () => {
  assert.deepEqual(externalSkillFit({ name: 'poster-design' }).targets, ['image'])
  assert.deepEqual(externalSkillFit({ name: 'video-storyboard' }).targets, ['video'])
  assert.deepEqual(externalSkillFit({ name: 'image-video', summary: '生成图片和视频' }).targets, ['image', 'video'])
  assert.equal(externalSkillFit({ name: 'copywriting' }).category, 'planning')
  assert.deepEqual(externalSkillFit({ name: 'marketing-strategy' }).targets, [])
  assert.equal(externalSkillFit({ name: 'frontend-design', summary: 'Build web image galleries with React' }).category, 'other')
  assert.deepEqual(externalSkillFit({ name: 'unknown-method' }).targets, [])
})
