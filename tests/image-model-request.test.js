import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'

test('direct and persistent generation use model-specific parameters and preserve GIF frames', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-image-model-'))
  const token = randomUUID(), calls = []
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer()
  const gif = Buffer.from('47494638396101000100800000000000ffffff' +
    '21f90400640000002c0000000001000100000202440100' +
    '21f90400640000002c00000000010001000002024c01003b', 'hex')
  assert.equal((await sharp(gif).metadata()).pages, 2)
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/image.png') { res.setHeader('Content-Type', 'image/png'); res.end(png); return }
    if (req.url === '/image.gif') { res.setHeader('Content-Type', 'image/gif'); res.end(gif); return }
    let raw = ''; for await (const c of req) raw += c
    const input = JSON.parse(raw)
    const extension = input.model === 'gpt-image-2.6' ? 'gif' : 'png'
    calls.push(input); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: randomUUID(), status: 'succeeded', results: [{ url: `http://127.0.0.1:${upstream.address().port}/image.${extension}` }] }))
  })
  upstream.listen(0, '127.0.0.1'); await new Promise((r) => upstream.once('listening', r))
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await new Promise((r) => probe.once('listening', r)); const port = probe.address().port; await new Promise((r) => probe.close(r))
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ users: [{ id: 'qa', email: 'qa@example.test', passwordHash: 'not-for-login', credits: 100 }], codes: [], sessions: [{ tokenHash: createHash('sha256').update(token).digest('hex'), userId: 'qa', expiresAt: Date.now() + 3600000 }] }))
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DIEFA_DATA_DIR: dir, GRSAI_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, GRSAI_API_KEY: 'local-only' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''; child.stderr.on('data', (x) => { logs += x }); child.stdout.on('data', (x) => { logs += x })
  const call = async (url, body) => { const response = await fetch(`http://127.0.0.1:${port}${url}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Connection: 'close', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() } }
  async function until(check) { for (let i = 0; i < 100; i++) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 100)) }; throw Error(logs) }
  try {
    await until(async () => { try { return (await call('/api/health')).status === 200 } catch { return false } })
    const input = { model: 'nano-banana-2.1', prompt: '公开测试色块', aspectRatio: '9:16', resolution: '1k', count: 1 }
    assert.equal((await call('/api/image', input)).status, 200)
    const created = await call('/api/waterfall/tasks', { ...input, aspectRatio: '16:9', resolution: '4k' }); assert.equal(created.status, 202)
    await until(async () => { const task = (await call(`/api/waterfall/tasks/${created.data.task.id}`)).data.task; assert.notEqual(task.status, 'failed', JSON.stringify(task.slots)); return task.status === 'succeeded' })
    assert.equal(calls.length, 2); assert.equal(calls[0].model, input.model); assert.equal(calls[0].aspectRatio, '9:16'); assert.equal(calls[0].imageSize, '1K'); assert.equal(calls[1].aspectRatio, '16:9'); assert.equal(calls[1].imageSize, '4K'); assert.ok(calls.every((c) => !Object.hasOwn(c, 'quality')))
    const customInput = { ...input, model: 'gpt-image-2-vip', aspectRatio: '3840x1280' }
    assert.equal((await call('/api/image', customInput)).status, 200)
    assert.equal(calls.at(-1).aspectRatio, '3840x1280')
    const customTask = await call('/api/waterfall/tasks', { ...customInput, aspectRatio: '2048x1024' })
    assert.equal(customTask.status, 202)
    assert.equal(customTask.data.task.aspectRatio, '2048x1024')
    assert.equal(customTask.data.task.generationSize, '2048x1024')
    await until(async () => (await call(`/api/waterfall/tasks/${customTask.data.task.id}`)).data.task.status === 'succeeded')
    assert.equal(calls.at(-1).aspectRatio, '2048x1024')
    const gifInput = { ...input, model: 'gpt-image-2.6', resolution: '4k', quality: 'medium' }
    const directGif = await call('/api/image', gifInput)
    assert.equal(directGif.status, 200)
    assert.equal(directGif.data.resolution, '1k')
    assert.equal(calls.at(-1).replyType, 'json')
    const gifTask = await call('/api/waterfall/tasks', gifInput)
    assert.equal(gifTask.status, 202)
    const gifSlot = await until(async () => {
      const task = (await call(`/api/waterfall/tasks/${gifTask.data.task.id}`)).data.task
      assert.notEqual(task.status, 'failed', JSON.stringify(task.slots))
      return task.status === 'succeeded' && task.slots[0]
    })
    assert.equal(calls.at(-1).replyType, 'async')
    assert.equal(calls.at(-1).model, 'gpt-image-2.6')
    assert.equal(calls.at(-1).aspectRatio, '720x1280')
    assert.equal(calls.at(-1).quality, 'medium')
    for (const url of [directGif.data.urls[0], gifSlot.url]) {
      assert.match(url, /\.gif$/)
      assert.deepEqual(fs.readFileSync(path.join(dir, 'waterfall-assets', path.basename(url))), gif)
    }
    const beforeInvalid = calls.length
    for (const path of ['/api/image', '/api/waterfall/tasks']) {
      for (const size of ['4096x2048', '3840x3840', '1024x256', '1025x1024', '480x480', '999999999999999999x1024']) {
        assert.equal((await call(path, { ...customInput, aspectRatio: size })).status, 400, size)
      }
      for (const model of ['gpt-image-2', 'gpt-image-2.5', 'nano-banana-2.1', 'gpt-image-2.5-flare-t']) {
        assert.equal((await call(path, { ...customInput, model })).status, 400, model)
      }
    }
    assert.equal(calls.length, beforeInvalid, 'invalid custom sizes must never reach the paid upstream')
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)) }; await new Promise((r) => upstream.close(r)); fs.rmSync(dir, { recursive: true, force: true }) }
})
