import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import express from 'express'
import { installAuth } from '../server/auth.js'
import { installKnowledge } from '../server/knowledge/index.js'

test('account identity restricts brand knowledge, materials, and marketing evidence', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-account-scope-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const departmentEmail = 'caoyh21@onewo.com'
  const sampleCode = '246810'
  fs.writeFileSync(path.join(dataDir, 'auth.json'), JSON.stringify({
    codes: [{ email: departmentEmail, purpose: 'login', codeHash: createHash('sha256').update(sampleCode).digest('hex'), attempts: 0, expiresAt: Date.now() + 60_000 }],
  }))
  const app = express()
  app.use(express.json())
  const auth = installAuth(app, { dataDir, allowTestAccounts: true })
  const kb = installKnowledge(app, { dataDir, ...auth, backgroundProcessing: false, embed: async texts => texts.map(() => [1]) })
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1')
  t.after(async () => { server.close(); await kb.close() })
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}/api`

  function request(url, token, body) {
    return fetch(base + url, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  }
  async function login(email, code) {
    const response = await request('/auth/login', '', { email, code, identity: 'marketing' })
    assert.equal(response.status, 200)
    return response.json()
  }
  const yanxuanjia = await login('yanxuanjia@onewo.com', '666666')
  const pulin = await login('pulin@onewo.com', '666666')
  assert.equal(yanxuanjia.user.identity, 'yanxuanjia')
  assert.equal(pulin.user.identity, 'pulin')
  assert.equal((await request('/auth/login', '', { email: departmentEmail, code: '000000' })).status, 400)
  const marketing = await login(departmentEmail, sampleCode)
  assert.equal(marketing.user.identity, 'marketing')
  assert.equal((await request('/knowledge/material-library')).status, 401)
  assert.equal(auth.listAccountIdentities().filter(row => !row.test && row.identity !== 'marketing').length, 0)

  const knowledge = '/knowledge'
  const full = await (await request(knowledge + '/bootstrap', marketing.token)).json()
  const departmentLibrary = full.brands.find(brand => brand.name === '营销活动')
  assert.ok(departmentLibrary)
  assert.ok(full.brands.some(brand => brand.name === '万物云'))

  for (const [account, own, other] of [[yanxuanjia, '研选家', '朴邻'], [pulin, '朴邻', '研选家']]) {
    const { brands } = await (await request(knowledge + '/bootstrap', account.token)).json()
    assert.deepEqual(new Set(brands.map(brand => brand.name)), new Set(own === '研选家' ? [own, '营销活动'] : [own]))
    const { user } = await (await request('/auth/me', account.token)).json()
    assert.equal(user.identity, account.user.identity)
    const otherId = full.brands.find(brand => brand.name === other).id
    assert.equal((await request(knowledge + '/documents?brandId=' + otherId, account.token)).status, 403)
    assert.equal((await request(knowledge + '/search', account.token, { brandId: departmentLibrary.id, query: '跨年', mode: 'keyword' })).status, own === '研选家' ? 200 : 403)
    const { assets } = await (await request(knowledge + '/material-library', account.token)).json()
    assert.ok(assets.length > 0 && assets.every(asset => asset.brand === own))
    const image = await request(knowledge + assets[0].file, account.token)
    assert.equal(image.status, 200)
    assert.ok((await image.arrayBuffer()).byteLength > 0)
    assert.equal((await request(knowledge + '/material-library/' + encodeURIComponent(other + '-color'), account.token)).status, 404)
    const departmentImage = await request(knowledge + '/material-library/' + encodeURIComponent(other + '-color'), marketing.token)
    assert.equal(departmentImage.status, 200)
    await departmentImage.arrayBuffer()

    const prepared = await kb.prepare(account.user, { activityContext: { identity: other, enabled: true }, messages: [{ role: 'user', content: '给独卫翻新做跨年引流，提高有效咨询' }] }, 'text')
    const { trace } = await (await request(knowledge + '/traces/' + prepared.id, account.token)).json()
    assert.deepEqual(new Set(trace.contextBrandIds), new Set(own === '研选家' ? [departmentLibrary.id, brands.find(b => b.name === own).id] : [brands.find(b => b.name === own).id]))
    assert.equal(trace.activity.identity, own)
    assert.equal(trace.activity.enabled, own === '研选家')
    assert.equal(prepared.prompt.includes('先定位客户卡在哪一步'), own === '研选家')
    if (own === '研选家') assert.match(prepared.prompt, /适配少.*筛选信息.*报价.*承接|勘查到报价率/)
    await assert.rejects(kb.prepare(account.user, { knowledge: { brandId: otherId } }, 'image'), { status: 403 })
  }

  const disabled = express()
  disabled.use(express.json())
  installAuth(disabled, { dataDir })
  const production = disabled.listen(0, '127.0.0.1')
  t.after(() => production.close())
  await once(production, 'listening')
  const productionBase = `http://127.0.0.1:${production.address().port}/api/auth`
  assert.equal((await fetch(productionBase + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'pulin@onewo.com', code: '' }) })).status, 400)
  assert.equal((await fetch(productionBase + '/me', { headers: { Authorization: `Bearer ${pulin.token}` } })).status, 401)
})
