import fs from 'node:fs'
import path from 'node:path'

// Store task inputs before acknowledging submission so a service restart can resume.
export function installTextTasks(app, { dataDir, requireAuth, handleCompletion, prepareInput, resolveSkill }) {
  const file = path.join(dataDir, 'text-tasks.json')
  fs.mkdirSync(dataDir, { recursive: true })
  let tasks = []
  if (fs.existsSync(file)) tasks = JSON.parse(fs.readFileSync(file, 'utf8'))
  const executing = new Set()
  const taskDeadline = 10 * 60 * 1000
  function expire(task) {
    if (!['running', 'needs-local-skill'].includes(task.status) || Date.now() - task.createdAt < taskDeadline) return false
    task.status = 'failed'
    task.error = '回复生成超时，请重新发送。'
    delete task.input
    localSkills.delete(task.id)
    save()
    return true
  }
  const localSkills = new Map()
  const save = () => {
    fs.writeFileSync(`${file}.next`, JSON.stringify(tasks), { mode: 0o600 })
    fs.renameSync(`${file}.next`, file)
  }
  const publicTask = ({ id, status, result, error, createdAt, skill }) => ({ id, status, result, error, createdAt, ...(skill ? { skill: { id: skill.id, title: skill.title, external: Boolean(skill.external) } } : {}) })
  const owner = (req, kind) => req.user || kind === 'text' || req.body?.knowledge?.brandId ? req.user?.id : req.headers['x-text-session']
  async function run(task) {
    if (executing.has(task.id) || expire(task)) return
    if (task.skill?.external && !localSkills.has(task.id)) { task.status = 'needs-local-skill'; save(); return }
    executing.add(task.id)
    task.status = 'running'
    let statusCode = 200
    const fail = (error) => { if (task.status !== 'running') return; task.status = 'failed'; task.error = error?.name === 'TimeoutError' ? '回复服务暂时超时，请重试' : String(error?.message || '回复生成失败') }
    try {
      if (prepareInput && !task.prepared) {
        task.input = await prepareInput({ body: task.input, user: task.user, path: `/api/${task.kind}/tasks` })
        task.prepared = true; save()
      }
      if (task.status !== 'running' || expire(task)) return
      const skill = task.skill?.external ? localSkills.get(task.id) : task.skill
      const body = skill ? { ...task.input, __skill: skill } : task.input
      await handleCompletion({ body, user: task.user }, {
        status(code) { statusCode = code; return this },
        json(result) {
          if (task.status !== 'running' || expire(task)) return
          if (statusCode >= 400) fail(new Error(result.error))
          else { task.status = 'succeeded'; task.result = task.skill ? { ...result, skillSnapshot: { id: task.skill.id, title: task.skill.title } } : result }
        },
      }, fail)
      if (task.status === 'running') fail(new Error('回复服务未返回结果'))
    } catch (error) { fail(error) }
    finally { delete task.input; localSkills.delete(task.id); executing.delete(task.id); save() }
  }
  for (const kind of ['text', 'compliance']) {
    const guards = kind === 'text' ? [requireAuth] : [(req, res, next) => req.headers.authorization || req.body?.knowledge?.brandId ? requireAuth(req, res, next) : next()]
    app.post(`/api/${kind}/tasks`, ...guards, async (req, res, next) => {
      try {
        const scope = owner(req, kind)
        const id = req.body?.requestId
        if (!scope || typeof scope !== 'string' || scope.length > 200 || !/^[a-f0-9-]{36}$/i.test(id || '')) return res.status(400).json({ error: '任务标识无效' })
        const existing = tasks.find((task) => task.id === id)
        if (existing) {
          if (existing.owner !== scope || existing.kind !== kind) return res.status(404).json({ error: '回复任务不存在' })
          return res.json({ task: publicTask(existing) })
        }
        if (!Array.isArray(req.body.messages) || !req.body.messages.length) return res.status(400).json({ error: 'messages 不能为空' })
        tasks = tasks.filter((task) => ['running', 'needs-local-skill'].includes(task.status) || Date.now() - task.createdAt < 7 * 24 * 60 * 60 * 1000)
        const skill = kind === 'text' && req.body.skillId ? resolveSkill?.(req.user, req.body.skillId, req.body.localSkill) : null
        if (kind === 'text' && req.body.skillId && !skill) throw Object.assign(new Error('所选 Skill 无法使用'), { status: 400 })
        const input = { ...req.body }; delete input.__knowledge; delete input.__skill; delete input.localSkill
        const duplicate = tasks.find((task) => task.id === id)
        if (duplicate) return res.json({ task: publicTask(duplicate) })
        const task = { id, owner: scope, kind, privateKnowledge: Boolean(req.body.knowledge?.brandId || (req.user && req.body.complianceBrand)), status: 'running', input, user: req.user || null, createdAt: Date.now() }
        if (skill) { task.skill = skill.external ? { id: skill.id, title: skill.title, external: true, sha256: skill.sha256 } : skill; if (skill.external) localSkills.set(id, skill) }
        tasks.push(task); save()
        setImmediate(() => { void run(task) })
        res.status(202).json({ task: publicTask(task) })
      } catch (error) { next(error) }
    })
    if (kind === 'text') app.post('/api/text/tasks/:id/resume-skill', ...guards, (req, res, next) => {
      try {
        const task = tasks.find((item) => item.id === req.params.id && item.owner === req.user?.id && item.kind === 'text')
        if (!task || !task.skill?.external) return res.status(404).json({ error: '回复任务不存在' })
        if (task.status !== 'needs-local-skill') return res.json({ task: publicTask(task) })
        const skill = resolveSkill(req.user, task.skill.id, req.body.localSkill)
        if (skill.sha256 !== task.skill.sha256) throw Object.assign(new Error('Skill 版本已变更，请恢复原版本'), { status: 409 })
        localSkills.set(task.id, skill); task.status = 'running'; save(); setImmediate(() => { void run(task) })
        res.json({ task: publicTask(task) })
      } catch (error) { next(error) }
    })
    app.get(`/api/${kind}/tasks/:id`, ...guards, (req, res) => {
      const task = tasks.find((item) => item.id === req.params.id && item.owner === (item.privateKnowledge ? req.user?.id : owner(req, kind)) && item.kind === kind)
      if (!task) return res.status(404).json({ error: '回复任务不存在或无权访问' })
      expire(task)
      res.set('Cache-Control', 'no-store').json({ task: publicTask(task) })
    })
  }
  for (const task of tasks.filter((item) => ['running', 'needs-local-skill'].includes(item.status))) setImmediate(() => { void run(task) })
}
