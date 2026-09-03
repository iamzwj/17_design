const configuredApiBase = typeof window !== 'undefined'
  ? window.XIAODIE_CONFIG?.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || ''
  : import.meta.env.VITE_API_BASE_URL || ''

const apiBase = String(configuredApiBase).trim().replace(/\/$/, '')
const AUTH_TOKEN_KEY = 'diefa-auth-token-v1'
const AUTH_REMEMBER_KEY = 'diefa-auth-remember-v1'

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || ''
}

export function saveAuthToken(token, remember) {
  clearAuthToken()
  const storage = remember ? localStorage : sessionStorage
  storage.setItem(AUTH_TOKEN_KEY, token)
  storage.setItem(AUTH_REMEMBER_KEY, remember ? '1' : '0')
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem(AUTH_REMEMBER_KEY)
  sessionStorage.removeItem(AUTH_TOKEN_KEY)
  sessionStorage.removeItem(AUTH_REMEMBER_KEY)
}

function apiUrl(path) {
  return apiBase ? `${apiBase}${path}` : path
}

function assetUrl(url) {
  if (!url || !apiBase || !url.startsWith('/')) return url
  return `${apiBase}${url}`
}

export function waterfallReferenceForRequest(url) {
  if (!url || !apiBase) return url
  try {
    const source = new URL(url)
    const api = new URL(apiBase)
    if (source.origin === api.origin && source.pathname.startsWith('/api/')) return `${source.pathname}${source.search}`
  } catch { /* Keep data URLs and external image URLs unchanged. */ }
  return url
}

function hydrateWaterfallTask(task) {
  if (!task) return task
  return {
    ...task,
    referenceImages: (task.referenceImages || []).map(assetUrl),
    slots: (task.slots || []).map((slot) => ({ ...slot, url: assetUrl(slot.url) })),
  }
}

async function post(path, body) {
  let response
  try {
    response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}) },
      body: JSON.stringify(body),
    })
  } catch {
    const error = new Error('网络连接暂时不可用，请稍后重试')
    error.status = 0
    throw error
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `请求失败 (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}

export const requestRegisterCode = (email) => post('/api/auth/register/code', { email })
export const verifyRegisterCode = (email, code) => post('/api/auth/register/verify', { email, code })
export const registerAccount = (payload) => post('/api/auth/register', payload)
export const loginAccount = (payload) => post('/api/auth/login', payload)
export const changeAccountPassword = (payload) => post('/api/auth/password', payload)
export const logoutAccount = () => post('/api/auth/logout', {})
export const recordPleaseDayAvatarDownload = () => post('/api/please-day/avatar-downloads', {})

export async function getPleaseDayAvatarDownloadCount() {
  const response = await fetch(apiUrl('/api/please-day/avatar-downloads'))
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `加载次数失败 (${response.status})`)
  return data
}

export async function getCurrentAccount() {
  const response = await fetch(apiUrl('/api/auth/me'), {
    headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `登录状态无效 (${response.status})`)
  return data
}

export const generateImage = (payload) => post('/api/image', payload)
export async function generateText(payload) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await post('/api/text', payload) } catch (error) {
      lastError = error
      if (![502, 503, 504].includes(error.status) || attempt === 2) throw error
      await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)))
    }
  }
  throw lastError
}
export const uploadGoogleDriveImage = (payload) => post('/api/google-drive/uploads', payload)
export async function reconnectGoogleDrive() {
  const { url } = await post('/api/google-drive/reconnect', {})
  if (!url) throw new Error('无法打开 Google Drive 授权页面')
  window.location.assign(url)
}
export const uploadVideoReference = (payload) => post('/api/video/references', payload)
export const createVideoTask = (payload) => post('/api/video/tasks', payload)

export async function getVideoTask(id) {
  const response = await fetch(apiUrl(`/api/video/tasks/${encodeURIComponent(id)}`), { headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {} })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `加载视频任务失败 (${response.status})`)
  return data
}
export const createWaterfallTask = async (payload) => {
  const data = await post('/api/waterfall/tasks', payload)
  return { ...data, task: hydrateWaterfallTask(data.task) }
}

export async function listWaterfallTasks(offset = 0, limit = 12) {
  const response = await fetch(apiUrl(`/api/waterfall/tasks?offset=${offset}&limit=${limit}`), { cache: 'no-store', headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {} })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `加载任务失败 (${response.status})`)
  return { ...data, tasks: (data.tasks || []).map(hydrateWaterfallTask) }
}

export async function cancelWaterfallTask(id) {
  const response = await fetch(apiUrl(`/api/waterfall/tasks/${encodeURIComponent(id)}`), { method: 'DELETE', headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {} })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `停止任务失败 (${response.status})`)
  return { ...data, task: hydrateWaterfallTask(data.task) }
}

export async function fetchBatchImage(sourceUrl, { signal } = {}) {
  const path = `/api/batch-image?url=${encodeURIComponent(sourceUrl)}`
  // Cloudflare Pages forwards same-origin /api requests through public/_worker.js.
  // Keeping batch downloads on the page origin avoids browser CORS failures on deploy previews.
  const usePageProxy = typeof window !== 'undefined' && window.location.hostname.endsWith('.pages.dev')
  const response = await fetch(usePageProxy ? path : apiUrl(path), {
    headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
    signal,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `图片下载失败 (${response.status})`)
  }
  return response.blob()
}

export async function fetchBatchSpreadsheet(sourceUrl, { signal } = {}) {
  const path = `/api/batch-spreadsheet?url=${encodeURIComponent(sourceUrl)}`
  // Keep this on the same origin for Pages previews, just like QR image downloads.
  const usePageProxy = typeof window !== 'undefined' && window.location.hostname.endsWith('.pages.dev')
  const response = await fetch(usePageProxy ? path : apiUrl(path), {
    headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `在线表格读取失败 (${response.status})`)
  return data
}

function imageExtension(contentType) {
  if (contentType.includes('jpeg')) return 'jpg'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('svg')) return 'svg'
  return 'png'
}

function downloadImageBlob(sourceUrl) {
  const value = String(sourceUrl || '')
  const resolvedUrl = value.startsWith('/') ? apiUrl(value) : value
  return fetch(resolvedUrl, { headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {} }).then(async (response) => {
    if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`)
    if (!String(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) throw new Error('链接返回的不是图片')
    return response.blob()
  }).catch(async (directError) => {
    try { return await fetchBatchImage(resolvedUrl) } catch { throw directError }
  })
}

function triggerImageDownload(blob, baseName) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `${baseName}.${imageExtension(blob.type || '')}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
}

async function actualImageResolution(blob) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = objectUrl })
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('无法读取图片尺寸')
    return `${image.naturalWidth}x${image.naturalHeight}`
  } finally { URL.revokeObjectURL(objectUrl) }
}

function promptFilePrefix(prompt) {
  const text = Array.from(String(prompt || '').replace(/\s+/g, '').trim()).slice(0, 5).join('')
  return (text || '蝶发生成图片').replace(/[\\/:*?"<>|]/g, '_')
}

export async function downloadImageFile(sourceUrl, baseName = '蝶发生成图片') {
  triggerImageDownload(await downloadImageBlob(sourceUrl), baseName)
}

export async function downloadGeneratedImage(sourceUrl, prompt) {
  const blob = await downloadImageBlob(sourceUrl)
  let resolution = '未知尺寸'
  try { resolution = await actualImageResolution(blob) } catch { /* Keep the download available even if its metadata cannot be decoded. */ }
  triggerImageDownload(blob, `${promptFilePrefix(prompt)}_${resolution}`)
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}
