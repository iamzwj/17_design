import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'

// The upstream is a loopback-only recorder: no documents or credentials leave the machine.
test('real local vectors feed text, authenticated review and image requests; generation traces survive completion', { skip: !process.env.KNOWLEDGE_TEST_MODEL_CACHE }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-tools-'))
  const token = randomUUID(), captures = []
  let inspectFails = false
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#6240d4' } }).png().toBuffer()
  const mock = http.createServer(async (req, res) => {
    if (req.method === 'GET') { res.setHeader('Content-Type', 'image/png'); res.end(png); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); captures.push({ path: req.url, body }); res.setHeader('Content-Type', 'application/json')
    if (req.url.includes('chat/completions')) res.end(JSON.stringify({ model: 'local-test-recorder', choices: [{ message: { content: JSON.stringify(body.messages).includes('品牌Logo位置检查') ? JSON.stringify({ boxes: [], uncertain: inspectFails }) : '测试品牌标志使用紫色。' } }] }))
    else res.end(JSON.stringify({ status: 'succeeded', id: 'recorded-image', results: [{ url: `http://127.0.0.1:${mock.address().port}/test.png` }] }))
  })
  mock.listen(0, '127.0.0.1'); await new Promise((r) => mock.once('listening', r))
  const portProbe = http.createServer(); portProbe.listen(0, '127.0.0.1'); await new Promise((r) => portProbe.once('listening', r)); const port = portProbe.address().port; await new Promise((r) => portProbe.close(r))
  fs.writeFileSync(path.join(dataDir, 'auth.json'), JSON.stringify({ users: [{ id: 'test-admin', email: 'zhangwj159@onewo.com', passwordHash: 'not-for-login', credits: 999 }], codes: [], sessions: [{ tokenHash: createHash('sha256').update(token).digest('hex'), userId: 'test-admin', expiresAt: Date.now() + 3600000 }] }))
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DIEFA_DATA_DIR: dataDir, KNOWLEDGE_MODEL_CACHE: process.env.KNOWLEDGE_TEST_MODEL_CACHE, GRSAI_BASE_URL: `http://127.0.0.1:${mock.address().port}`, GRSAI_API_KEY: 'local-test-only' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''; child.stdout.on('data', (d) => { logs += d }); child.stderr.on('data', (d) => { logs += d })
  const base = `http://127.0.0.1:${port}`, headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Text-Session': 'qa-review-session' }
  async function call(p, body, auth = true) { const response = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: auth ? headers : { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json(); return { status: response.status, data } }
  async function until(check, limit = 100) { for (let i = 0; i < limit; i++) { const result = await check(); if (result) return result; await new Promise((r) => setTimeout(r, 100)) }; throw new Error(`timeout: ${logs.slice(-500)}`) }
  try {
    await until(async () => { try { return (await call('/api/health')).status === 200 } catch { return false } })
    const brand = (await call('/api/knowledge/bootstrap')).data.brands[0]
    await call('/api/knowledge/brands', { id: brand.id, name: '公开合成测试品牌', grants: {} })
    async function create(payload) {
      const d = await call('/api/knowledge/documents', { brandId: brand.id, ...payload }); assert.equal(d.status, 202)
      const detail = await until(async () => { const x = (await call(`/api/knowledge/documents/${d.data.document.id}`)).data; return x.versions.at(-1).status === 'ready' ? x : null }, 200)
      await call(`/api/knowledge/documents/${detail.document.id}/publish`, { versionId: detail.document.latestVersionId }); return detail.document.id
    }
    await create({ title: '合成规则', content: '公开测试品牌的Logo必须使用紫色。', kind: 'rule' })
    const imageId = await create({ title: '合成参考色块', content: '用于测试图片传递的纯紫色方块', kind: 'logo', file: { name: 'test.png', base64: png.toString('base64') } })
    const input = { requestId: randomUUID(), systemPrompt: '测试回答', messages: [{ role: 'user', content: '标志应该用什么颜色？' }], knowledge: { brandId: brand.id } }
    const posted = await call('/api/text/tasks', input); assert.equal(posted.status, 202)
    await call('/api/text/tasks', input)
    const text = await until(async () => { const task = (await call(`/api/text/tasks/${input.requestId}`)).data.task; assert.notEqual(task.status, 'failed', task.error); return task.status === 'succeeded' ? task.result : null })
    assert.ok(text.knowledgeTraceId); assert.ok(text.sources.some((s) => s.title.includes('合成规则')))
    assert.equal(captures.filter((x) => x.path.includes('chat')).length, 1)
    assert.ok(captures[0].body.messages[0].content.includes('Logo必须使用紫色'))
    assert.equal((await call('/api/compliance/tasks', { ...input, requestId: randomUUID() }, false)).status, 401)
    const reviewId = randomUUID(); assert.equal((await call('/api/compliance/tasks', { ...input, requestId: reviewId })).status, 202)
    await until(async () => (await call(`/api/compliance/tasks/${reviewId}`)).data.task.status === 'succeeded')
    assert.equal((await call(`/api/compliance/tasks/${reviewId}`, undefined, false)).status, 404)
    const generated = await call('/api/waterfall/tasks', { prompt: '只输出合成测试色块', count: 1, aspectRatio: '1:1', resolution: '1k', quality: 'low', knowledge: { brandId: brand.id, assetIds: [imageId] } })
    assert.equal(generated.status, 202, JSON.stringify(generated.data)); assert.equal(generated.data.task.referenceImages.length, 0, 'private brand source must not be copied into public waterfall asset URLs'); const taskId = generated.data.task.id
    await until(async () => { const t = (await call(`/api/waterfall/tasks/${taskId}`)).data.task; assert.notEqual(t.status, 'failed', JSON.stringify(t.slots)); if (t.status === 'succeeded') assert.equal(t.slots[0].logoApplied, true); return t.status === 'succeeded' ? t : null })
    const imageCall = captures.find((x) => x.path.includes('/generate'))
    assert.equal(imageCall.body.model, 'gpt-image-2.5')
    assert.ok(imageCall.body.prompt.includes('禁止模型绘制任何品牌Logo'))
    assert.ok(imageCall.body.prompt.includes('Logo必须使用紫色')); assert.equal(imageCall.body.images.length, 0, 'Logo used for post-composition must never be passed to the image model')
    const traces = (await call(`/api/knowledge/traces?brandId=${brand.id}`)).data.traces
    assert.equal(traces.length, 3); assert.ok(traces.every((t) => t.status === 'succeeded')); assert.ok(traces.some((t) => t.taskId === taskId && t.assets[0].documentId === imageId && t.compositions[`${taskId}-0`]))
    inspectFails = true
    const uncertain = await call('/api/waterfall/tasks', { prompt: '测试检查失败时保留底图', count: 1, model: 'gpt-image-2.5', knowledge: { brandId: brand.id } })
    const retained = await until(async () => { const t = (await call(`/api/waterfall/tasks/${uncertain.data.task.id}`)).data.task; assert.notEqual(t.status, 'failed', JSON.stringify(t.slots)); return t.status === 'succeeded' ? t : null })
    assert.equal(retained.slots[0].logoApplied, false); assert.match(retained.slots[0].brandWarning, /Logo未合成/); assert.ok(retained.slots[0].url)
    assert.ok(fs.existsSync(path.join(dataDir, 'waterfall-assets', `${retained.id}-0.before-logo.png`)))

  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)) }; mock.closeAllConnections(); await new Promise((r) => mock.close(r)); fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
