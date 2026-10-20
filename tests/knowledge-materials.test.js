import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import express from 'express'
import sharp from 'sharp'
import { installKnowledge } from '../server/knowledge/index.js'
const pause = () => new Promise((r) => setTimeout(r, 10))
test('library Logos and IP link without uploads, preserve snapshots, publish under grants, and feed real images', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-materials-')), materialDir = path.join(dir, 'library'); fs.mkdirSync(materialDir)
  const users = [{ id: 'admin', email: 'zhangwj159@onewo.com' }, { id: 'editor', email: 'editor@test.local' }, { id: 'viewer', email: 'viewer@test.local' }, { id: 'publisher', email: 'publisher@test.local' }]
  const color = await sharp({ create: { width: 120, height: 40, channels: 4, background: '#10ac91' } }).png().toBuffer()
  const white = await sharp({ create: { width: 120, height: 40, channels: 4, background: '#fff' } }).png().toBuffer()
  for (const file of ['yanxuanjia-color.png', 'yanxuanjia-painter.png', 'xiaojie.png']) fs.writeFileSync(path.join(materialDir, file), color)
  fs.writeFileSync(path.join(materialDir, 'yanxuanjia-white.png'), white)
  let block = false, release, embeddingStarted
  const gate = new Promise((r) => { release = r }), started = new Promise((r) => { embeddingStarted = r })
  const app = express(); app.use(express.json())
  const auth = (req, res, next) => { req.user = users.find((u) => u.id === req.headers['x-user']); if (!req.user) return res.status(401).json({ error: 'login' }); next() }
  const admin = (req, res, next) => auth(req, res, () => req.user.id === 'admin' ? next() : res.status(403).json({ error: 'admin' }))
  const kb = installKnowledge(app, { dataDir: dir, materialDir, requireAuth: auth, requireAdmin: admin, listUsers: () => users, embed: async (texts) => { if (block) { embeddingStarted(); await gate }; return texts.map(() => [1, 0]) } })
  app.use((e, req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); const base = `http://127.0.0.1:${server.address().port}/api/knowledge`
  const call = async (url, body, user = 'admin') => { const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'X-User': user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() } }
  const until = async (fn) => { for (let i = 0; i < 200; i++) { const v = await fn(); if (v) return v; await pause() }; throw new Error('timeout') }
  try {
    const boot = (await call('/bootstrap')).data, brandId = boot.brands.find((b) => b.name === '研选家').id, other = boot.brands.find((b) => b.name === '万物云').id
    for (const [n, role] of [['1', 'editor'], ['2', 'viewer'], ['3', 'publisher']]) await call('/groups', { id: `group-${n}`, name: role, members: [role] })
    await call('/brands', { id: brandId, name: '研选家', grants: { 'group-1': 'edit', 'group-2': 'view', 'group-3': 'publish' } })
    assert.equal((await call(`/materials?brandId=${brandId}`, undefined, 'viewer')).status, 403)
    const catalog = (await call(`/materials?brandId=${brandId}`, undefined, 'editor')).data.assets
    assert.equal(catalog.filter((a) => a.type === 'logo').length, 2)
    assert.ok(catalog.some((a) => a.id === 'yanxuanjia-painter' && a.available)); assert.ok(catalog.some((a) => a.id === 'xiaojie'))
    assert.ok(!catalog.some((a) => a.id === 'person-main'))
    const payload = { brandId, assetIds: ['研选家-color', '研选家-white', 'yanxuanjia-painter'], publish: true }
    assert.equal((await call('/material-links', payload, 'editor')).status, 403)
    assert.equal((await call('/material-links', { brandId: other, assetIds: ['研选家-color'] })).status, 403)
    assert.equal((await call('/material-links', { brandId, assetIds: ['../../.env'] })).status, 403)
    const linked = await call('/material-links', payload, 'publisher'); assert.equal(linked.status, 202)
    const docs = await until(async () => { const ds = (await call(`/documents?brandId=${brandId}`)).data.documents; return ds.length === 3 && ds.every((d) => d.publishedVersionId) ? ds : null })
    const logo = docs.find((d) => d.materialId === '研选家-color'), reversed = docs.find((d) => d.materialId === '研选家-white'), ip = docs.find((d) => d.materialId === 'yanxuanjia-painter')
    const hash = createHash('sha256').update(color).digest('hex')
    assert.equal(logo.publishedVersion.sha256, hash); assert.equal(logo.publishedVersion.provenance.sourceSha256, hash)
    const downloaded = await fetch(`${base}/documents/${logo.id}/files/${logo.publishedVersionId}`, { headers: { 'X-User': 'viewer' } })
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), color)
    const prepared = await kb.prepare(users[2], { prompt: 'IP形象海报', knowledge: { brandId, assetIds: [ip.id] } }, 'image')
    assert.equal(prepared.images.length, 2); assert.match(prepared.prompt, /IP形象原图参考/)
    const trace = (await call(`/traces/${prepared.id}`, undefined, 'viewer')).data.trace
    assert.equal(trace.assets[0].documentId, logo.id); assert.equal(trace.assets[1].documentId, ip.id)
    const manual = await kb.prepare(users[2], { prompt: '反白Logo', knowledge: { brandId, assetIds: [reversed.id] } }, 'image')
    assert.equal((await call(`/traces/${manual.id}`, undefined, 'viewer')).data.trace.assets[0].documentId, reversed.id)
    const count = kb.db.prepare('SELECT COUNT(*) AS n FROM versions').get().n
    await call('/material-links', payload, 'publisher'); assert.equal(kb.db.prepare('SELECT COUNT(*) AS n FROM versions').get().n, count)
    const newLogo = await sharp(color).negate({ alpha: false }).png().toBuffer(); fs.writeFileSync(path.join(materialDir, 'yanxuanjia-color.png'), newLogo)
    const updated = (await call('/material-links', { brandId, assetIds: ['研选家-color'] }, 'editor')).data.results[0]
    const revised = await until(async () => { const d = (await call(`/documents/${updated.documentId}`)).data; return d.versions.at(-1).status === 'ready' ? d : null })
    assert.equal(revised.versions.length, 2); assert.equal(revised.document.publishedVersionId, logo.publishedVersionId)
    assert.equal((await call(`/traces/${prepared.id}`, undefined, 'viewer')).data.trace.assets[0].sha256, hash)
    assert.deepEqual(Buffer.from((await kb.restoreImages(prepared.id))[0].split(',')[1], 'base64'), color)
    await call(`/documents/${logo.id}/versions`, { baseVersionId: revised.document.latestVersionId, title: '人工改写不得随关联发布', kind: 'rule', content: '这不是素材库的标准原图说明' }, 'editor')
    await until(async () => (await call(`/documents/${logo.id}`)).data.versions.at(-1).status === 'ready')
    await call('/material-links', { brandId, assetIds: ['研选家-color'], publish: true }, 'publisher')
    const canonical = await until(async () => { const d = (await call(`/documents/${logo.id}`)).data; return d.document.publishedVersionId === d.document.latestVersionId ? d : null })
    assert.equal(canonical.versions.at(-1).kind, 'logo'); assert.equal(canonical.versions.at(-1).title, '研选家 · 彩色 Logo')
    // A shared IP can be associated with another brand, but revoking publish permission mid-task must prevent publication.
    block = true
    const pending = await call('/material-links', { brandId, assetIds: ['xiaojie'], publish: true }, 'publisher'); assert.equal(pending.status, 202)
    await started; await call('/groups', { id: 'group-3', name: 'publisher', members: [] }); release()
    const unpub = await until(async () => { const d = (await call(`/documents/${pending.data.results[0].documentId}`)).data; return d.versions[0].status === 'ready' ? d : null })
    assert.equal(unpub.document.publishedVersionId, null)
  } finally { release(); await kb.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('brand selection automatically pins library Logo, optional typed IP and fixed published manual colors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-brand-selection-')), materialDir = path.join(dir, 'library'); fs.mkdirSync(materialDir)
  const users = [{ id: 'admin', email: 'zhangwj159@onewo.com' }, { id: 'viewer', email: 'viewer@test.local' }]
  const png = await sharp({ create: { width: 100, height: 50, channels: 4, background: '#10ac91' } }).png().toBuffer()
  for (const file of ['yanxuanjia-color.png', 'yanxuanjia-white.png', 'yanxuanjia-painter.png']) fs.writeFileSync(path.join(materialDir, file), png)
  const app = express(); app.use(express.json({ limit: '20mb' }))
  const auth = (req, res, next) => { req.user = users.find((u) => u.id === req.headers['x-user']); if (!req.user) return res.status(401).json({ error: 'login' }); next() }
  const kb = installKnowledge(app, { dataDir: dir, materialDir, requireAuth: auth, requireAdmin: auth, listUsers: () => users, embed: async (texts) => texts.map(() => [1, 0]) })
  app.use((e, req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); const base = `http://127.0.0.1:${server.address().port}/api/knowledge`
  const call = async (url, body, user = 'admin') => { const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'X-User': user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() } }
  const until = async (fn) => { for (let i = 0; i < 200; i++) { const r = await fn(); if (r) return r; await pause() }; throw new Error('timeout') }
  try {
    const brandId = (await call('/bootstrap')).data.brands.find((b) => b.name === '研选家').id
    await call('/groups', { id: 'group-1', name: 'viewer', members: ['viewer'] }); await call('/brands', { id: brandId, name: '研选家', grants: { 'group-1': 'view' } })
    const initial = (await call(`/generation-assets?brandId=${brandId}`, undefined, 'viewer')).data
    assert.equal(initial.colorReady, false); assert.equal(initial.assets.filter((a) => a.kind === 'logo').length, 2); assert.equal(initial.assets.filter((a) => a.ipType === 'cartoon').length, 1); assert.equal(initial.assets.filter((a) => a.ipType === 'real').length, 0)
    await assert.rejects(kb.prepare(users[1], { prompt: '制作海报', knowledge: { brandId, enforceBrandColors: true } }, 'image'), /颜色规范尚未发布/)
    const manual = (await call('/documents', { brandId, title: '测试品牌手册', kind: 'document', content: '品牌标准色：主色#10AC91，辅助色#FFFFFF；红色示例禁用。' })).data
    const doc = await until(async () => { const d = (await call(`/documents/${manual.document.id}`)).data; return d.versions[0].status === 'ready' ? d : null })
    assert.equal((await call(`/generation-assets?brandId=${brandId}`, undefined, 'viewer')).data.colorReady, false)
    await call(`/documents/${doc.document.id}/publish`, { versionId: doc.document.latestVersionId })
    assert.equal((await call(`/generation-assets?brandId=${brandId}`, undefined, 'viewer')).data.colorReady, true)
    const prepare = (extra = {}) => kb.prepare(users[1], { prompt: '场景摄影，查询中没有任何颜色关键词', knowledge: { brandId, enforceBrandColors: true, ...extra } }, 'image')
    const noIP = await prepare({ ipMode: 'none' }); assert.equal(noIP.images.length, 1)
    const cartoon = await prepare({ ipMode: 'cartoon' }); assert.equal(cartoon.images.length, 2)
    const trace = (await call(`/traces/${cartoon.id}`, undefined, 'viewer')).data.trace
    assert.equal(trace.assets[0].provenance.materialId, '研选家-color'); assert.equal(trace.assets[1].ipType, 'cartoon')
    assert.ok(trace.rules.some((r) => r.fixedColor && r.versionId === doc.document.latestVersionId)); assert.match(cartoon.prompt, /#10AC91/)
    assert.equal(kb.db.prepare('SELECT COUNT(*) AS n FROM documents').get().n, 1, 'selecting a brand must not impersonate a publisher or create knowledge documents')
    const oldHash = trace.assets[0].sha256, changed = await sharp(png).negate({ alpha: false }).png().toBuffer(); fs.writeFileSync(path.join(materialDir, 'yanxuanjia-color.png'), changed)
    const fresh = await prepare({ ipMode: 'none' }), freshTrace = (await call(`/traces/${fresh.id}`, undefined, 'viewer')).data.trace
    assert.notEqual(freshTrace.assets[0].sha256, oldHash)
    assert.deepEqual(Buffer.from((await kb.restoreImages(cartoon.id))[0].split(',')[1], 'base64'), png)
    const oldFile = await fetch(`${base}/traces/${cartoon.id}/files/${trace.assets[0].versionId}`, { headers: { 'X-User': 'viewer' } }); assert.equal(oldFile.status, 200); assert.deepEqual(Buffer.from(await oldFile.arrayBuffer()), png)
    await assert.rejects(prepare({ ipMode: 'real' }), /尚无已发布的真人/)
    const real = (await call('/documents', { brandId, title: '合成测试真人IP', kind: 'original', ipType: 'real', content: '测试分类，非真实人物', file: { name: 'real.png', base64: png.toString('base64') } })).data
    await until(async () => (await call(`/documents/${real.document.id}`)).data.versions[0].status === 'ready'); await call(`/documents/${real.document.id}/publish`, { versionId: real.document.latestVersionId })
    const realOutput = await prepare({ ipMode: 'real' }); assert.equal(realOutput.images.length, 2)
    assert.equal((await call(`/traces/${realOutput.id}`, undefined, 'viewer')).data.trace.assets[1].ipType, 'real')
    const reversed = await prepare({ ipMode: 'none', logoVariant: 'white' }); assert.equal((await call(`/traces/${reversed.id}`, undefined, 'viewer')).data.trace.assets[0].provenance.materialId, '研选家-white')
  } finally { await kb.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }) }
})
