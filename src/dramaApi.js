import { getAuthToken } from './api.js'

const configuredApiBase = typeof window !== 'undefined'
  ? window.XIAODIE_CONFIG?.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || ''
  : import.meta.env.VITE_API_BASE_URL || ''
const apiBase = String(configuredApiBase).trim().replace(/\/$/, '')

function apiUrl(path) {
  return apiBase ? `${apiBase}${path}` : path
}

function headers() {
  const token = getAuthToken()
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

async function request(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(apiUrl(path), { method, headers: headers(), cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw Object.assign(new Error('网络连接暂时不可用，请稍后重试'), { status: 0 })
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `请求失败 (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}

export const listDramaProjects = () => request('/api/drama/projects')
export const createDramaProject = (payload) => request('/api/drama/projects', { method: 'POST', body: payload })
export const getDramaProject = (id) => request(`/api/drama/projects/${encodeURIComponent(id)}`)
export const updateDramaProject = (id, patch) => request(`/api/drama/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
export const deleteDramaProject = (id) => request(`/api/drama/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })

// 四个阶段共用同一入口：服务端负责调模型、校验结构、写回项目文档。
export const planDramaStage = (id, stage) => request(`/api/drama/projects/${encodeURIComponent(id)}/plan`, { method: 'POST', body: { stage } })
