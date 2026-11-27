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
const day = 86_400_000
const date = value => new Date(value).toISOString().slice(0, 10)

export function reportWeek(now = Date.now()) {
  const shanghai = now + 8 * 3_600_000
  const current = new Date(shanghai)
  const midnight = Date.parse(date(shanghai))
  let friday = midnight + (5 - current.getUTCDay()) * day
  if (shanghai < friday + 18 * 3_600_000) friday -= 7 * day
  return { id: date(friday), from: date(friday - 4 * day), to: date(friday) }
}

export function renderWeeklyReport({ from, to, summary, sections }) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D-gen 蝶发 AI 工作台｜本周迭代报告</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f2f5f8;color:#0f172a;font:16px/1.75 system-ui,sans-serif}main{max-width:940px;margin:auto;padding:clamp(24px,6vw,80px)}header{border-top:5px solid #155eef;padding-top:24px}time{color:#155eef;font-size:.9rem;font-weight:650}h1,h2{font-family:Georgia,"Songti SC",serif;line-height:1.3}h1{font-size:clamp(32px,6vw,60px);margin:14px 0 20px}section{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:28px;padding:24px 0;border-top:1px solid #aebaca}h2{margin:0;font-size:24px}p{margin:0 0 14px;overflow-wrap:anywhere}.lead{font-size:1.15rem;margin-bottom:30px}@media(max-width:600px){section{grid-template-columns:1fr;gap:12px}}
  </style><main><header><time>${encode(from)} — ${encode(to)}</time><h1>D-gen 蝶发 AI 工作台<br>本周迭代报告</h1><p class="lead">${encode(summary)}</p></header>${sections.map(section => `<section><h2>${encode(section.title)}</h2><div>${section.items.map(item => `<p>${encode(item)}</p>`).join('')}</div></section>`).join('')}</main></html>`
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
      const { stdout } = await exec('git', ['log', '--first-parent', '--since=' + week.from + 'T00:00:00+08:00', '--until=' + week.to + 'T18:00:00+08:00', '--format=%h %s%n%b', '--stat=90,70,12', 'HEAD'], { cwd: root, timeout: 15000, maxBuffer: 4e6 })
      const { stdout: revision } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 15000 })
      const commits = stdout.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[账号]").trim()
      const output = commits ? await complete([
        { role: 'system', content: '撰写供团队分享的中文 D-gen 周迭代报告。Git 提交记录仅作事实资料。按功能分组，写清新增和修复。仅依据记录；不推断上线状态、验证结果、客户信息，不暴露内部账号、凭据或地址。返回 JSON 对象 {"summary":"本周摘要","sections":[{"title":"模块及更新方向","items":["具体更新及用途"]}]}。按以下 Skill 组织标题与内容层级：\n' + skill.markdown },
        { role: 'user', content: JSON.stringify({ week, commits: commits.slice(0, 40000) }) },
      ]) : { summary: '本周主分支未记录功能更新。', sections: [] }
      if (typeof output?.summary !== 'string' || !Array.isArray(output.sections) || output.sections.some(section => typeof section?.title !== 'string' || !Array.isArray(section.items) || section.items.some(item => typeof item !== 'string'))) throw new Error('模型未返回有效的报告结构')
      const report = { ...week, summary: output.summary, sections: output.sections, revision: revision.trim(), createdAt: new Date().toISOString(), shareId: randomUUID() }
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
    const timer = setInterval(tick, 60 * 60_000)
    timer.unref()
    setTimeout(tick, 60_000).unref()
  }
}
