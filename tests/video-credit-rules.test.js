import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'

test('video charges by model and refunds a confirmed failure once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-credit-'))
  const token = randomUUID()
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ users: [{ id: 'qa', email: 'qa@example.test', credits: 50 }], codes: [], sessions: [{ tokenHash: createHash('sha256').update(token).digest('hex'), userId: 'qa', expiresAt: Date.now() + 3600000 }] }))
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url.startsWith('/v1/api/result')) return res.end(JSON.stringify({ status: 'failed', error: 'test failure' }))
    if (req.url === '/tasks') return res.end(JSON.stringify({ code: 200, data: { task_id: randomUUID() } }))
    res.end(JSON.stringify({ id: randomUUID(), status: 'processing' }))
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const portProbe = http.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve)); const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve))
  const remote = `http://127.0.0.1:${upstream.address().port}`
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DIEFA_DATA_DIR: dir, GRSAI_BASE_URL: remote, GRSAI_API_KEY: 'test', VIBBIT_OPENAPI_BASE_URL: remote, VIBBIT_OPENAPI_KEY: 'test' }, stdio: 'ignore' })
  const call = async (url, body) => { const response = await fetch(`http://127.0.0.1:${port}${url}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() } }
  try {
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) { try { ready = (await call('/api/health')).status === 200 } catch { await new Promise(resolve => setTimeout(resolve, 50)) } }
    assert.ok(ready)
    let result = await call('/api/video/tasks', { model: 'minimax-h3', prompt: 'test', resolution: '768p', durationSeconds: 5, aspectRatio: 'landscape', referenceMode: 'text' })
    assert.equal(result.status, 202); assert.equal(result.data.user.credits, 45)
    const id = result.data.taskId
    await Promise.all([call(`/api/video/tasks/${id}`), call(`/api/video/tasks/${id}`)])
    assert.equal((await call('/api/auth/me')).data.user.credits, 50)
    result = await call('/api/video/tasks', { model: 'doubao-seedance-2-0-fast-260128', prompt: 'test', resolution: '720p', durationSeconds: 6, aspectRatio: '16:9', referenceMode: 'text' })
    assert.equal(result.status, 202); assert.equal(result.data.user.credits, 38)
    result = await call('/api/video/tasks', { model: 'doubao-seedance-2-5-260628', prompt: 'test', resolution: '720p', durationSeconds: 30, aspectRatio: '16:9', referenceMode: 'text' })
    assert.equal(result.status, 402); assert.equal((await call('/api/auth/me')).data.user.credits, 38)
  } finally { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); await new Promise(resolve => upstream.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }) }
})
