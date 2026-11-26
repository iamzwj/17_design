import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'

export function installConversationHistory(app, { dataDir, requireAuth }) {
  const file = path.join(dataDir, 'conversation-history.sqlite')
  fs.closeSync(fs.openSync(file, 'a', 0o600))
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_history (
    owner TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
    summary TEXT, record TEXT, PRIMARY KEY (owner, id)
  )`)
  const list = db.prepare('SELECT id, revision, summary FROM conversation_history WHERE owner = ?')
  const read = db.prepare('SELECT record, revision FROM conversation_history WHERE owner = ? AND id = ?')
  const put = db.prepare(`INSERT INTO conversation_history VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner, id) DO UPDATE SET revision=excluded.revision, summary=excluded.summary, record=excluded.record
    WHERE conversation_history.record IS NOT NULL`)
  const remove = db.prepare(`INSERT INTO conversation_history VALUES (?, ?, ?, NULL, NULL)
    ON CONFLICT(owner, id) DO UPDATE SET revision=excluded.revision, summary=NULL, record=NULL`)
  const route = '/api/conversation-history'
  app.get(route, requireAuth, (req, res) => res.set('Cache-Control', 'no-store').json({
    records: list.all(req.user.id).map(row => ({
      ...(row.summary ? JSON.parse(row.summary) : { deleted: true }), id: row.id, cloudRevision: row.revision,
    })),
  }))
  app.get(`${route}/:id`, requireAuth, (req, res) => {
    const row = read.get(req.user.id, req.params.id)
    if (!row?.record) return res.status(404).json({ error: '对话不存在' })
    res.set('Cache-Control', 'no-store').json({ record: JSON.parse(row.record), cloudRevision: row.revision })
  })
  app.put(`${route}/:id`, requireAuth, (req, res) => {
    const { record, importOnly, metadataOnly } = req.body || {}
    const id = req.params.id
    if (!id || id.length > 200 || record?.id !== id || !['chat', 'strategy', 'image', 'compliance', 'pulin-report'].includes(record.type)) {
      return res.status(400).json({ error: '对话数据无效' })
    }
    const prior = read.get(req.user.id, id)
    if (prior && !prior.record) return res.status(410).json({ error: '对话已删除' })
    if (importOnly && prior) return res.json({ cloudRevision: prior.revision })
    if (metadataOnly && !prior) return res.status(404).json({ error: '对话不存在' })
    const entry = metadataOnly ? { ...JSON.parse(prior.record), ...record } : record
    if (!Array.isArray(entry.messages)) return res.status(400).json({ error: '对话正文无效' })
    const encoded = JSON.stringify(entry)
    if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) return res.status(413).json({ error: '单条对话超过 8 MB' })
    const { type, title, createdAt, updatedAt, pinned, pinnedAt, archived, archivedAt, status, unreadComplete } = entry
    const summary = { type, title, createdAt, updatedAt, pinned, pinnedAt, archived, archivedAt, status, unreadComplete }
    const revision = Math.max(Date.now(), (prior?.revision || 0) + 1)
    put.run(req.user.id, id, revision, JSON.stringify(summary), encoded)
    res.json({ cloudRevision: revision })
  })
  app.delete(`${route}/:id`, requireAuth, (req, res) => {
    if (!req.params.id || req.params.id.length > 200) return res.status(400).json({ error: '对话编号无效' })
    remove.run(req.user.id, req.params.id, Date.now())
    res.json({ ok: true })
  })
  return db
}
