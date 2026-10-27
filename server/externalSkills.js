import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { validateSkillMarkdown } from './skills.js'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const sha = (text) => createHash('sha256').update(text).digest('hex')
const sourceOK = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,99}\/[a-z0-9][a-z0-9_.-]{0,99}$/i.test(value) && !value.split('/').some((s) => s === '.' || s === '..')
const safePath = (value) => typeof value === 'string' && value.length < 600 && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some((s) => !s || s === '.' || s === '..')
export function externalSkillCompatibility(markdown, files = []) {
  const dependencies = files.filter((p) => !/(?:^|\/)(?:SKILL\.md|README(?:\.md)?|LICENSE(?:\.[a-z]+)?)$/i.test(p))
  const toolUse = /(?:\b(?:npx|npm|pnpm|python3?|pip3?|bash|curl|wget)\s|scripts\/|references\/|assets\/|mcp__|exec_command|allowed-tools\s*:)/i.test(markdown)
  return { usable: !dependencies.length && !toolUse, reason: dependencies.length ? '依赖额外脚本或参考文件，目前仅安装 MD，需适配后才能用于生成。' : toolUse ? '需要终端、脚本或外部工具，当前生成工具不能直接执行。' : '可作为生图、生视频的文字规则使用，不执行脚本。', dependencies: dependencies.slice(0, 30) }
}
export function installExternalSkills(app, { dataDir, requireAuth, fetchImpl = fetch }) {
  const file = path.join(dataDir, 'external-skill-installs.json')
  let records = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  const previews = new Map(), rates = new Map()
  const save = () => { fs.writeFileSync(`${file}.next`, JSON.stringify(records), { mode: 0o600 }); fs.renameSync(`${file}.next`, file) }
  const publicRecord = ({ ownerId: _owner, ...record }) => record
  const own = (user, id) => { const r = records.find((item) => item.id === id && item.ownerId === user.id); if (!r) throw fail('未安装此 Skill 或无权访问', 404); return r }
  const route = (handler) => async (req, res, next) => { try { await handler(req, res) } catch (error) { next(error) } }
  async function remote(url, json = false, limit = 3_000_000) {
    const response = await fetchImpl(url, { headers: { Accept: json ? 'application/json' : 'text/plain', 'User-Agent': 'DGen-Skill-Discovery' }, signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw fail(response.status === 429 || response.status === 403 ? '来源服务暂时限流，请稍后重试' : `读取 Skill 来源失败（HTTP ${response.status}）`, 502)
    if (Number(response.headers.get('content-length')) > limit) throw fail('来源文件过大，无法安全读取', 422)
    const reader = response.body.getReader(), chunks = []; let size = 0
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw fail('来源文件过大，无法安全读取', 422) }; chunks.push(Buffer.from(value)) } } finally { reader.releaseLock() }
    const text = Buffer.concat(chunks).toString('utf8')
    if (!json) return text
    try { return JSON.parse(text) } catch { throw fail('来源服务返回格式不完整，请重试', 502) }
  }
  const rawUrl = (r) => `https://raw.githubusercontent.com/${r.source}/${r.commit}/${r.path.split('/').map(encodeURIComponent).join('/')}`
  app.get('/api/skills/external/search', requireAuth, route(async (req, res) => {
    const query = String(req.query.q || '').trim()
    if (query.length < 2 || query.length > 120) throw fail('请输入 2–120 个字符的搜索词')
    const rate = rates.get(req.user.id); if (rate && Date.now() - rate.at < 60000 && rate.count >= 30) throw fail('搜索过于频繁，请稍后再试', 429)
    rates.set(req.user.id, rate && Date.now() - rate.at < 60000 ? { ...rate, count: rate.count + 1 } : { at: Date.now(), count: 1 })
    const data = await remote(`https://skills.sh/api/search?${new URLSearchParams({ q: query, limit: '20' })}`, true)
    const skills = (data.skills || []).filter((s) => sourceOK(s.source) && typeof s.name === 'string').slice(0, 20).map((s) => ({ name: s.name.slice(0, 150), source: s.source, installs: Math.max(0, Number(s.installs) || 0), url: `https://skills.sh/${s.source}/${encodeURIComponent(s.name)}` }))
    res.set('Cache-Control', 'no-store').json({ skills })
  }))
  app.post('/api/skills/external/preview', requireAuth, route(async (req, res) => {
    const { source, name } = req.body
    if (!sourceOK(source) || typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(name)) throw fail('Skill 来源或名称无效')
    const commitData = await remote(`https://api.github.com/repos/${source}/commits/HEAD`, true)
    const commit = commitData.sha
    if (!/^[a-f0-9]{40}$/.test(commit)) throw fail('无法确认来源版本', 502)
    const tree = await remote(`https://api.github.com/repos/${source}/git/trees/${commit}?recursive=1`, true)
    const entries = (tree.tree || []).filter((e) => e.type === 'blob' && e.mode !== '120000' && safePath(e.path))
    const candidates = entries.filter((e) => e.path === 'SKILL.md' || e.path.endsWith(`/${name}/SKILL.md`)).sort((a, b) => a.path.length - b.path.length)
    const match = candidates.find((e) => e.path !== 'SKILL.md') || candidates[0]
    if (!match) throw fail('在来源仓库中未找到对应的 SKILL.md，请尝试其他 Skill', 404)
    const folder = match.path.includes('/') ? match.path.slice(0, match.path.lastIndexOf('/') + 1) : ''
    const metadata = { source, name, commit, path: match.path }
    const markdown = await remote(rawUrl(metadata), false, 240000)
    const parsed = validateSkillMarkdown(markdown)
    if (parsed.name !== name) throw fail('来源文件名称与搜索结果不一致，未安装', 422)
    const files = entries.filter((e) => e.path.startsWith(folder)).map((e) => e.path.slice(folder.length))
    const compatibility = externalSkillCompatibility(markdown, tree.truncated ? [...files, '来源目录不完整'] : files)
    const preview = { ...metadata, title: parsed.name, summary: parsed.description.slice(0, 500), sha256: sha(markdown), compatibility, markdown }
    for (const [key, value] of previews) if (Date.now() - value.at > 600000) previews.delete(key)
    if (previews.size > 100) previews.delete(previews.keys().next().value)
    const previewId = randomUUID(); previews.set(previewId, { ownerId: req.user.id, at: Date.now(), preview })
    res.set('Cache-Control', 'no-store').json({ preview: { ...preview, previewId } })
  }))
  app.get('/api/skills/external/installed', requireAuth, route((req, res) => res.set('Cache-Control', 'no-store').json({ skills: records.filter((r) => r.ownerId === req.user.id).map(publicRecord) })))
  app.post('/api/skills/external/installed', requireAuth, route((req, res) => {
    const entry = previews.get(req.body.previewId)
    if (!entry || entry.ownerId !== req.user.id || Date.now() - entry.at > 600000) throw fail('预览已过期，请重新预览后下载', 409)
    const { markdown, ...metadata } = entry.preview
    let record = records.find((r) => r.ownerId === req.user.id && r.source === metadata.source && r.path === metadata.path && r.sha256 === metadata.sha256)
    if (!record && records.filter((r) => r.ownerId === req.user.id).length >= 200) throw fail('最多安装 200 个外部 Skill')
    const targets = metadata.compatibility.usable ? ['image', 'video'] : []
    record = { ...record, ...metadata, id: record?.id || `external-${randomUUID()}`, ownerId: req.user.id, targets, installedAt: record?.installedAt || new Date().toISOString(), updatedAt: new Date().toISOString() }
    records = [record, ...records.filter((r) => r.id !== record.id)]; save()
    res.json({ skill: publicRecord(record), markdown })
  }))
  app.get('/api/skills/external/:id/download', requireAuth, route(async (req, res) => {
    const record = own(req.user, req.params.id), markdown = await remote(rawUrl(record), false, 240000)
    if (sha(markdown) !== record.sha256) throw fail('来源文件与安装版本不一致，请从发现页重新预览', 409)
    res.set('Cache-Control', 'no-store').json({ skill: publicRecord(record), markdown })
  }))
  app.delete('/api/skills/external/:id', requireAuth, route((req, res) => { own(req.user, req.params.id); records = records.filter((r) => r.id !== req.params.id); save(); res.json({ ok: true }) }))
  return { resolve(user, id, target, input) {
    const record = own(user, id)
    if (!record.compatibility.usable || !record.targets.includes(target)) throw fail('此 Skill 需要适配，不能直接用于当前工具', 422)
    if (!input || typeof input.markdown !== 'string') throw fail('本机缺少 Skill MD 文件，请到“发现 Skill → 已安装”重新下载', 409)
    validateSkillMarkdown(input.markdown)
    if (sha(input.markdown) !== record.sha256) throw fail('本地 Skill 文件已变更或损坏，请重新下载', 409)
    return { id: record.id, title: record.title, targets: record.targets, external: true, sha256: record.sha256, markdown: input.markdown }
  } }
}
