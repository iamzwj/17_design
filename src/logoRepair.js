import { getAuthToken } from './api.js'
export async function retryWaterfallLogo(taskId, index) {
  const base = String(window.XIAODIE_CONFIG?.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
  const response = await fetch(`${base}/api/waterfall/tasks/${encodeURIComponent(taskId)}/slots/${index}/logo`, { method: 'POST', headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Logo重试失败')
  return data
}
