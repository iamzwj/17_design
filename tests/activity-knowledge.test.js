import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { installKnowledge } from '../server/knowledge/index.js'
import { rankMarketingDocuments } from '../server/knowledge/marketing.js'

test('cross-year retrieval keeps winter campaign separate from Spring Festival and summer', () => {
  const docs = ['2025年11月-2026年1月年终福利节执行方案', '2026年2-3月春节万马奔腾迎新春策划案', '2026年7-8月社区冰爽节策划案'].map(title => ({ title }))
  const ranked = rankMarketingDocuments(docs, '武汉幸福社跨年营销，参考去年同期', new Date('2026-11-12T00:00:00Z'))
  assert.match(ranked[0].title, /年终福利节/)
  assert.equal(ranked.filter(d => d.topic).length, 1)
})

test('activity generation loads marketing evidence AND identity rules, keeps page citations and empty-library truth', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-activity-test-'))
  const app = express(); app.use(express.json())
  const user = { id: 'admin', email: 'zhangwj159@onewo.com' }
  const auth = (req, res, next) => { req.user = user; next() }
  const kb = installKnowledge(app, { dataDir, requireAuth: auth, requireAdmin: auth, listUsers: () => [user], automaticVision: false, embed: async rows => rows.map(() => [1, 0]) })
  app.use((e, req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}/api/knowledge`
  async function call(url, body) { const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data }
  async function publish(brandId, title, content, kind = 'document') {
    const d = await call('/documents', { brandId, title, content, kind })
    for (let i = 0; i < 100; i++) { const ready = await call(`/documents/${d.document.id}`); if (ready.versions[0].status === 'ready') { await call(`/documents/${d.document.id}/publish`, { versionId: ready.versions[0].id }); return d.document.id }; await new Promise(r => setTimeout(r, 10)) }
    throw Error('ingestion timed out')
  }
  try {
    const { brands } = await call('/bootstrap')
    const yanxuan = brands.find(b => b.name === '研选家')
    const marketing = brands.find(b => b.name === '营销活动')
    const winterId = await publish(marketing.id, '2025年11月-2026年1月年终福利节执行方案', '活动目标：围绕冬季居住需求。幸福社动作：暖冬展销会、市集、服务日。研选家营销必选动作与整体营销节奏。')
    await publish(marketing.id, '2026年2-3月春节营销执行案', '春节年货市集、春节不打烊，迎新春。')
    await publish(yanxuan.id, '研选家现行表达规范', '不承诺无法证实的装修效果，表达贴近日常生活。', 'rule')
    const input = { messages: [{ role: 'user', content: '写武汉幸福社跨年营销方案，参考去年同期' }], activityContext: { enabled: true, identity: '研选家', scope: '武汉幸福社', format: 'strategy' } }
    const result = await kb.prepare(user, input, 'text')
    assert.ok(result.sources.some(r => r.documentId === winterId))
    assert.ok(result.sources.some(r => /现行表达规范/.test(r.title)))
    assert.ok(!result.sources.some(r => /春节营销/.test(r.title)))
    assert.match(result.prompt, /不承诺无法证实的装修效果/)
    assert.match(result.prompt, /武汉幸福社/)
    const trace = JSON.parse(kb.db.prepare('SELECT json FROM traces WHERE id=?').get(result.id).json)
    assert.ok(trace.contextBrandIds.includes(marketing.id))
    assert.ok(trace.contextBrandIds.includes(yanxuan.id))
    const noIdentity = await kb.prepare(user, { ...input, activityContext: { enabled: true, identity: '朴邻' } }, 'text')
    assert.match(noIdentity.prompt, /未检索到朴邻的已发布规范/)
    const disabled = await kb.prepare(user, { ...input, activityContext: { enabled: false } }, 'text')
    assert.equal(disabled.sources.length, 0)
    assert.match(disabled.prompt, /用户未启用/)
    await assert.rejects(kb.prepare(null, input, 'text'), /请先登录/)
  } finally { await kb.close(); await new Promise(r => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }) }
})
