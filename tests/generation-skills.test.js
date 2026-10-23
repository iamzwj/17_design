import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'

test('published skills drive real image/video provider payloads; built-in title keeps its reference; task snapshots survive changes and restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-generation-skills-'))
  const token = randomUUID(), submissions = []
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const mock = http.createServer(async (req, res) => {
    if (req.url === '/image.png') { res.setHeader('Content-Type', 'image/png'); res.end(png); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}; submissions.push({ path: req.url, body }); res.setHeader('Content-Type', 'application/json')
    if (req.url === '/tasks') { res.end(JSON.stringify({ code: 200, data: { task_id: randomUUID() } })); return }
    if (body.model === 'minimax-h3') { res.end(JSON.stringify({ id: randomUUID(), status: 'processing' })); return }
    res.end(JSON.stringify({ id: randomUUID(), status: 'succeeded', results: [{ url: `http://127.0.0.1:${mock.address().port}/image.png` }] }))
  })
  await new Promise((r) => mock.listen(0, '127.0.0.1', r))
  const probe = http.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise((r) => probe.close(r))
  fs.writeFileSync(path.join(directory, 'auth.json'), JSON.stringify({ users: [{ id: 'qa', email: 'qa@example.test', passwordHash: 'unused', credits: 100 }], codes: [], sessions: [{ tokenHash: createHash('sha256').update(token).digest('hex'), userId: 'qa', expiresAt: Date.now() + 3600000 }] }))
  let logs = ''
  const start = () => { const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DIEFA_DATA_DIR: directory, GRSAI_BASE_URL: `http://127.0.0.1:${mock.address().port}`, GRSAI_API_KEY: 'test-only', VIBBIT_OPENAPI_BASE_URL: `http://127.0.0.1:${mock.address().port}`, VIBBIT_OPENAPI_KEY: 'test-only' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', (d) => { logs += d }); child.stderr.on('data', (d) => { logs += d }); return child }
  let child = start()
  const call = async (url, body, method = body === undefined ? 'GET' : 'POST') => { const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, data: response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : await response.text() } }
  async function until(check) { for (let i = 0; i < 150; i++) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 80)) }; throw Error(logs.slice(-1500)) }
  const healthy = () => until(async () => { try { return (await call('/api/health')).status === 200 } catch { return false } })
  const done = (id) => until(async () => { const t = (await call(`/api/waterfall/tasks/${id}`)).data.task; assert.notEqual(t.status, 'failed', JSON.stringify(t.slots)); return t.status === 'succeeded' ? t : null })
  try {
    await healthy()
    const builtins = (await call('/api/skills')).data.skills
    assert.equal(builtins.length, 1); assert.equal(builtins[0].id, 'pulin-title'); assert.equal(builtins[0].builtIn, true)
    assert.equal((await call('/api/skills?target=video')).data.skills.length, 0)
    assert.ok((await call('/api/skills/pulin-title/download')).data.includes('深钴蓝'))
    const markdown = '---\nname: generation-test\ndescription: "生成测试"\n---\n\n必须使用独特的紫色纸雕材质，主体完整，不添加文字。'
    let skill = (await call('/api/skills/import', { fileName: 'SKILL.md', markdown })).data.skill
    const image = { model: 'nano-banana-2.1', prompt: '纸雕蝴蝶', aspectRatio: '1:1', resolution: '1k', count: 1, skillId: skill.id }
    assert.equal((await call('/api/waterfall/tasks', image)).status, 404, 'private draft must not be executed as published')
    skill = (await call(`/api/skills/${skill.id}/publish`, { revision: skill.revision })).data.skill
    assert.equal((await call('/api/image', image)).status, 200)
    assert.ok(submissions.at(-1).body.prompt.includes('独特的紫色纸雕材质'))
    const submitted = await call('/api/waterfall/tasks', image); assert.equal(submitted.status, 202)
    const first = await done(submitted.data.task.id)
    assert.equal(first.prompt, '纸雕蝴蝶'); assert.equal(first.skillSnapshot.markdown, markdown)
    const video = { skillId: skill.id, prompt: '蝴蝶缓缓飞起', model: 'doubao-seedance-2-5-260628', resolution: '720p', durationSeconds: 4, aspectRatio: '16:9', referenceMode: 'reference' }
    assert.equal((await call('/api/video/tasks', video)).status, 202)
    assert.ok(JSON.parse(submissions.at(-1).body.input_info.input).prompt.includes('独特的紫色纸雕材质'))
    assert.equal((await call('/api/video/tasks', { ...video, model: 'minimax-h3', resolution: '768p', aspectRatio: 'landscape' })).status, 202)
    assert.ok(submissions.at(-1).body.prompt.includes('独特的紫色纸雕材质'))
    const titles = await call('/api/waterfall/tasks', { ...image, skillId: 'pulin-title', prompt: '主标题：羽球联赛；副标题：赛事预告' })
    const titleTask = await done(titles.data.task.id)
    assert.equal(titleTask.referenceImages.length, 1); assert.equal(titleTask.skillSnapshot.referenceCount, 1)
    assert.ok(submissions.at(-1).body.prompt.includes('深钴蓝')); assert.equal(submissions.at(-1).body.images.length, 1)
    assert.equal((await call('/api/video/tasks', { ...video, skillId: 'pulin-title' })).status, 400)
    const before = submissions.length
    assert.equal((await call('/api/waterfall/tasks', { ...image, skillId: 'missing' })).status, 404)
    assert.equal(submissions.length, before)
    skill = (await call(`/api/skills/${skill.id}`, { ...skill, targets: ['video'], markdown: markdown.replace('紫色', '橙色') }, 'PUT')).data.skill
    skill = (await call(`/api/skills/${skill.id}/publish`, { revision: skill.revision })).data.skill
    assert.equal((await call('/api/skills?target=image')).data.skills.some((s) => s.id === skill.id), false)
    assert.equal((await call('/api/waterfall/tasks', image)).status, 400)
    const retry = await call('/api/waterfall/tasks', { ...image, retryOf: first.id, skillSnapshot: { markdown: 'forged' } })
    const repeated = await done(retry.data.task.id)
    assert.equal(repeated.skillSnapshot.markdown, markdown); assert.ok(submissions.at(-1).body.prompt.includes('紫色')); assert.ok(!submissions.at(-1).body.prompt.includes('橙色'))
    const repeatTitle = await call('/api/waterfall/tasks', { ...image, skillId: 'pulin-title', retryOf: titleTask.id, images: titleTask.referenceImages })
    assert.equal((await done(repeatTitle.data.task.id)).referenceImages.length, 1, 'title reference must not be duplicated on retry')
    skill = (await call(`/api/skills/${skill.id}/unpublish`, { revision: skill.revision })).data.skill
    assert.equal((await call('/api/video/tasks', video)).status, 404)
    child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); child = start(); await healthy()
    assert.equal((await call(`/api/waterfall/tasks/${first.id}`)).data.task.skillSnapshot.markdown, markdown)
    const videos = (await call('/api/video/tasks')).data.tasks
    assert.equal(videos.length, 2); assert.ok(videos.every((t) => t.skillSnapshot.markdown === markdown && t.prompt === '蝴蝶缓缓飞起'))
  } finally { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); await new Promise((r) => mock.close(r)); fs.rmSync(directory, { recursive: true, force: true }) }
})
