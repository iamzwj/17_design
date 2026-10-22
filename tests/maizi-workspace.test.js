import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'

test('Maizi jobs survive a server restart without resubmission; partial success refunds only failed images', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-maizi-'))
  const token = randomUUID(), submissions = []; let complete = false
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const mock = http.createServer(async (req, res) => {
    if (req.url === '/image.png') { res.setHeader('Content-Type', 'image/png'); res.end(png); return }
    res.setHeader('Content-Type', 'application/json'); assert.equal(req.headers.authorization, 'Bearer maizi-test-only')
    if (req.url.startsWith('/v1/tasks/')) {
      const id = req.url.split('/').at(-1)
      res.end(JSON.stringify(!complete ? { data: [{ task_id: id, status: 'processing' }] } : id === 'saved-1' ? { id, status: 'failed', error_msg: 'synthetic failure' } : { id, status: 'completed', result_urls: [`http://127.0.0.1:${mock.address().port}/image.png`] })); return
    }
    if (req.url === '/v2/images/generations') { for await (const chunk of req) void chunk; res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${mock.address().port}/image.png` }] })); return }
    if (!['/v1/images/generations', '/v1/images/edits'].includes(req.url)) { res.statusCode = 400; res.end('{"detail":"wrong provider route"}'); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    let body
    if (req.headers['content-type'].includes('multipart')) { const form = await new Request('http://localhost', { method: 'POST', headers: req.headers, body: Buffer.from(raw) }).formData(); body = { model: form.get('model'), quality: form.get('quality'), size: form.get('size'), resolution: form.get('resolution'), imageBytes: form.get('image').size } }
    else body = JSON.parse(raw)
    submissions.push({ path: req.url, body }); res.end(JSON.stringify({ created: 1, data: [{ task_id: `saved-${submissions.length}`, status: 'pending' }] }))
  })
  await new Promise((r) => mock.listen(0, '127.0.0.1', r))
  const probe = http.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise((r) => probe.close(r))
  fs.writeFileSync(path.join(directory, 'auth.json'), JSON.stringify({ users: [{ id: 'qa', email: 'qa@example.test', passwordHash: 'unused', credits: 100 }], codes: [], sessions: [{ tokenHash: createHash('sha256').update(token).digest('hex'), userId: 'qa', expiresAt: Date.now() + 3600000 }] }))
  let logs = ''
  const start = () => { const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DIEFA_DATA_DIR: directory, MAIZI_BASE_URL: `http://127.0.0.1:${mock.address().port}`, MAIZI_API_KEY: 'maizi-test-only', GRSAI_BASE_URL: `http://127.0.0.1:${mock.address().port}`, GRSAI_API_KEY: 'wrong-provider-key' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', (d) => { logs += d }); child.stderr.on('data', (d) => { logs += d }); return child }
  let child = start()
  const call = async (url, body) => { const response = await fetch(`http://127.0.0.1:${port}${url}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() } }
  async function until(check) { for (let i = 0; i < 150; i++) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 100)) }; throw Error(logs.slice(-1500)) }
  const healthy = () => until(async () => { try { return (await call('/api/health')).status === 200 } catch { return false } })
  try {
    await healthy()
    assert.equal((await call('/api/image', { model: 'gpt-image-2.5-flare-t', prompt: 'direct test', aspectRatio: '1:1', resolution: '1k' })).status, 200)
    const initialCredits = (await call('/api/auth/me')).data.user.credits
    const first = await call('/api/waterfall/tasks', { model: 'gpt-image-2.5-flare-t', prompt: 'test', aspectRatio: '9:16', resolution: '2k', count: 2 }); assert.equal(first.status, 202); assert.equal(first.data.task.generationSize, '2K')
    const second = await call('/api/waterfall/tasks', { model: 'gpt-image-2.5-sunburst-t', prompt: 'edit test', aspectRatio: '1:1', resolution: '4k', count: 1, images: [`data:image/png;base64,${png.toString('base64')}`] }); assert.equal(second.status, 202)
    await until(async () => { const a = (await call(`/api/waterfall/tasks/${first.data.task.id}`)).data.task, b = (await call(`/api/waterfall/tasks/${second.data.task.id}`)).data.task; return [...a.slots, ...b.slots].every((s) => s.upstreamId) })
    child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); complete = true; child = start(); await healthy()
    const firstDone = await until(async () => { const t = (await call(`/api/waterfall/tasks/${first.data.task.id}`)).data.task; return t.status !== 'running' ? t : null }); assert.equal(firstDone.status, 'partial'); assert.equal(firstDone.slots.filter((s) => s.status === 'succeeded').length, 1)
    await until(async () => (await call(`/api/waterfall/tasks/${second.data.task.id}`)).data.task.status === 'succeeded')
    assert.equal(submissions.length, 3, 'saved provider task IDs must be reused after restart'); assert.ok(submissions.every((s) => s.body.quality === 'low')); const edit = submissions.find((s) => s.path.endsWith('/edits')); assert.ok(edit.body.imageBytes > 0); assert.equal(edit.body.resolution, '4K'); assert.equal((await call('/api/waterfall/tasks')).data.user.credits, initialCredits - 2)
  } finally { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); await new Promise((r) => mock.close(r)); fs.rmSync(directory, { recursive: true, force: true }) }
})
