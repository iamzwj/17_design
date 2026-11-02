import test from 'node:test'
import assert from 'node:assert/strict'
import { documentProgress } from '../server/knowledge/progress.js'
const v = { id: 'v', status: 'ready' }
const foundation = { id: 'base', versionId: 'v', phase: 'foundation', status: 'succeeded', completed: 10, total: 10 }
const analysis = { versionId: 'v', automatic: true, status: 'running', extractionComplete: true, totalPages: 2, pages: [{ result: { text: 'a' } }, {}] }
test('overall progress combines independent basic and complete stages', () => {
  const p = documentProgress(v, [foundation], [analysis])
  assert.equal(p.foundation.percent, 100)
  assert.equal(p.full.percent, 52)
  assert.equal(p.overall, 61)
})
test('completed model calls do not reach 100 until supplementary indexing finishes', () => {
  const a = { ...analysis, status: 'succeeded', textMerged: true, indexRequired: true, pages: [{ result: {} }, { result: {} }] }
  const indexing = { id: 'index', versionId: 'v', phase: 'full-index', status: 'running', completed: 4, total: 10 }
  const p = documentProgress({ ...v, status: 'processing' }, [foundation, indexing], [a])
  assert.equal(p.foundation.percent, 100); assert.equal(p.full.percent, 94); assert.equal(p.overall, 95); assert.equal(p.full.status, 'indexing')
  const done = documentProgress(v, [foundation, { ...indexing, status: 'succeeded', completed: 10 }], [a])
  assert.equal(done.overall, 100); assert.equal(done.full.status, 'succeeded')
})
test('scanned documents explicitly skip empty text layers and preserve completed-page progress on failure', () => {
  const p = documentProgress({ ...v, status: 'failed' }, [{ ...foundation, status: 'failed', error: '未提取到文字' }], [{ ...analysis, status: 'failed' }])
  assert.equal(p.foundation.status, 'skipped'); assert.equal(p.foundation.percent, 100); assert.equal(p.full.status, 'failed'); assert.ok(p.overall < 100); assert.match(p.full.label, /1\/2/)
})
test('basic-only documents complete without pretending whole-document recognition ran', () => {
  const p = documentProgress(v, [foundation], [])
  assert.equal(p.overall, 100); assert.equal(p.weights.full, 0); assert.equal(p.full.status, 'skipped'); assert.match(p.full.label, /未开启/)
})
test('legacy persisted jobs remain interpretable and empty failed ingestion never reports complete', () => {
  const a = { ...analysis, status: 'succeeded', textMerged: true, pages: [{ result: {} }, { result: {} }] }
  const p = documentProgress(v, [{ ...foundation, phase: undefined }, { id: 'old-index', versionId: 'v', status: 'succeeded' }], [a])
  assert.equal(p.overall, 100)
  const failed = documentProgress({ ...v, status: 'failed' }, [{ ...foundation, status: 'failed', error: '未提取到文字' }], [{ ...a, indexRequired: false }])
  assert.ok(failed.overall < 100); assert.equal(failed.full.status, 'failed')
})

test('legacy basic-only retries use the latest successful job instead of a stale failure', () => {
  const p = documentProgress(v, [{ id: 'old', versionId: 'v', status: 'failed', error: '模型临时失败' }, { id: 'retry', versionId: 'v', status: 'succeeded' }], [])
  assert.equal(p.foundation.percent, 100); assert.equal(p.overall, 100)
})
