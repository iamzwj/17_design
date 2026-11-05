import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { installFilms } from '../server/films.js'
import { filmReviewFingerprint, filmReviewTargets } from '../shared/filmReviewWarnings.js'

test('review dismissal persists for this review and does not hide a changed review', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-review-'))
  const app = express(); app.use(express.json())
  const films = installFilms(app, { dataDir, requireAuth: (req, res, next) => { req.user = { id: 'owner' }; next() }, worker: false })
  const p = { id: randomUUID(), userId: 'owner', reviewWarning: 1, shots: [{ id: 's1', revision: 1, review: { status: 'review', summary: '检查表情' } }], resources: [], tasks: [], appliedCommands: [] }
  films.write(p)
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  const url = `http://127.0.0.1:${server.address().port}/api/films/${p.id}`
  assert.deepEqual(filmReviewTargets(p).map(item => item.id), ['s1'])
  const fingerprint = filmReviewFingerprint(p)
  const dismissed = await fetch(url + '/review-dismissal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fingerprint }) })
  assert.equal(dismissed.status, 200)
  const saved = await (await fetch(url)).json()
  assert.equal(saved.project.reviewDismissed, fingerprint)
  assert.equal(saved.project.shots[0].review.status, 'review')
  p.shots[0].review.summary = '检查光线'; films.write(p)
  const changed = await (await fetch(url)).json()
  assert.notEqual(filmReviewFingerprint(changed.project), changed.project.reviewDismissed)
  const stale = await fetch(url + '/review-dismissal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fingerprint }) })
  assert.equal(stale.status, 409)
})
