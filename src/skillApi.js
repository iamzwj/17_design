import { getAuthToken } from './api.js'
const base = () => String(window.XIAODIE_CONFIG?.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
export async function skillRequest(path = '', body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base()}/api/skills${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` }, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Skill 库暂时无法连接，请重试')
  return data
}
export async function downloadSkill(id, draft = false) {
  const response = await fetch(`${base()}/api/skills/${id}/download${draft ? '?draft=1' : ''}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: 'no-store' })
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '下载失败，请重试') }
  const url = URL.createObjectURL(await response.blob()), a = document.createElement('a')
  a.href = url; a.download = 'SKILL.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
}
