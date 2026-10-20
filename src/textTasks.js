import { getKnowledgeSelection } from './knowledgeApi.js'
import { getAuthToken } from './api.js'

const liveWaits = new Map()
const SESSION_KEY = 'diefa-text-task-session-v1'
function session() {
  let value = localStorage.getItem(SESSION_KEY)
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, value) }
  return value
}
async function request(kind, id, payload) {
  const base = String(window.XIAODIE_CONFIG?.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
  const response = await fetch(`${base}/api/${kind}/tasks${payload ? '' : `/${encodeURIComponent(id)}`}`, {
    method: payload ? 'POST' : 'GET', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Text-Session': session(), ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}) },
    ...(payload ? { body: JSON.stringify({ ...payload, knowledge: getKnowledgeSelection(), requestId: id }) } : {}),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error || '回复任务查询失败'), { status: response.status })
  return data.task
}
const delay = () => new Promise((resolve) => setTimeout(resolve, 2000))
export function waitForTextTask(kind, id) {
  const key = `${kind}:${id}`
  if (liveWaits.has(key)) return liveWaits.get(key)
  const promise = (async () => {
    let missingSince = null
    while (true) {
      let task
      try { task = await request(kind, id) }
      catch (error) {
        if ([401, 403].includes(error.status)) throw error
        if (error.status === 404) {
          missingSince ??= Date.now()
          if (Date.now() - missingSince > 30_000) throw new Error('回复任务未成功提交，请重新发送')
        }
        await delay(); continue
      }
      missingSince = null
      if (task.status === 'succeeded') return task.result
      if (task.status === 'failed') throw new Error(task.error || '回复生成失败')
      await delay()
    }
  })().finally(() => liveWaits.delete(key))
  liveWaits.set(key, promise)
  return promise
}
export async function generatePersistentText(kind, id, payload) {
  // Idempotent POST: a lost acknowledgment must not create another generation.
  for (let attempt = 0; ; attempt += 1) {
    try { await request(kind, id, payload); break }
    catch (error) {
      if (error.status && error.status < 500) throw error
      // Submission may have succeeded even when its HTTP response was lost.
      if (attempt >= 2) break
      await delay()
    }
  }
  return waitForTextTask(kind, id)
}

const runtimes = new Map()
export function textTaskRuntime(id, messages) {
  if (!runtimes.has(id)) runtimes.set(id, { messages: { current: messages }, active: new Map() })
  return runtimes.get(id)
}
