import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import JSZip from 'jszip'
import { pptxSections } from '../server/knowledge/pptx.js'
import { installKnowledge } from '../server/knowledge/index.js'
async function deck({ empty = false, count = 2, large = false } = {}) {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', `<p:presentation><p:sldIdLst>${Array.from({ length: count }, (_, i) => `<p:sldId id="${i + 1}" r:id="r${i}"/>`).join('')}</p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships>${Array.from({ length: count }, (_, i) => `<Relationship Id="r${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${count - i}.xml"/>`).join('')}</Relationships>`)
  for (let i = 1; i <= count; i++) zip.file(`ppt/slides/slide${i}.xml`, `<p:sld><a:p><a:r><a:t>${empty ? '' : `品牌第${i}页 &amp; Logo &#x8272;`}</a:t></a:r></a:p></p:sld>`)
  if (large) zip.file('ppt/media/large.png', Buffer.alloc(13 * 1024 * 1024))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
}
test('PPTX preserves presentation order, XML text and page references; rejects scans, invalid and oversized decks', async () => {
  assert.deepEqual(await pptxSections(await deck()), [{ text: '品牌第2页 & Logo 色', source: '第 1 页' }, { text: '品牌第1页 & Logo 色', source: '第 2 页' }])
  await assert.rejects(pptxSections(await deck({ empty: true })), /图片型.*PDF/)
  await assert.rejects(pptxSections(await deck({ count: 101 })), /100 页/)
  await assert.rejects(pptxSections(Buffer.from('not a zip')), /损坏或已加密/)
})
test('PPTX over 12MB uploads, processes, publishes, searches and downloads unchanged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-pptx-'))
  const user = { id: 'admin', email: 'zhangwj159@onewo.com' }
  const app = express(); app.use(express.json({ limit: '140mb' }))
  const auth = (req, res, next) => { req.user = user; next() }
  const kb = installKnowledge(app, { automaticVision: false, dataDir: dir, requireAuth: auth, requireAdmin: auth, listUsers: () => [user], embed: async (texts) => texts.map(() => [1, 0]) })
  app.use((e, req, res, _next) => res.status(e.status || 500).json({ error: e.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}/api/knowledge`
  const call = async (url, body) => { const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, body: await res.json() } }
  try {
    const brandId = (await call('/bootstrap')).body.brands[0].id
    const buffer = await deck({ large: true })
    const uploaded = await call('/documents', { brandId, title: 'PPTX品牌手册', kind: 'document', file: { name: '手册.PPTX', base64: buffer.toString('base64') } })
    assert.equal(uploaded.status, 202)
    const id = uploaded.body.document.id
    let detail
    for (let i = 0; i < 200; i++) { detail = (await call(`/documents/${id}`)).body; if (detail.versions.at(-1).status === 'ready') break; if (detail.versions.at(-1).status === 'failed') assert.fail(detail.versions.at(-1).error); await new Promise((r) => setTimeout(r, 20)) }
    assert.equal(detail.versions.at(-1).status, 'ready')
    const versionId = detail.document.latestVersionId
    assert.equal((await call(`/documents/${id}/publish`, { versionId })).status, 200)
    const search = (await call('/search', { brandId, query: '品牌', mode: 'keyword' })).body
    assert.ok(search.results.some((r) => r.source === '第 1 页' && r.text.includes('第2页')))
    kb.db.prepare('INSERT INTO jobs(id,json) VALUES(?,?)').run('stale-failure', JSON.stringify({ id: 'stale-failure', brandId, versionId, status: 'failed', error: '旧的解析失败' }))
    const listed = (await call(`/documents?brandId=${brandId}`)).body
    assert.ok(!listed.jobs.some((j) => j.id === 'stale-failure'))
    const original = await fetch(`${base}/documents/${id}/files/${versionId}`)
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), buffer)
    assert.match((await call('/documents', { brandId, title: '旧格式', file: { name: 'manual.ppt', base64: 'YQ==' } })).body.error, /不支持此格式/)
  } finally { await new Promise((r) => server.close(r)); kb.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
