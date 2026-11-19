import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { installFilms } from '../server/films.js'
import { imageCreditCost } from '../src/imageModels.js'

test('film quota, model restriction and duration are enforced per account', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-quota-'))
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] || 'user', email: req.headers['x-user'] === 'admin' ? 'zhangwj159@onewo.com' : 'person@onewo.com' }; next() })
  installFilms(app, { dataDir: dir, requireAuth: (_req, _res, next) => next(), worker: false })
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (payload, user = 'user') => {
    const response = await fetch(`${base}/api/films`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': user }, body: JSON.stringify(payload) })
    return { status: response.status, body: await response.json() }
  }
  const payload = () => ({ requestId: randomUUID(), story: '一个简短的故事', imageModel: 'gpt-image-2.5', videoModel: 'minimax-h3', ratio: '16:9', duration: 30 })
  try {
    assert.equal((await request({ ...payload(), duration: 121 })).status, 400)
    assert.equal((await request({ ...payload(), videoModel: 'wan-3.0' })).status, 403)
    assert.equal((await request({ ...payload(), videoModel: 'wan-3.0' }, 'admin')).status, 202)
    for (let i = 0; i < 5; i++) {
      const result = await request(payload()); assert.equal(result.status, 202)
      const projectFile = path.join(dir, 'films', result.body.project.id, 'project.json')
      const project = JSON.parse(fs.readFileSync(projectFile)); project.status = 'succeeded'; fs.writeFileSync(projectFile, JSON.stringify(project))
    }
    assert.equal((await request(payload())).status, 429)
    assert.equal((await request(payload(), 'other')).status, 202)
    assert.equal(imageCreditCost('gpt-image-2-vip', 2), 2)
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }) }
})
