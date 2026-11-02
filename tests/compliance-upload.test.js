import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

test('uploaded underscore filenames remain readable by persistent compliance reviews', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-compliance-'))
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer()
  const calls = []
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    calls.push({ url: req.url, body: JSON.parse(raw) })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url.includes('generateContent')
      ? { candidates: [{ content: { parts: [{ text: '图片为白色测试方块。' }] } }] }
      : { choices: [{ message: { content: '审核结论：通过\n得分：100' } }] }))
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const probe = http.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r))
  const port = probe.address().port; await new Promise((r) => probe.close(r))
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DIEFA_DATA_DIR: dir, GRSAI_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, GRSAI_API_KEY: 'local-only' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''; child.stdout.on('data', (x) => { logs += x }); child.stderr.on('data', (x) => { logs += x })
  async function call(url, body) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Text-Session': 'upload-regression' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: await response.json() }
  }
  async function until(check) {
    for (let i = 0; i < 150; i++) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 100)) }
    throw Error(logs || 'Timeout')
  }
  try {
    await until(async () => { try { return (await call('/api/health')).status === 200 } catch { return false } })
    const uploaded = await call('/api/compliance/uploads', { name: '_17935903589858.png', source: `data:image/png;base64,${png.toString('base64')}` })
    assert.equal(uploaded.status, 201)
    assert.match(uploaded.data.url, /\/assets\/_/)
    assert.deepEqual(Buffer.from(await (await fetch(`http://127.0.0.1:${port}${uploaded.data.url}`)).arrayBuffer()), png)
    const requestId = randomUUID()
    const created = await call('/api/compliance/tasks', { requestId, messages: [{ role: 'user', content: [{ type: 'text', text: '审核测试图片' }, { type: 'image_url', image_url: { url: uploaded.data.url } }] }] })
    assert.equal(created.status, 202)
    const task = await until(async () => { const { data } = await call(`/api/compliance/tasks/${requestId}`); assert.notEqual(data.task.status, 'failed', data.task.error); return data.task.status === 'succeeded' && data.task })
    assert.match(task.result.content, /通过/)
    const vision = calls.find((c) => c.url.includes('generateContent'))
    assert.equal(vision.body.contents[0].parts.find((p) => p.inline_data).inline_data.data, png.toString('base64'))
    for (const source of ['/api/waterfall/assets/../auth.json', '/api/waterfall/assets/%2e%2e%2fauth.json']) {
      const result = await call('/api/compliance/review', { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: source } }] }] })
      assert.equal(result.status, 500); assert.match(result.data.error, /不支持的图片地址/)
    }
  } finally {
    child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r))
    await new Promise((r) => upstream.close(r)); fs.rmSync(dir, { recursive: true, force: true })
  }
})
