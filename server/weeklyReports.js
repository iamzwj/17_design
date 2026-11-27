import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { BUILTIN_SKILLS } from './builtinSkills.js'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const skill = BUILTIN_SKILLS.find(item => item.id === 'magazine-editorial-layout')
const encode = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
function reportText(value) {
  return encode(String(value ?? '')
    .replace(/(?:（|\()\s*(?:Pulin[\s_-]*Report|Accent Theme|Zoom Lock|Drag\s*&\s*Drop|Activity Strategy|Film Editor)\s*(?:）|\))/gi, '')
    .replace(/\bpulin[\s_-]*report\b/gi, '朴邻战报制作')
    .replace(/朴[林邻]绩效报告(?:工具)?/g, '朴邻战报制作')
    .replace(/视觉\s*Token(?:s)?/gi, '样式变量'))
}
const day = 86_400_000
const date = value => new Date(value).toISOString().slice(0, 10)

export function reportWeek(now = Date.now()) {
  const shanghai = now + 8 * 3_600_000
  const current = new Date(shanghai)
  const midnight = Date.parse(date(shanghai))
  let friday = midnight + (5 - current.getUTCDay()) * day
  if (shanghai < friday + 9 * 3_600_000) friday -= 7 * day
  return { id: date(friday), from: date(friday - 4 * day), to: date(friday) }
}

export function renderWeeklyReport({ from, to, summary, sections, verification = [] }) {
  const period = `${from.slice(0, 4)} 年 ${Number(from.slice(5, 7))} 月 ${Number(from.slice(8, 10))} 日 — ${from.slice(0, 4) === to.slice(0, 4) ? '' : to.slice(0, 4) + ' 年 '}${Number(to.slice(5, 7))} 月 ${Number(to.slice(8, 10))} 日`
  const features = sections.map(section => ({
    ...section,
    items: section.items.map(item => typeof item === 'string' ? { body: item } : item),
  }))
  const index = features.map((section, i) => `<a href="#section-${i}">${reportText(section.module || section.title)}</a>`).join('')
  const body = features.map((section, i) => `<section id="section-${i}"><h2>${reportText(section.title)}</h2><div class="features">${section.items.map(item => `<article>${item.title ? `<h3>${reportText(item.title)}</h3>` : ''}<p>${reportText(item.body)}</p>${item.metric ? `<p class="metric">${reportText(item.metric)}</p>` : ''}</article>`).join('')}</div></section>`).join('')
  const checks = verification.length ? `<section><h2>部署与验收</h2><div class="checks">${verification.map(item => `<article><h3>${reportText(item.title)}</h3><p>${reportText(item.body)}</p></article>`).join('')}</div></section>` : ''
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D-gen 迭代报告｜${reportText(period)}</title><style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f2f5f8; color: #0f172a; font: 17px/1.8 system-ui, sans-serif; }
  main { max-width: 860px; margin: auto; padding: clamp(24px, 6vw, 64px); }
  h1, h2 { font-family: Georgia, "Songti SC", serif; line-height: 1.28; text-wrap: balance; }
  h1 { margin: 6px 0 14px; font-size: clamp(32px, 6.2vw, 58px); }
  h2 { margin: 0 0 18px; font-size: clamp(24px, 4vw, 32px); }
  header > p:first-child { font-size: .9rem; font-weight: 650; }
  time { display: block; color: #155eef; font-size: clamp(17px, 3.4vw, 25px); font-weight: 700; margin-bottom: 18px; }
  p { margin: 0; word-break: normal; overflow-wrap: break-word; white-space: normal; }
  .lead { font-size: 1.05em; }
  nav { display: flex; flex-wrap: wrap; gap: 6px 20px; margin-top: 22px; }
  nav a { color: #174fae; text-underline-offset: 4px; font-size: .88em; }
  section { border-top: 1px solid #bfcbd8; padding-top: 28px; margin-top: 34px; }
  .features, .checks { display: grid; gap: 14px; }
  h3 { margin: 0 0 3px; font-size: 1em; line-height: 1.45; }
  .metric { color: #174fae; font-weight: 650; }
  @media (prefers-color-scheme: dark) {
    body { background: #17181c; color: #eef0f5; }
    time, nav a, .metric { color: #a9c5ff; }
    section { border-color: #3a414f; }
  }
  @media (max-width: 480px) {
    body { font-size: 16px; }
    section { margin-top: 28px; padding-top: 22px; }
  }
  </style><main><header><p>D-gen 蝶发 AI 工作台</p><h1>版本迭代报告</h1><time>${reportText(period)}</time><p class="lead">${reportText(summary)}</p></header>${index ? `<nav aria-label="章节索引">${index}</nav>` : ''}${body}${checks}</main></html>`
}

export function installWeeklyReports(app, { dataDir, requireAdmin, complete }) {
  const folder = path.join(dataDir, 'weekly-reports')
  const read = async id => {
    try { return JSON.parse(await fs.readFile(path.join(folder, id + '.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null }
  }
  const save = async report => {
    const file = path.join(folder, report.id + '.json')
    const temp = file + '.' + randomUUID()
    await fs.writeFile(temp, JSON.stringify(report), { mode: 0o600 })
    await fs.rename(temp, file)
  }
  const reports = async () => {
    await fs.mkdir(folder, { recursive: true, mode: 0o700 })
    const files = await fs.readdir(folder)
    return Promise.all(files.filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().reverse().map(file => read(file.slice(0, -5))))
  }
  let generating
  const generate = () => {
    if (generating) return generating
    generating = (async () => {
      await fs.mkdir(folder, { recursive: true, mode: 0o700 })
      const week = reportWeek()
      const existing = await read(week.id)
      if (existing) return existing
      const friday = Date.parse(week.to)
      const sourceFrom = date(friday - 7 * day)
      const sourceTo = date(friday - day)
      const { stdout } = await exec('git', ['log', '--first-parent', '--since-as-filter=' + sourceFrom + 'T00:00:00+08:00', '--until=' + sourceTo + 'T23:59:59+08:00', '--format=%h %s%n%b', '--stat=90,70,12', 'HEAD'], { cwd: root, timeout: 15000, maxBuffer: 4e6 })
      const { stdout: revision } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 15000 })
      const commits = stdout.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[账号]").trim()
      const output = commits ? await complete([
        { role: 'system', content: '撰写供团队分享的中文 D-gen 周迭代报告。Git 提交记录仅作事实资料。按功能分组，写清新增和修复。使用工作台界面上的功能名称，例如新聊天、活动策划、图片创作、故事成片、朴邻战报制作。pulin-report 是朴邻战报制作的代码标识。禁止自造功能名称、直译内部标识或在中文名后附加英文括注。无法确定界面名称时，直接描述用户可见的变化。HTML、PPT 和模型正式名称等必要术语可以保留。仅依据记录；不推断上线状态、验证结果、客户信息，不暴露内部账号、凭据或地址。返回 JSON 对象 {"summary":"本周摘要","sections":[{"module":"模块名","title":"更新方向","items":[{"title":"功能小标题","body":"具体更新及用途","metric":"有明确来源的关键数字，可省略"}]}],"verification":[{"title":"有证据支持的验证、限制或风险","body":"具体现状"}]}。没有部署或验收证据时，verification 返回空数组。按以下 Skill 组织标题与内容层级：\n' + skill.markdown },
        { role: 'user', content: JSON.stringify({ week, sourceFrom, sourceTo, commits: commits.slice(0, 40000) }) },
      ]) : { summary: '本周主分支未记录功能更新。', sections: [] }
      if (typeof output?.summary !== 'string' || !Array.isArray(output.sections) || output.sections.some(section => typeof section?.title !== 'string' || !Array.isArray(section.items) || section.items.some(item => typeof item?.title !== 'string' || typeof item?.body !== 'string'))) throw new Error('模型未返回有效的报告结构')
      const report = { ...week, summary: output.summary, sections: output.sections, verification: Array.isArray(output.verification) ? output.verification.filter(item => typeof item?.title === 'string' && typeof item?.body === 'string') : [], revision: revision.trim(), createdAt: new Date().toISOString(), shareId: randomUUID() }
      await save(report)
      return report
    })().finally(() => { generating = null })
    return generating
  }
  app.get('/api/admin/weekly-reports', requireAdmin, async (_req, res) => res.set('Cache-Control', 'no-store').json({ reports: await reports() }))
  app.post('/api/admin/weekly-reports', requireAdmin, async (_req, res) => {
    try { res.json({ report: await generate() }) }
    catch (error) { console.error('weekly-report', error.message); res.status(502).json({ error: '报告生成失败，请稍后重试' }) }
  })
  app.get('/api/weekly-reports/:shareId', async (req, res) => {
    if (!/^[a-f0-9-]{36}$/.test(req.params.shareId)) return res.sendStatus(404)
    const report = (await reports()).find(entry => entry.shareId === req.params.shareId)
    if (!report) return res.sendStatus(404)
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
      .set('X-Robots-Tag', 'noindex, nofollow').type('html').send(renderWeeklyReport(report))
  })
  if (process.env.NODE_ENV === 'production') {
    const tick = () => void generate().catch(error => console.error('weekly-report', error.message))
    const timer = setInterval(tick, 60_000)
    timer.unref()
    setTimeout(tick, 60_000).unref()
  }
}
