import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { installKnowledge } from '../server/knowledge/index.js'
import { splitSections } from '../server/knowledge/parse.js'

const users = [{ id: 'admin', email: 'zhangwj159@onewo.com' }, { id: 'editor', email: 'editor@onewo.com' }, { id: 'viewer', email: 'viewer@onewo.com' }, { id: 'outsider', email: 'out@onewo.com' }]
const embed = async (texts) => texts.map((t) => /颜色|标志|品牌|Logo/.test(t) ? [1, 0] : [0, 1])
const pause = () => new Promise((r) => setTimeout(r, 10))
test('brand knowledge permissions, version publishing, index changes, images and immutable traces', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgen-kb-test-'))
  const app = express(); app.use(express.json({ limit: '20mb' }))
  const requireAuth = (req, res, next) => { req.user = users.find((u) => u.id === req.headers['x-user']); if (!req.user) return res.status(401).json({ error: 'login' }); next() }
  const requireAdmin = (req, res, next) => requireAuth(req, res, () => req.user.id === 'admin' ? next() : res.status(403).json({ error: 'admin' }))
  let kb = installKnowledge(app, { automaticVision: false, reviewLogo: async () => ({ boxes: [], model: 'test' }), dataDir, requireAuth, requireAdmin, listUsers: () => users, embed })
  app.use((e, req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); const base = `http://127.0.0.1:${server.address().port}/api/knowledge`
  async function call(url, data, user = 'admin', method = data ? 'POST' : 'GET') { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-User': user }, ...(data ? { body: JSON.stringify(data) } : {}) }); return { status: r.status, data: await r.json() } }
  async function ready(docId) { for (let i = 0; i < 100; i++) { const d = (await call(`/documents/${docId}`)).data; if (d.versions.at(-1).status === 'ready') return d; await pause() }; throw new Error('job did not finish') }
  try {
    assert.equal((await call('/bootstrap', undefined, '')).status, 401)
    const boot = (await call('/bootstrap')).data, brandId = boot.brands[0].id
    assert.equal(boot.groups.length, 3)
    assert.equal((await call('/bootstrap', undefined, 'outsider')).data.brands.length, 0)
    await call('/groups', { id: 'group-1', name: '维护组', members: ['editor'] }); await call('/groups', { id: 'group-2', name: '查看组', members: ['viewer'] })
    await call('/brands', { id: brandId, name: '测试品牌', grants: { 'group-1': 'edit', 'group-2': 'view' } })
    const created = await call('/documents', { brandId, title: '标志规范', kind: 'rule', content: 'Logo必须使用紫色，不得更改品牌颜色' }, 'editor')
    assert.equal(created.status, 202); const docId = created.data.document.id
    const d = await ready(docId), v1 = d.document.latestVersionId
    assert.equal((await call(`/documents/${docId}`, undefined, 'viewer')).status, 404)
    assert.equal((await call(`/documents/${docId}/publish`, { versionId: v1 }, 'editor')).status, 403)
    assert.equal((await call('/search', { brandId, query: '颜色' }, 'outsider')).status, 403)
    assert.equal((await call('/search', { brandId, query: '颜色' }, 'viewer')).data.results.length, 0)
    await call(`/documents/${docId}/publish`, { versionId: v1 })
    const found = (await call('/search', { brandId, query: '品牌颜色', mode: 'hybrid' }, 'viewer')).data.results
    assert.equal(found.length, 1); assert.equal(found[0].versionId, v1); assert.equal('vector' in found[0], false)
    const trace = await kb.prepare(users[2], { knowledge: { brandId }, messages: [{ role: 'user', content: '帮我写文案' }] }, 'text')
    assert.ok(trace.prompt.includes('不得更改品牌颜色'))
    assert.equal((await call(`/traces/${trace.id}`, undefined, 'editor')).status, 404)
    await call(`/documents/${docId}/versions`, { baseVersionId: v1, title: '标志规范', kind: 'rule', content: 'Logo改用白色' }, 'editor'); const v2 = (await ready(docId)).document.latestVersionId
    assert.equal((await call('/search', { brandId, query: '颜色' }, 'viewer')).data.results[0].versionId, v1)
    assert.equal((await call(`/documents/${docId}/versions`, { baseVersionId: v1, title: '并发更新', content: '冲突' }, 'editor')).status, 409)
    await call(`/documents/${docId}/publish`, { versionId: v2 })
    assert.equal((await call('/search', { brandId, query: '品牌颜色' }, 'viewer')).data.results[0].versionId, v2)
    assert.ok((await call(`/traces/${trace.id}`, undefined, 'viewer')).data.trace.prompt.includes('不得更改品牌颜色'))
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII='
    const asset = await call('/documents', { brandId, title: 'Logo', kind: 'logo', content: '品牌标志', file: { name: 'logo.png', base64: png } })
    const assetDoc = asset.data.document.id, assetV = (await ready(assetDoc)).document.latestVersionId
    await call(`/documents/${assetDoc}/publish`, { versionId: assetV })
    const imageTrace = await kb.prepare(users[2], { prompt: '品牌海报', knowledge: { brandId, assetIds: [assetDoc] } }, 'image')
    assert.ok(imageTrace.images[0].startsWith('data:image/png;base64,'))
    const stored = (await call(`/traces/${imageTrace.id}`, undefined, 'viewer')).data.trace
    assert.equal(stored.assets[0].versionId, assetV); assert.ok(stored.assets[0].sha256)
    await call(`/documents/${docId}`, {}, 'admin', 'DELETE')
    assert.ok(!(await call('/search', { brandId, query: '品牌' }, 'viewer')).data.results.some((r) => r.documentId === docId))
    assert.equal((await call(`/documents/${docId}`, undefined, 'viewer')).status, 404)
    assert.ok((await call(`/traces/${trace.id}`, undefined, 'viewer')).data.trace.rules.length)
    await call('/groups', { id: 'group-2', name: '查看组', members: [] })
    assert.equal((await call(`/traces/${trace.id}`, undefined, 'viewer')).status, 403)
    assert.equal((await fetch(`${base}/documents/${assetDoc}/files/${assetV}`, { headers: { 'X-User': 'outsider' } })).status, 403)
    const bad = await call('/documents', { brandId, title: '扫描 PDF', kind: 'document', file: { name: 'bad.pdf', base64: Buffer.from('invalid pdf').toString('base64') } })
    let failed; for (let i = 0; i < 200; i++) { failed = (await call(`/documents/${bad.data.document.id}`)).data; if (failed.versions[0].status === 'failed') break; await pause() }
    assert.equal(failed.versions[0].status, 'failed')
    assert.equal((await call(`/documents/${bad.data.document.id}/retry`, {})).status, 202)
    await new Promise((r) => setTimeout(r, 100));
    await kb.close()
    const app2 = express(); app2.use(express.json())
    kb = installKnowledge(app2, { dataDir, requireAuth, requireAdmin, listUsers: () => users, embed })
    assert.ok(kb.db.prepare('SELECT COUNT(*) as n FROM traces').get().n >= 2)
    assert.ok(kb.db.prepare('SELECT COUNT(*) as n FROM versions').get().n >= 4)
  } finally { await kb.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }) }
})
test('parser retains source locations and overlap without truncating the document', () => {
  const chunks = splitSections([{ source: '第 3 页', text: '品牌服务。'.repeat(120) }])
  assert.ok(chunks.length > 1); assert.ok(chunks.every((c) => c.source === '第 3 页')); assert.ok(chunks.at(-1).text.endsWith('品牌服务。'))
})

test('queued and interrupted ingestion resumes from persisted document versions after restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-restart-'))
  const auth = (req, res, next) => { req.user = users[0]; next() }
  const options = { dataDir, requireAuth: auth, requireAdmin: auth, listUsers: () => users, embed }
  let kb = installKnowledge(express(), options)
  try {
    const brandId = JSON.parse(kb.db.prepare('SELECT json FROM brands LIMIT 1').get().json).id
    const documentId = 'restart-doc', versionId = 'restart-version'
    kb.db.prepare('INSERT INTO documents(id,brand_id,json) VALUES(?,?,?)').run(documentId, brandId, JSON.stringify({ id: documentId, brandId, latestVersionId: versionId, publishedVersionId: null }))
    kb.db.prepare('INSERT INTO versions(id,document_id,json) VALUES(?,?,?)').run(versionId, documentId, JSON.stringify({ id: versionId, documentId, brandId, content: '品牌恢复任务的测试内容', title: '恢复测试', status: 'processing', number: 1 }))
    kb.db.prepare('INSERT INTO jobs(id,json) VALUES(?,?)').run('restart-job', JSON.stringify({ id: 'restart-job', brandId, versionId, status: 'running' }))
    await kb.close()
    kb = installKnowledge(express(), options)
    for (let i = 0; i < 100; i++) { if (JSON.parse(kb.db.prepare('SELECT json FROM jobs WHERE id=?').get('restart-job').json).status === 'succeeded') break; await pause() }
    const version = JSON.parse(kb.db.prepare('SELECT json FROM versions WHERE id=?').get(versionId).json)
    assert.equal(version.status, 'ready'); assert.equal(version.chunkCount, 1)
    assert.equal(kb.db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE version_id=?').get(versionId).n, 1)
  } finally { await kb.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
})
