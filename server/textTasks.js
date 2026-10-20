import fs from 'node:fs'
import path from 'node:path'

// Store task inputs before acknowledging submission so a service restart can resume.
export function installTextTasks(app, { dataDir, requireAuth, handleCompletion, prepareInput }) {
  const file = path.join(dataDir, 'text-tasks.json')
  fs.mkdirSync(dataDir, { recursive: true })
  let tasks = []
  if (fs.existsSync(file)) tasks = JSON.parse(fs.readFileSync(file, 'utf8'))
  const executing = new Set()
  const save = () => {
    fs.writeFileSync(`${file}.next`, JSON.stringify(tasks), { mode: 0o600 })
    fs.renameSync(`${file}.next`, file)
  }
  const publicTask = ({ id, status, result, error, createdAt }) => ({ id, status, result, error, createdAt })
  const owner = (req, kind) => kind === 'text' || req.body?.knowledge?.brandId ? req.user?.id : req.headers['x-text-session']
  async function run(task) {
    if (executing.has(task.id)) return
    executing.add(task.id)
    let statusCode = 200
    const fail = (error) => { task.status = 'failed'; task.error = error?.name === 'TimeoutError' ? '回复服务暂时超时，请重试' : String(error?.message || '回复生成失败') }
    try {
      if (prepareInput && !task.prepared) {
        task.input = await prepareInput({ body: task.input, user: task.user, path: `/api/${task.kind}/tasks` })
        task.prepared = true; save()
      }
      await handleCompletion({ body: task.input, user: task.user }, {
        status(code) { statusCode = code; return this },
        json(result) {
          if (statusCode >= 400) fail(new Error(result.error))
          else { task.status = 'succeeded'; task.result = result }
        },
      }, fail)
      if (task.status === 'running') fail(new Error('回复服务未返回结果'))
    } catch (error) { fail(error) }
    finally { delete task.input; executing.delete(task.id); save() }
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
        tasks = tasks.filter((task) => task.status === 'running' || Date.now() - task.createdAt < 7 * 24 * 60 * 60 * 1000)
        const input = { ...req.body }; delete input.__knowledge
        const duplicate = tasks.find((task) => task.id === id)
        if (duplicate) return res.json({ task: publicTask(duplicate) })
        const task = { id, owner: scope, kind, privateKnowledge: Boolean(req.body.knowledge?.brandId), status: 'running', input, user: req.user || null, createdAt: Date.now() }
        tasks.push(task); save()
        setImmediate(() => { void run(task) })
        res.status(202).json({ task: publicTask(task) })
      } catch (error) { next(error) }
    })
    app.get(`/api/${kind}/tasks/:id`, ...guards, (req, res) => {
      const task = tasks.find((item) => item.id === req.params.id && item.owner === (item.privateKnowledge ? req.user?.id : owner(req, kind)) && item.kind === kind)
      if (!task) return res.status(404).json({ error: '回复任务不存在或无权访问' })
      res.set('Cache-Control', 'no-store').json({ task: publicTask(task) })
    })
  }
  for (const task of tasks.filter((item) => item.status === 'running')) setImmediate(() => { void run(task) })
}
