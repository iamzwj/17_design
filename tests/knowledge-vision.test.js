import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import sharp from 'sharp'
import JSZip from 'jszip'
import { installKnowledge } from '../server/knowledge/index.js'
import { analyzePage, extractPages, cropRectangle, validateAnalysis, VISION_MODEL } from '../server/knowledge/vision.js'
import { composeBrandLogo } from '../server/knowledge/compose.js'
const pause = () => new Promise((r) => setTimeout(r, 15))
function fixturePDF() {
  const stream = 'q 0.42 0.26 0.66 rg 50 100 100 80 re f Q BT /F1 18 Tf 50 220 Td (APPROVED LOGO) Tj ET'
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let s = '%PDF-1.4\n'; const offsets = [0]
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(s)); s += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(s)
  s += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(s)
}
test('PDF vector pages, DOCX embedded images and validated multimodal model handoff', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-vision-parse-'))
  try {
    fs.writeFileSync(path.join(dir, 'test.pdf'), fixturePDF())
    const pages = await extractPages({ ext: '.pdf', file: 'test.pdf' }, dir, { start: 1, end: 2 }, async (buffer, info) => ({ ...info, buffer }))
    assert.equal(pages.length, 1); assert.equal(pages[0].source, '第 1 页'); assert.match(pages[0].context, /APPROVED/)
    assert.equal((await sharp(pages[0].buffer).metadata()).width, 750)
    const png = await sharp({ create: { width: 90, height: 60, channels: 3, background: '#6C43A8' } }).png().toBuffer()
    const zip = new JSZip(); zip.file('word/media/image1.png', png); zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>正式标志</w:t></w:r></w:p></w:body></w:document>')
    fs.writeFileSync(path.join(dir, 'test.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
    const embedded = await extractPages({ ext: '.docx', file: 'test.docx' }, dir, { start: 1, end: 1 }, async (buffer, info) => ({ ...info, buffer }))
    assert.equal(embedded.length, 1); assert.match(embedded[0].source, /内嵌图片 1/); assert.match(embedded[0].context, /正式标志/)
    let captured
    const result = await analyzePage(png, '正式Logo禁止改色', { request: async (body) => { captured = body; return { model: VISION_MODEL, choices: [{ message: { content: JSON.stringify({ text: '规范', business: '墙面修缮', rules: ['禁止改色'], assets: [{ kind: 'prohibited', title: '禁用', description: '旧版', box: [1, 2, 900, 950] }] }) } }] } } })
    assert.equal(captured.model, 'gemini-3.1-pro'); assert.ok(captured.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,')); assert.equal(result.assets[0].kind, 'prohibited')
    assert.throws(() => validateAnalysis({ text: '', rules: [], assets: [{ kind: 'logo', box: [900, 0, 100, 1000] }] }), /无效/)
    assert.throws(() => cropRectangle([-1, 0, 1000, 1000], 100, 100), /无效/)
    assert.deepEqual(cropRectangle([100, 200, 900, 800], 100, 100), { left: 10, top: 20, width: 80, height: 60 })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('persisted vision tasks, permission isolation, safe import, original-logo composition and publishing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-vision-api-')), users = [{ id: 'admin', email: 'zhangwj159@onewo.com' }, { id: 'viewer', email: 'viewer@test.local' }]
  const app = express(); app.use(express.json({ limit: '20mb' }))
  const auth = (req, res, next) => { req.user = users.find((u) => u.id === req.headers['x-user']); if (!req.user) return res.status(401).json({ error: 'login' }); next() }
  let calls = 0
  const result = { text: '主营墙面修缮，正式紫色Logo，禁止拉伸和改色', business: '墙面修缮', rules: ['禁止拉伸、改色'], assets: [{ title: '正式Logo', kind: 'logo', description: '正式标志原图', box: [100, 100, 900, 900] }, { title: '禁用示例', kind: 'prohibited', box: [0, 0, 1000, 1000] }] }
  const opts = { reviewLogo: async () => ({ boxes: [], model: 'test' }), dataDir: dir, requireAuth: auth, requireAdmin: auth, listUsers: () => users, embed: async (texts) => texts.map(() => [1, 0]), analyze: async () => { calls++; if (calls === 1) throw new Error('mock transient'); return result } }
  let kb = installKnowledge(app, opts)
  app.use((e, req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); const base = `http://127.0.0.1:${server.address().port}/api/knowledge`
  const call = async (url, body, user = 'admin') => { const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'X-User': user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() } }
  const until = async (fn) => { for (let n = 0; n < 200; n++) { const r = await fn(); if (r) return r; await pause() }; throw new Error('timeout') }
  try {
    const brand = (await call('/bootstrap')).data.brands[0]
    const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#6C43A8' } }).png().toBuffer()
    const d = (await call('/documents', { brandId: brand.id, title: '虚构规范', file: { name: 'standard.png', base64: png.toString('base64') } })).data
    const documentId = d.document.id, versionId = d.document.latestVersionId
    await until(async () => (await call(`/documents/${documentId}`)).data.versions[0].status === 'ready')
    assert.equal((await call(`/documents/${documentId}/analyze`, { versionId, start: 1, end: 21 })).status, 400)
    const analysis = (await call(`/documents/${documentId}/analyze`, { versionId, start: 1, end: 1 })).data.analysis
    await until(async () => (await call(`/analyses/${analysis.id}`)).data.analysis.status === 'failed')
    assert.equal((await call(`/analyses/${analysis.id}`, undefined, 'viewer')).status, 403)
    assert.equal((await call(`/analyses/${analysis.id}/import`, { page: 1, kind: 'rule', content: '错误提前导入' })).status, 400)
    await call(`/analyses/${analysis.id}/retry`, {})
    const completed = await until(async () => { const a = (await call(`/analyses/${analysis.id}`)).data.analysis; return a.status === 'succeeded' ? a : null })
    assert.equal(completed.pages.length, 1); assert.equal(calls, 2); assert.equal(completed.pages[0].context, undefined)
    assert.equal((await fetch(`${base}/analyses/${analysis.id}/pages/1`, { headers: { 'X-User': 'viewer' } })).status, 403)
    assert.equal((await call(`/analyses/${analysis.id}/import`, { page: 1, kind: 'logo', assetIndex: 1, content: '禁用' })).status, 400)
    const rule = (await call(`/analyses/${analysis.id}/import`, { page: 1, kind: 'rule', content: '主营墙面修缮，禁止拉伸和改色' })).data
    assert.equal(rule.versions[0].provenance.versionId, versionId)
    assert.equal((await kb.search(users[0], brand.id, '墙面')).results.length, 0)
    await until(async () => (await call(`/documents/${rule.document.id}`)).data.versions[0].status === 'ready')
    await call(`/documents/${rule.document.id}/publish`, { versionId: rule.document.latestVersionId })
    const payload = { page: 1, kind: 'logo', assetIndex: 0, content: '已核对正式紫色标志', box: [100, 100, 900, 900] }
    const logo = (await call(`/analyses/${analysis.id}/import`, payload)).data
    assert.equal((await call(`/analyses/${analysis.id}/import`, payload)).data.document.id, logo.document.id)
    await until(async () => (await call(`/documents/${logo.document.id}`)).data.versions[0].status === 'ready')
    await call(`/documents/${logo.document.id}/publish`, { versionId: logo.document.latestVersionId })
    const prepared = await kb.prepare(users[0], { knowledge: { brandId: brand.id }, prompt: '制作品牌海报' }, 'image')
    assert.equal(prepared.images.length, 1); assert.match(prepared.prompt, /禁止模型绘制任何品牌Logo/); assert.match(prepared.prompt, /主营墙面修缮/)
    const baseImage = await sharp({ create: { width: 1000, height: 1500, channels: 3, background: '#ddd' } }).png().toBuffer()
    const composed = await kb.compose(prepared.id, baseImage, 'test-output')
    const pixel = await sharp(composed).extract({ left: 60, top: 80, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
    assert.deepEqual([...pixel], [108, 67, 168])
    const trace = (await call(`/traces/${prepared.id}`)).data.trace
    assert.ok(trace.compositions['test-output'].sha256); assert.equal(trace.assets[0].provenance.versionId, versionId)
    // Simulate interruption after a completed page: no second model charge on recovery.
    const stored = JSON.parse(kb.db.prepare('SELECT json FROM analyses WHERE id=?').get(analysis.id).json)
    stored.status = 'running'; kb.db.prepare('UPDATE analyses SET json=? WHERE id=?').run(JSON.stringify(stored), analysis.id)
    const job = { id: 'restart-vision', kind: 'vision', analysisId: analysis.id, versionId, brandId: brand.id, status: 'running' }
    kb.db.prepare('INSERT INTO jobs VALUES(?,?)').run(job.id, JSON.stringify(job))
    await kb.close(); kb = installKnowledge(express(), opts)
    await until(async () => JSON.parse(kb.db.prepare('SELECT json FROM jobs WHERE id=?').get(job.id).json).status === 'succeeded')
    assert.equal(calls, 2)
  } finally { await kb.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }) }
})
test('logo compositing retains confirmed pixels and places a white mark on charcoal', async () => {
  const base = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#999' } }).png().toBuffer()
  const logo = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const result = await composeBrandLogo(base, logo)
  assert.equal(result.placement.backdrop, '#24222a'); assert.equal(result.placement.width, 40)
})
