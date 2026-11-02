import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { installKnowledge } from '../server/knowledge/index.js'
function pdf(count) {
  const stream = 'q .5 .2 .7 rg 10 10 30 30 re f Q'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${count} >>`]
  for (let i = 0; i < count; i++) objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 60 60] /Contents ${count + 3} 0 R >>`)
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  let s = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(s)); s += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(s)
  return Buffer.from(s + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
}
test('upload automatically scans all 21 pages, checkpoints failures, merges OCR, resumes restart and awaits review before publishing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-auto-'))
  const user = { id: 'admin', email: 'zhangwj159@onewo.com' }
  const app = express(); app.use(express.json({ limit: '20mb' }))
  const auth = (req, res, next) => { req.user = user; next() }
  let count = 0, failOnce = true
  const opts = { dataDir: dir, requireAuth: auth, requireAdmin: auth, listUsers: () => [user], embed: async (texts) => texts.map(() => [1, 0]), analyze: async () => { count++; if (count === 2 && failOnce) { failOnce = false; throw new Error('模拟临时失败') } return { text: '扫描页中的品牌禁止拉伸', business: '', rules: ['禁止改色'], assets: [] } } }
  let kb = installKnowledge(app, opts)
  app.use((e, req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}/api/knowledge`
  const call = async (url, body) => { const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() } }
  const until = async (fn) => { for (let i = 0; i < 300; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)) }; throw new Error('timeout') }
  try {
    const brandId = (await call('/bootstrap')).data.brands[0].id
    const created = await call('/documents', { brandId, title: '扫描手册', kind: 'document', file: { name: 'scan.pdf', base64: pdf(21).toString('base64') } })
    assert.equal(created.status, 202)
    const id = created.data.document.id, versionId = created.data.document.latestVersionId
    const analysisId = created.data.analyses[0].id
    assert.equal(created.data.analyses[0].automatic, true)
    const failed = await until(async () => { const a = (await call(`/analyses/${analysisId}`)).data.analysis; return a.status === 'failed' && a })
    assert.equal(failed.pages.length, 21)
    const completedBeforeRetry = failed.pages.filter((p) => p.result).length, callsBeforeRetry = count
    assert.ok(completedBeforeRetry >= 1 && completedBeforeRetry < 21)
    assert.equal((await call(`/documents/${id}/publish`, { versionId })).status, 400)
    assert.equal((await call(`/documents/${id}/analyze`, { versionId, automatic: true })).status, 409)
    // Simulate a process interruption after a retry was persisted but before processing resumed.
    await kb.close()
    const Database = (await import('better-sqlite3')).default
    const db = new Database(path.join(dir, 'knowledge', 'knowledge.sqlite'))
    const a = JSON.parse(db.prepare('SELECT json FROM analyses WHERE id=?').get(analysisId).json); a.status = 'running'; a.error = null
    db.prepare('UPDATE analyses SET json=? WHERE id=?').run(JSON.stringify(a), analysisId)
    const job = { id: 'restart-auto', kind: 'vision', brandId, versionId, analysisId, status: 'running' }
    db.prepare('INSERT INTO jobs(id,json) VALUES(?,?)').run(job.id, JSON.stringify(job)); db.close()
    // The restarted worker owns fresh routes. Query its persisted state directly, as a refreshed page would.
    kb = installKnowledge(express(), opts)
    await until(async () => { const v = JSON.parse(kb.db.prepare('SELECT json FROM versions WHERE id=?').get(versionId).json); const a = JSON.parse(kb.db.prepare('SELECT json FROM analyses WHERE id=?').get(analysisId).json); return v.status === 'ready' && a.status === 'succeeded' })
    assert.equal(count, callsBeforeRetry + 21 - completedBeforeRetry, 'completed pages must not be analyzed twice')
    const chunks = kb.db.prepare('SELECT json FROM chunks WHERE version_id=?').all(versionId).map((r) => JSON.parse(r.json))
    assert.ok(chunks.some((c) => c.source === '第 21 页 · 图文识别' && c.text.includes('禁止改色')))
    assert.equal(JSON.parse(kb.db.prepare('SELECT json FROM documents WHERE id=?').get(id).json).publishedVersionId, null)
  } finally { await new Promise((r) => server.close(r)); await kb.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
test('one-click automation on an existing published manual creates a draft and leaves published knowledge unchanged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-auto-published-'))
  const user = { id: 'admin', email: 'zhangwj159@onewo.com' }, app = express()
  app.use(express.json({ limit: '20mb' }))
  const auth = (req, res, next) => { req.user = user; next() }
  const kb = installKnowledge(app, { automaticVision: false, dataDir: dir, requireAuth: auth, requireAdmin: auth, listUsers: () => [user], embed: async (texts) => texts.map(() => [1, 0]), analyze: async () => ({ text: '补充识别出的规范', rules: ['禁止变形'], assets: [] }) })
  app.use((e, req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}/api/knowledge`
  const call = async (url, body) => { const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() } }
  const until = async (fn) => { for (let i = 0; i < 200; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)) }; throw Error('timeout') }
  try {
    const brandId = (await call('/bootstrap')).data.brands[0].id
    const d = (await call('/documents', { brandId, title: '已有手册', content: '原版规范', kind: 'document', file: { name: 'manual.pdf', base64: pdf(1).toString('base64') } })).data
    const id = d.document.id, versionId = d.document.latestVersionId
    await until(async () => (await call(`/documents/${id}`)).data.versions[0].status === 'ready')
    assert.equal((await call(`/documents/${id}/publish`, { versionId })).status, 200)
    const originalChunks = (await call(`/documents/${id}`)).data.versions[0].chunks
    const started = await call(`/documents/${id}/analyze`, { versionId, automatic: true })
    assert.equal(started.status, 202); assert.notEqual(started.data.analysis.versionId, versionId)
    const final = await until(async () => { const d = (await call(`/documents/${id}`)).data; return d.analyses[0]?.status === 'succeeded' && d.versions.at(-1).status === 'ready' && d })
    assert.equal(final.document.publishedVersionId, versionId)
    assert.deepEqual(final.versions[0].chunks, originalChunks)
    assert.ok(final.versions.at(-1).chunks.some((c) => c.text.includes('禁止变形')))
    assert.equal((await call(`/documents/${id}/publish`, { versionId: final.document.latestVersionId })).status, 200)
  } finally { await new Promise((r) => server.close(r)); await kb.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
test('two pages run in parallel while other documents finish text indexing independently', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-vision-parallel-'))
  const user = { id: 'admin', email: 'zhangwj159@onewo.com' }, app = express()
  app.use(express.json({ limit: '20mb' }))
  const auth = (req, res, next) => { req.user = user; next() }
  let release, active = 0, maxActive = 0, calls = 0
  const gate = new Promise((r) => { release = r })
  const kb = installKnowledge(app, { dataDir: dir, requireAuth: auth, requireAdmin: auth, listUsers: () => [user], embed: async (texts) => texts.map(() => [1, 0]), analyze: async () => { calls++; active++; maxActive = Math.max(maxActive, active); await gate; active--; return { text: '识别出的规范', rules: [], assets: [] } } })
  app.use((e, req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}/api/knowledge`
  const call = async (url, body) => { const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() } }
  const until = async (fn) => { for (let i = 0; i < 200; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)) }; throw Error('timeout') }
  try {
    const brandId = (await call('/bootstrap')).data.brands[0].id
    const uploaded = (await call('/documents', { brandId, title: '多页资料', kind: 'document', content: '先提取到的正文', file: { name: 'manual.pdf', base64: pdf(3).toString('base64') } })).data
    await until(async () => active === 2)
    const detail = (await call(`/documents/${uploaded.document.id}`)).data
    assert.equal(detail.versions[0].status, 'ready')
    assert.equal(detail.versions[0].progress.foundation.percent, 100)
    assert.ok(detail.versions[0].progress.overall >= 20 && detail.versions[0].progress.overall < 100)
    assert.ok(detail.versions[0].chunks.some((c) => c.text.includes('先提取到的正文')))
    const analysis = (await call(`/analyses/${uploaded.analyses[0].id}`)).data.analysis
    assert.equal(analysis.pages.filter((p) => p.status === 'running').length, 2)
    const text = (await call('/documents', { brandId, title: '其他资料', content: '无需等待图文识别' })).data
    await until(async () => (await call(`/documents/${text.document.id}`)).data.versions[0].status === 'ready')
    assert.equal(active, 2, 'slow vision work is still running while text ingestion completes')
    const more = []
    for (let i = 0; i < 2; i++) more.push((await call('/documents', { brandId, title: `并行资料${i}`, kind: 'document', content: '正文', file: { name: 'manual.pdf', base64: pdf(2).toString('base64') } })).data)
    await until(async () => active === 4)
    assert.equal(calls, 4, 'two documents have two model requests each; third document waits')
    const queued = (await call(`/analyses/${more[1].analyses[0].id}`)).data.analysis
    assert.equal(queued.status, 'queued')
    release()
    await until(async () => (await call(`/analyses/${more[1].analyses[0].id}`)).data.analysis.status === 'succeeded')
    await until(async () => (await call(`/analyses/${analysis.id}`)).data.analysis.status === 'succeeded')
    assert.equal(calls, 7); assert.equal(maxActive, 4)
    const done = await until(async () => { const d = (await call(`/documents/${uploaded.document.id}`)).data; return d.versions[0].status === 'ready' && d })
    assert.equal(done.versions[0].progress.overall, 100)
  } finally { release(); await new Promise((r) => server.close(r)); await kb.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
