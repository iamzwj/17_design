import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { installTextTasks } from '../server/textTasks.js'

test('text tasks persist, deduplicate submissions, enforce ownership and recover after restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'text-task-test-'))
  let calls = 0
  let finish
  async function boot(handler) {
    const app = express(); app.use(express.json())
    installTextTasks(app, { dataDir, requireAuth(req, res, next) { req.user = { id: req.headers['x-user'] || 'alice' }; next() }, handleCompletion: handler })
    const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve))
    return { server, base: `http://127.0.0.1:${server.address().port}` }
  }
  let instance = await boot(async (req, res) => { calls++; await new Promise((resolve) => { finish = resolve }); res.json({ content: req.body.messages[0].content }) })
  const id = randomUUID()
  const post = (base, kind, id) => fetch(`${base}/api/${kind}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Text-Session': 'guest-test' }, body: JSON.stringify({ requestId: id, messages: [{ role: 'user', content: 'test answer' }] }) })
  try {
    assert.equal((await post(instance.base, 'text', id)).status, 202)
    assert.equal((await post(instance.base, 'text', id)).status, 200)
    assert.equal(calls, 1)
    assert.equal((await fetch(`${instance.base}/api/text/tasks/${id}`, { headers: { 'X-User': 'bob' } })).status, 404)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'text-tasks.json')))[0].status, 'running')
    finish(); await new Promise((r) => setTimeout(r, 30))
    const done = await (await fetch(`${instance.base}/api/text/tasks/${id}`)).json()
    assert.equal(done.task.status, 'succeeded'); assert.equal(done.task.result.content, 'test answer')
    assert.equal('input' in done.task, false); assert.equal('owner' in done.task, false)
    await new Promise((r) => instance.server.close(r))
    const pending = { id: randomUUID(), owner: 'alice', kind: 'text', status: 'running', createdAt: Date.now(), input: { messages: [{ content: 'resumed' }] } }
    fs.writeFileSync(path.join(dataDir, 'text-tasks.json'), JSON.stringify([pending]))
    instance = await boot(async (req, res) => { calls++; res.json({ content: req.body.messages[0].content }) })
    await new Promise((r) => setTimeout(r, 30))
    const resumed = await (await fetch(`${instance.base}/api/text/tasks/${pending.id}`)).json()
    assert.equal(resumed.task.result.content, 'resumed'); assert.equal(calls, 2)
    await new Promise((r) => instance.server.close(r))
    instance = await boot(async (req, res, next) => { next(new Error('provider unavailable')) })
    const failId = randomUUID(); await post(instance.base, 'compliance', failId)
    await new Promise((r) => setTimeout(r, 30))
    assert.equal((await fetch(`${instance.base}/api/compliance/tasks/${failId}`, { headers: { 'X-Text-Session': 'wrong-guest' } })).status, 404)
    const failed = await (await fetch(`${instance.base}/api/compliance/tasks/${failId}`, { headers: { 'X-Text-Session': 'guest-test' } })).json()
    assert.equal(failed.task.status, 'failed'); assert.equal(failed.task.error, 'provider unavailable')
  } finally { instance.server.closeAllConnections(); await new Promise((r) => instance.server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }) }
})


test('brand compliance tasks are owned by the authenticated user, not a shared browser session', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-review-owner-'))
  const app = express(); app.use(express.json())
  installTextTasks(app, { dataDir, requireAuth(req, res, next) { req.user = { id: req.headers['x-user'] || 'alice' }; next() }, prepareInput: async (req) => req.body, handleCompletion: async (req, res) => res.json({ content: req.body.complianceBrand }) })
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}/api/compliance/tasks`, id = randomUUID()
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test', 'X-Text-Session': 'same-browser', 'X-User': 'alice' }
  try {
    assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify({ requestId: id, complianceBrand: 'vanke-property', messages: [{ role: 'user', content: '审核' }] }) })).status, 202)
    await new Promise((r) => setTimeout(r, 30))
    assert.equal((await fetch(`${base}/${id}`, { headers: { ...headers, 'X-User': 'bob' } })).status, 404)
    const own = await (await fetch(`${base}/${id}`, { headers })).json()
    assert.equal(own.task.result.content, 'vanke-property')
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }) }
})

 test('guest brand review remains anonymous and readable after a service restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-brand-review-'))
  let server
  async function boot() {
    const app = express(); app.use(express.json())
    installTextTasks(app, { dataDir, requireAuth(req, res) { res.status(401).json({ error: 'login required' }) }, handleCompletion: async (req, res) => res.json({ content: req.body.complianceBrand }) })
    server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r))
    return `http://127.0.0.1:${server.address().port}/api/compliance/tasks`
  }
  let base = await boot()
  const id = randomUUID(), headers = { 'Content-Type': 'application/json', 'X-Text-Session': 'guest-brand' }
  try {
    assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify({ requestId: id, complianceBrand: 'pulin', messages: [{ role: 'user', content: '审核' }] }) })).status, 202)
    await new Promise((r) => setTimeout(r, 30))
    server.closeAllConnections(); await new Promise((r) => server.close(r))
    base = await boot()
    const result = await (await fetch(`${base}/${id}`, { headers })).json()
    assert.equal(result.task.result.content, 'pulin')
    assert.equal((await fetch(`${base}/${id}`, { headers: { 'X-Text-Session': 'other' } })).status, 404)
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }) }
})
