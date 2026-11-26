import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { installConversationHistory } from '../server/conversationHistory.js'

test('account history persists summaries and separate bodies, with safe migration and deletion', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-history-'))
  const app = express()
  app.use(express.json())
  const db = installConversationHistory(app, { dataDir, requireAuth(req, res, next) {
    const id = req.get('x-test-user')
    if (!id) return res.sendStatus(401)
    req.user = { id }
    next()
  } })
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject))
    const base = `http://127.0.0.1:${server.address().port}/api/conversation-history`
    const call = (url = '', user = 'alice', method = 'GET', body) => fetch(base + url, {
      method, headers: { 'x-test-user': user, 'content-type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
    })
    const record = { id: 'one', type: 'chat', title: '原始标题', messages: [{ role: 'user', content: '正文' }] }
    assert.equal((await call('', '')).status, 401)
    assert.equal((await call('/one', 'alice', 'PUT', { record })).status, 200)
    const { records } = await (await call()).json()
    assert.equal(records[0].title, record.title)
    assert.equal(records[0].messages, undefined)
    assert.deepEqual((await (await call('', 'bob')).json()).records, [])
    assert.equal((await call('/one', 'bob')).status, 404)
    await call('/one', 'alice', 'PUT', { record: { ...record, messages: [] }, importOnly: true })
    await call('/one', 'alice', 'PUT', { record: { id: 'one', type: 'chat', archived: true }, metadataOnly: true })
    const restored = (await (await call('/one')).json()).record
    assert.deepEqual(restored.messages, record.messages)
    assert.equal(restored.archived, true)
    await call('/one', 'alice', 'DELETE')
    assert.equal((await call('/one')).status, 404)
    assert.equal((await call('/one', 'alice', 'PUT', { record, importOnly: true })).status, 410)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    db.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
