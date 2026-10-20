import { getAuthToken } from './api.js'
export function knowledgeKey(suffix = '') { return `dgen-knowledge:${getAuthToken().slice(-12) || 'guest'}:${suffix}` }
export function getKnowledgeSelection() { try { return JSON.parse(localStorage.getItem(knowledgeKey('context'))) || {} } catch { return {} } }
export async function knowledgeRequest(path, body, method = body === undefined ? 'GET' : 'POST') {
  const base = String(window.XIAODIE_CONFIG?.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
  const response = await fetch(`${base}/api/knowledge${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` }, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '知识库请求失败')
  return data
}
export async function knowledgeDownload(path, name, preview = false) {
  const base = String(window.XIAODIE_CONFIG?.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
  const response = await fetch(`${base}/api/knowledge${path}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: 'no-store' })
  if (!response.ok) throw new Error('文件不存在或无权访问')
  const url = URL.createObjectURL(await response.blob())
  if (preview) return url
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
}

const searches = new Map()
export function readKnowledgeSearch() { try { return JSON.parse(localStorage.getItem(knowledgeKey('search'))) } catch { return null } }
export function startKnowledgeSearch(request, resume = false) {
  const key = knowledgeKey('search')
  if (resume && searches.has(key)) return
  const snapshot = { id: crypto.randomUUID(), request, status: 'running' }
  const save = (value) => { localStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new Event('dgen-knowledge-search')) }
  save(snapshot)
  const operation = knowledgeRequest('/search', request).then((result) => {
    const latest = JSON.parse(localStorage.getItem(key) || 'null')
    if (latest?.id === snapshot.id) save({ ...snapshot, status: 'succeeded', result })
  }).catch((error) => {
    const latest = JSON.parse(localStorage.getItem(key) || 'null')
    if (latest?.id === snapshot.id) save({ ...snapshot, status: 'failed', error: error.message })
  }).finally(() => { if (searches.get(key) === operation) searches.delete(key) })
  searches.set(key, operation)
}
