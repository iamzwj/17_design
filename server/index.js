import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { installAuth } from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const execFileAsync = promisify(execFile)

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnv(path.join(rootDir, '.env'))
loadEnv(path.join(rootDir, '.env.local'))

const app = express()
const port = Number(process.env.PORT || 8787)
const apiBase = (process.env.GRSAI_BASE_URL || 'https://grsaiapi.com').replace(/\/$/, '')
const vipImageSizes = {
  '1:1': '1024x1024',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '5:4': '1120x896',
  '4:5': '896x1120',
  '21:9': '1456x624',
  '9:21': '624x1456',
}
const supportedImageRatios = new Set(Object.keys(vipImageSizes))

function resolvePromptAspectRatio(prompt) {
  const match = String(prompt || '').match(/(\d{1,2})\s*[:：比x×]\s*(\d{1,2})/i)
  if (!match) return '1:1'
  const ratio = `${Number(match[1])}:${Number(match[2])}`
  return supportedImageRatios.has(ratio) ? ratio : '1:1'
}

function imageDimensionsFromDataUrl(source) {
  const match = String(source || '').match(/^data:image\/[\w.+-]+;base64,([\s\S]+)$/)
  if (!match) return null
  const bytes = Buffer.from(match[1], 'base64')
  const read16 = (offset) => (bytes[offset] << 8) | bytes[offset + 1]
  const read24 = (offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
  const read32 = (offset) => bytes.readUInt32BE(offset)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { width: read32(16), height: read32(20) }
  if (bytes.length >= 30 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]
      offset += 2
      if (marker === 0xd8 || marker === 0xd9) continue
      const length = read16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: read16(offset + 5), height: read16(offset + 3) }
      offset += length
    }
  }
  if (bytes.length >= 30 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    const type = bytes.subarray(12, 16).toString()
    if (type === 'VP8X') return { width: read24(24) + 1, height: read24(27) + 1 }
    if (type === 'VP8L' && bytes[20] === 0x2f) return { width: 1 + ((bytes[21] | (bytes[22] << 8)) & 0x3fff), height: 1 + (((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)) & 0x3fff) }
    if (type === 'VP8 ') return { width: read16(26) & 0x3fff, height: read16(28) & 0x3fff }
  }
  return null
}

function automaticImageRatio(source, prompt) {
  const dimensions = imageDimensionsFromDataUrl(source)
  if (!dimensions?.width || !dimensions?.height) return resolvePromptAspectRatio(prompt)
  const target = dimensions.width / dimensions.height
  return [...supportedImageRatios].reduce((nearest, ratio) => Math.abs(Math.log((Number(ratio.split(':')[0]) / Number(ratio.split(':')[1])) / target)) < Math.abs(Math.log((Number(nearest.split(':')[0]) / Number(nearest.split(':')[1])) / target)) ? ratio : nearest, '1:1')
}
const waterfallDataDir = process.env.DIEFA_DATA_DIR || path.join(rootDir, 'data')
const waterfallAssetsDir = path.join(waterfallDataDir, 'waterfall-assets')
const videoAssetsDir = path.join(waterfallDataDir, 'video-assets')
const waterfallStoreFile = path.join(waterfallDataDir, 'waterfall-tasks.json')
const waterfallControllers = new Map()
const videoTasks = new Map()
const FAILED_TASK_TTL = 10 * 60 * 1000
const MAX_BATCH_IMAGE_BYTES = 12 * 1024 * 1024

function isPrivateAddress(address) {
  if (!isIP(address)) return true
  if (address.includes(':')) {
    const normalized = address.toLowerCase()
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.')
  }
  const parts = address.split('.').map(Number)
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224
}

async function safeRemoteUrl(value) {
  let url
  try { url = new URL(String(value || '')) } catch { throw Object.assign(new Error('二维码链接格式不正确'), { status: 400 }) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error('仅支持公开的 HTTP/HTTPS 图片链接'), { status: 400 })
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw Object.assign(new Error('不允许访问内网图片地址'), { status: 400 })
  return url
}

async function downloadPublicImage(value) {
  let url = await safeRemoteUrl(value)
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(25_000), headers: { 'user-agent': 'Xiaodie-Batch-Composer/1.0' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw Object.assign(new Error('图片地址重定向无效'), { status: 502 })
      url = await safeRemoteUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw Object.assign(new Error(`图片下载失败（HTTP ${response.status}）`), { status: 502 })
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('image/')) throw Object.assign(new Error('链接返回的不是图片'), { status: 415 })
    const declaredSize = Number(response.headers.get('content-length'))
    if (declaredSize > MAX_BATCH_IMAGE_BYTES) throw Object.assign(new Error('二维码图片超过 12MB'), { status: 413 })
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_BATCH_IMAGE_BYTES) throw Object.assign(new Error('二维码图片超过 12MB'), { status: 413 })
    return { buffer, contentType }
  }
  throw Object.assign(new Error('图片地址重定向次数过多'), { status: 502 })
}

const TENCENT_DOCS_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const MAX_ONLINE_SHEET_ROWS = 5_000
const MAX_ONLINE_SHEET_BYTES = 20 * 1024 * 1024

function publicTencentSmartSheetUrl(value) {
  let url
  try { url = new URL(String(value || '')) } catch { throw Object.assign(new Error('请输入有效的腾讯文档链接'), { status: 400 }) }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'docs.qq.com' || !/^\/smartsheet\/[^/]+/i.test(url.pathname)) throw Object.assign(new Error('目前仅支持公开的腾讯文档“智能表格”链接'), { status: 400 })
  return url
}

function responseCookies(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || '']
  return setCookies.map((item) => item.split(';')[0]).filter(Boolean).join('; ')
}

function onlineSheetCellValue(cell) {
  if (!cell || typeof cell !== 'object') return ''
  const text = Array.isArray(cell.k1) ? cell.k1.map((item) => item?.k2 ?? item?.k3 ?? '').join('') : ''
  if (text) return text
  const image = Array.isArray(cell.k5) ? cell.k5.find((item) => item?.k3)?.k3 : ''
  if (image) return image
  const link = Array.isArray(cell.k8) ? cell.k8.find((item) => item?.k3)?.k3 || cell.k8.find((item) => item?.k2)?.k2 : ''
  if (link) return link
  return cell.k2 ?? cell.k3 ?? ''
}

function tencentSheetRows(documentData) {
  const compressed = documentData?.clientVars?.collab_client_vars?.initialAttributedText?.text?.find((item) => item?.smartsheet)?.smartsheet
  if (!compressed) throw Object.assign(new Error('未找到可读取的表格数据，请确认链接已公开'), { status: 422 })
  const [model, recordsChunk] = JSON.parse(inflateSync(Buffer.from(compressed, 'base64')).toString('utf8'))?.[0] || []
  const sheet = model?.c?.k3
  const fields = sheet?.k3 || {}
  const orderedIds = sheet?.k4?.[0]?.k1?.k1 || []
  const records = recordsChunk?.c?.k2?.k1 || {}
  if (!Object.keys(fields).length || !orderedIds.length) throw Object.assign(new Error('在线表格数据格式暂不支持'), { status: 422 })
  if (orderedIds.length > MAX_ONLINE_SHEET_ROWS) throw Object.assign(new Error(`在线表格共有 ${orderedIds.length.toLocaleString()} 条，单次最多支持 ${MAX_ONLINE_SHEET_ROWS.toLocaleString()} 条`), { status: 413 })
  const columns = Object.entries(fields).map(([id, field]) => ({ id, name: String(field?.k30 || id) }))
  const rows = orderedIds.map((recordId) => {
    const cells = records[recordId]?.k1 || {}
    return Object.fromEntries(columns.map(({ id, name }) => [name, onlineSheetCellValue(cells[id])]))
  })
  return { columns: columns.map(({ name }) => name), rows }
}

async function readTencentSmartSheet(value) {
  const source = publicTencentSmartSheetUrl(value)
  const documentResponse = await fetch(source, { signal: AbortSignal.timeout(25_000), headers: { 'user-agent': TENCENT_DOCS_USER_AGENT, accept: 'text/html,application/xhtml+xml' } })
  if (!documentResponse.ok) throw Object.assign(new Error(`在线表格打开失败（HTTP ${documentResponse.status}）`), { status: 502 })
  const html = await documentResponse.text()
  const documentId = source.pathname.split('/').filter(Boolean).pop()
  const tab = source.searchParams.get('tab') || html.match(/\/dop-api\/opendoc\?tab=([^&"']+)/)?.[1] || ''
  if (!documentId || !tab) throw Object.assign(new Error('未识别到腾讯智能表格，请检查链接是否完整'), { status: 422 })
  const endpoint = new URL('/dop-api/opendoc', source.origin)
  endpoint.search = new URLSearchParams({ tab, u: '', noEscape: '1', enableSmartsheetSplit: '1', supportOptimizedVer: '4', chunkCellSize: '15000', enableChunkRank: '1', startrow: '0', endrow: String(MAX_ONLINE_SHEET_ROWS), id: documentId, normal: '1', outformat: '1', wb: '1', nowb: '0', callback: 'clientVarsCallback', xsrf: '' }).toString()
  const dataResponse = await fetch(endpoint, { signal: AbortSignal.timeout(35_000), headers: { 'user-agent': TENCENT_DOCS_USER_AGENT, referer: source.toString(), cookie: responseCookies(documentResponse), accept: '*/*' } })
  if (!dataResponse.ok) throw Object.assign(new Error(dataResponse.status === 401 ? '腾讯文档拒绝读取，请将链接设为“获得链接的人可查看”后重试' : `在线表格读取失败（HTTP ${dataResponse.status}）`), { status: 502 })
  const size = Number(dataResponse.headers.get('content-length'))
  if (size > MAX_ONLINE_SHEET_BYTES) throw Object.assign(new Error('在线表格数据过大，请拆分后再导入'), { status: 413 })
  const script = await dataResponse.text()
  if (script.length > MAX_ONLINE_SHEET_BYTES) throw Object.assign(new Error('在线表格数据过大，请拆分后再导入'), { status: 413 })
  const callbackMatch = script.match(/^\s*clientVarsCallback\(([\s\S]+)\)\s*;?\s*$/)
  if (!callbackMatch) throw Object.assign(new Error('腾讯文档未返回可读取的数据，请确认链接公开且没有访问限制'), { status: 422 })
  let documentData
  try { documentData = JSON.parse(callbackMatch[1]) } catch { throw Object.assign(new Error('在线表格数据解析失败'), { status: 422 }) }
  const title = html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1] || '腾讯文档智能表格'
  return { ...tencentSheetRows(documentData), title }
}

fs.mkdirSync(waterfallAssetsDir, { recursive: true })
fs.mkdirSync(videoAssetsDir, { recursive: true })

function loadWaterfallTasks() {
  try {
    const tasks = JSON.parse(fs.readFileSync(waterfallStoreFile, 'utf8'))
    if (!Array.isArray(tasks)) return []
    return tasks.map((task) => {
      const normalizedTask = { ...task, refundedCount: Math.min(task.refundedCount || 0, task.count || task.slots?.length || 0) }
      if (task.status !== 'running') return normalizedTask
      const interruptedCount = task.slots.filter((slot) => slot.status === 'running').length
      return {
        ...normalizedTask,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: '应用重启，任务已中断',
        refundedCount: (task.refundedCount || 0) + interruptedCount,
        recoveryRefundCount: interruptedCount,
        slots: task.slots.map((slot) => slot.status === 'running' ? { ...slot, status: 'failed', error: '应用重启，任务已中断' } : slot),
      }
    })
  } catch { return [] }
}

let waterfallTasks = loadWaterfallTasks()

function saveWaterfallTasks() {
  fs.writeFileSync(waterfallStoreFile, JSON.stringify(waterfallTasks.slice(0, 300), null, 2))
}

function isExpiredFailedTask(task, now = Date.now()) {
  if (!['failed', 'timeout', 'cancelled'].includes(task.status)) return false
  const completedAt = new Date(task.completedAt || task.updatedAt || task.createdAt).getTime()
  return Number.isFinite(completedAt) && completedAt <= now - FAILED_TASK_TTL
}

function removeWaterfallAsset(url) {
  if (!String(url || '').startsWith('/api/waterfall/assets/')) return
  const fileName = path.basename(url)
  if (!fileName || fileName !== path.basename(fileName)) return
  fs.rmSync(path.join(waterfallAssetsDir, fileName), { force: true })
}

function cleanupExpiredFailedTasks() {
  const expired = waterfallTasks.filter((task) => isExpiredFailedTask(task))
  if (!expired.length) return
  for (const task of expired) {
    for (const source of task.referenceImages || []) removeWaterfallAsset(source)
    for (const slot of task.slots || []) removeWaterfallAsset(slot.url)
  }
  waterfallTasks = waterfallTasks.filter((task) => !isExpiredFailedTask(task))
  saveWaterfallTasks()
}

saveWaterfallTasks()
cleanupExpiredFailedTasks()
setInterval(cleanupExpiredFailedTasks, 60_000).unref()

app.use(express.json({ limit: '50mb' }))
const { requireAuth, spendCredits, refundCredits } = installAuth(app, { dataDir: waterfallDataDir })

async function refundWaterfallCredits(taskId, amount) {
  if (!amount) return null
  const task = waterfallTasks.find((item) => item.id === taskId)
  const remaining = Math.max(0, Number(task?.chargedCredits || 0) - Number(task?.refundedCredits || 0))
  const refundable = Math.min(amount, remaining)
  if (!refundable) return null
  const updated = updateWaterfallTask(taskId, (current) => ({ ...current, refundedCredits: (current.refundedCredits || 0) + refundable }))
  return updated?.userId ? refundCredits(updated.userId, refundable) : null
}

for (const task of waterfallTasks.filter((item) => item.recoveryRefundCount)) {
  void refundWaterfallCredits(task.id, task.recoveryRefundCount).finally(() => {
    updateWaterfallTask(task.id, (current) => ({ ...current, recoveryRefundCount: 0 }))
  })
}

function getApiKey() {
  const key = process.env.GRSAI_API_KEY
  if (!key) {
    const error = new Error('服务端尚未配置 GRSAI_API_KEY')
    error.status = 500
    throw error
  }
  return key
}

function getVibbitApiKey() {
  const key = process.env.VIBBIT_OPENAPI_KEY
  if (!key) {
    const error = new Error('服务端尚未配置 VIBBIT_OPENAPI_KEY')
    error.status = 500
    throw error
  }
  return key
}

const vibbitApiBase = (process.env.VIBBIT_OPENAPI_BASE_URL || 'https://openapi.vibbit.cn/openapi/v1').replace(/\/$/, '')
const seedanceModels = new Map([
  ['doubao-seedance-2-0-260128', { resolutions: ['480p', '720p', '1080p', '4k'], maxDuration: 15 }],
  ['doubao-seedance-2-5-260628', { resolutions: ['480p', '720p', '1080p'], maxDuration: 30 }],
])
const seedanceAspectRatios = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])

async function vibbitRequest(pathname, options = {}) {
  const response = await fetch(`${vibbitApiBase}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${getVibbitApiKey()}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    signal: AbortSignal.timeout(50_000),
  })
  const raw = await response.text()
  let data
  try { data = JSON.parse(raw) } catch { data = { message: raw } }
  if (!response.ok || data?.code !== 200) {
    const error = new Error(data?.message || `Seedance 接口返回 HTTP ${response.status}`)
    error.status = response.status >= 400 ? response.status : 502
    throw error
  }
  return data.data || {}
}

function publicVideoAssetUrl(assetPath) {
  const publicBase = String(process.env.VIBBIT_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '')
  if (!publicBase) {
    const error = new Error('上传参考图需要配置 VIBBIT_PUBLIC_BASE_URL（可被公网访问的本站地址）')
    error.status = 503
    throw error
  }
  return `${publicBase}${assetPath}`
}

async function persistVideoReference(source) {
  const value = String(source || '')
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/)
  let mimeType
  let buffer
  if (match) {
    mimeType = match[1].toLowerCase()
    buffer = Buffer.from(match[2], 'base64')
  } else {
    let sourceUrl
    try { sourceUrl = new URL(value) } catch { throw Object.assign(new Error('参考图格式无效'), { status: 400 }) }
    if (sourceUrl.protocol !== 'https:') throw Object.assign(new Error('参考图地址必须使用 HTTPS'), { status: 400 })
    const response = await fetch(sourceUrl, { redirect: 'follow' })
    if (!response.ok) throw Object.assign(new Error('参考图下载失败'), { status: 400 })
    mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    buffer = Buffer.from(await response.arrayBuffer())
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw Object.assign(new Error('参考图仅支持 JPG、PNG 或 WebP'), { status: 400 })
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw Object.assign(new Error('参考图必须小于 30MB'), { status: 413 })
  const extension = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png'
  const fileName = `${randomUUID()}.${extension}`
  fs.writeFileSync(path.join(videoAssetsDir, fileName), buffer)
  return `/api/video/assets/${fileName}`
}

async function requestUpstream(endpoint, body, signal) {
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
  })

  const raw = await response.text()
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    data = { error: raw || `上游服务返回 HTTP ${response.status}` }
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || `上游服务返回 HTTP ${response.status}`
    const error = new Error(typeof message === 'string' ? message : JSON.stringify(message))
    error.status = response.status
    throw error
  }
  return data
}

async function requestUpstreamResult(id, signal) {
  const response = await fetch(`${apiBase}/v1/api/result?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  })
  const raw = await response.text()
  let data
  try { data = JSON.parse(raw) } catch { data = { error: raw || `上游服务返回 HTTP ${response.status}` } }
  if (!response.ok) throw new Error(data?.error?.message || data?.error || data?.message || `上游服务返回 HTTP ${response.status}`)
  return data
}

function waitForPoll(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('任务已停止', 'AbortError'))
    }, { once: true })
  })
}

function updateWaterfallTask(id, transform) {
  waterfallTasks = waterfallTasks.map((task) => task.id === id ? { ...transform(task), updatedAt: new Date().toISOString() } : task)
  saveWaterfallTasks()
  return waterfallTasks.find((task) => task.id === id)
}

async function persistWaterfallImage(sourceUrl, taskId, slotIndex) {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`保存生成图片失败（HTTP ${response.status}）`)
  const contentType = response.headers.get('content-type') || 'image/png'
  const extension = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png'
  const fileName = `${taskId}-${slotIndex}.${extension}`
  await fs.promises.writeFile(path.join(waterfallAssetsDir, fileName), Buffer.from(await response.arrayBuffer()))
  return `/api/waterfall/assets/${fileName}`
}

function imageExtension(mimeType) {
  if (mimeType.includes('jpeg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'png'
}

function imageMimeFromFileName(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  return 'image/png'
}

async function persistWaterfallReference(source, taskId, index) {
  if (source.startsWith('/api/waterfall/assets/')) return source
  const { mimeType, buffer } = await imageSourceToData(source)
  const fileName = `${taskId}-reference-${index}.${imageExtension(mimeType)}`
  await fs.promises.writeFile(path.join(waterfallAssetsDir, fileName), buffer)
  return `/api/waterfall/assets/${fileName}`
}

async function waterfallReferenceForUpstream(source) {
  if (!source.startsWith('/api/waterfall/assets/')) return source
  const fileName = path.basename(new URL(source, 'http://localhost').pathname)
  const filePath = path.join(waterfallAssetsDir, fileName)
  const buffer = await fs.promises.readFile(filePath)
  return `data:${imageMimeFromFileName(fileName)};base64,${buffer.toString('base64')}`
}

function finishWaterfallTaskIfReady(taskId) {
  const task = waterfallTasks.find((item) => item.id === taskId)
  if (!task || task.status !== 'running' || task.slots.some((slot) => slot.status === 'running')) return
  const succeeded = task.slots.filter((slot) => slot.status === 'succeeded').length
  updateWaterfallTask(taskId, (current) => ({
    ...current,
    status: succeeded === current.slots.length ? 'succeeded' : succeeded > 0 ? 'partial' : 'failed',
    completedAt: new Date().toISOString(),
  }))
  waterfallControllers.delete(taskId)
}

async function runWaterfallSlot(taskId, slotIndex, config) {
  const controller = new AbortController()
  const controllers = waterfallControllers.get(taskId) || new Set()
  controllers.add(controller)
  waterfallControllers.set(taskId, controllers)
  try {
    let result = await requestUpstream('/v1/api/generate', {
      model: 'gpt-image-2',
      prompt: config.prompt.slice(0, 30_000),
      images: config.images,
      aspectRatio: config.aspectRatio,
      replyType: 'async',
    }, controller.signal)
    if (!result?.id) throw new Error(result?.error || '上游未返回任务编号')
    updateWaterfallTask(taskId, (task) => ({ ...task, slots: task.slots.map((slot, index) => index === slotIndex ? { ...slot, upstreamId: result.id } : slot) }))

    const pendingStatuses = new Set(['running', 'pending', 'queued', 'processing'])
    while (!result.status || pendingStatuses.has(result.status)) {
      await waitForPoll(5_000, controller.signal)
      result = await requestUpstreamResult(result.id, controller.signal)
    }
    const sourceUrl = result?.results?.[0]?.url
    if (result.status !== 'succeeded' || !sourceUrl) throw new Error(result?.error || `生成失败（${result.status || 'unknown'}）`)
    const localUrl = await persistWaterfallImage(sourceUrl, taskId, slotIndex)
    updateWaterfallTask(taskId, (task) => ({ ...task, slots: task.slots.map((slot, index) => index === slotIndex ? { ...slot, status: 'succeeded', url: localUrl, completedAt: new Date().toISOString() } : slot) }))
  } catch (error) {
    const task = waterfallTasks.find((item) => item.id === taskId)
    const status = task?.status === 'cancelled' ? 'cancelled' : task?.status === 'timeout' ? 'timeout' : 'failed'
    const shouldRefund = task?.slots[slotIndex]?.status === 'running'
    updateWaterfallTask(taskId, (current) => ({
      ...current,
      refundedCount: (current.refundedCount || 0) + (current.slots[slotIndex]?.status === 'running' ? 1 : 0),
      slots: current.slots.map((slot, index) => index === slotIndex && slot.status === 'running' ? { ...slot, status, error: status === 'cancelled' ? '已停止' : status === 'timeout' ? '生成超时' : (error?.message || '生成失败') } : slot),
    }))
    if (shouldRefund) await refundWaterfallCredits(taskId, 1)
  } finally {
    controllers.delete(controller)
    finishWaterfallTaskIfReady(taskId)
  }
}

async function stopWaterfallTask(taskId, status = 'cancelled') {
  const task = waterfallTasks.find((item) => item.id === taskId)
  if (!task || task.status !== 'running') return task
  const unfinishedCount = task.slots.filter((slot) => slot.status === 'running').length
  updateWaterfallTask(taskId, (current) => {
    return {
      ...current,
      status,
      completedAt: new Date().toISOString(),
      refundedCount: (current.refundedCount || 0) + unfinishedCount,
      slots: current.slots.map((slot) => slot.status === 'running' ? {
        ...slot,
        status,
        error: status === 'timeout' ? '生成超过 10 分钟，已自动结束' : '任务已停止',
      } : slot),
    }
  })
  for (const controller of waterfallControllers.get(taskId) || []) controller.abort()
  await refundWaterfallCredits(taskId, unfinishedCount)
  return waterfallTasks.find((item) => item.id === taskId)
}

async function runWaterfallTask(task, images) {
  const timeout = setTimeout(() => { void stopWaterfallTask(task.id, 'timeout') }, 10 * 60 * 1000)
  try {
    const upstreamImages = await Promise.all(images.map(waterfallReferenceForUpstream))
    const config = { prompt: task.prompt, images: upstreamImages, aspectRatio: task.generationSize || task.aspectRatio }
    await Promise.allSettled(task.slots.map((_, index) => runWaterfallSlot(task.id, index, config)))
  } catch (error) {
    const runningCount = waterfallTasks.find((item) => item.id === task.id)?.slots.filter((slot) => slot.status === 'running').length || 0
    updateWaterfallTask(task.id, (current) => ({
      ...current,
      status: 'failed',
      completedAt: new Date().toISOString(),
      refundedCount: current.slots.length,
      slots: current.slots.map((slot) => ({ ...slot, status: 'failed', error: error?.message || '读取参考图失败' })),
    }))
    await refundWaterfallCredits(task.id, runningCount)
  } finally { clearTimeout(timeout) }
}

function ocrExecutablePath() {
  const bundledPath = process.resourcesPath && path.join(process.resourcesPath, 'native-bin', 'macos-vision-ocr')
  if (bundledPath && fs.existsSync(bundledPath)) return bundledPath
  return path.join(rootDir, 'native', 'bin', 'macos-vision-ocr')
}

async function imageSourceToData(source) {
  if (source.startsWith('data:image/')) {
    const match = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
    if (!match) throw new Error('图片数据格式无效')
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') }
  }
  if (!/^https?:\/\//.test(source)) throw new Error('不支持的图片地址')
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > 10 * 1024 * 1024) throw new Error('图片超过 10MB，无法识别')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > 10 * 1024 * 1024) throw new Error('图片超过 10MB，无法识别')
  return { mimeType: response.headers.get('content-type')?.split(';')[0] || 'image/png', buffer }
}

async function imageSourceToBuffer(source) {
  return (await imageSourceToData(source)).buffer
}

async function analyzeImageLayout(sources) {
  const images = await Promise.all(sources.map(imageSourceToData))
  const parts = [{ text: `你是品牌物料的视觉检查器。逐张查看图片本身，只输出可直接观察到的事实，不做最终合规结论。

必须检查并清楚描述：
1. 图片内所有可辨认文字，尤其是品牌英文名、中文名、Logo 文案、数字和单位；
2. Logo 的位置、完整性、清晰度，是否被标题、图片或其他元素遮挡/压住/裁切，是否缺少关键字母或部件；
3. Logo 是否旋转、镜像、压扁、拉长、透视变形、改色、描边或使用错误版本；
4. 核心标题、电话号码等是否被裁断或互相覆盖；
5. 对遮挡关系写明“哪个元素遮挡了哪个元素”，不要只转录文字。

如果 Logo 虽然还能辨认但有任何部分被其他文字覆盖，也必须明确报告。不要因为能读出文字就忽略遮挡。` }]
  images.forEach((image, index) => {
    parts.push({ text: `图片 ${index + 1}：` })
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.buffer.toString('base64') } })
  })

  const response = await fetch(`${apiBase}/v1beta/models/gemini-3.1-pro:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getApiKey()}` },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(180_000),
  })
  const raw = await response.text()
  let data
  try { data = JSON.parse(raw) } catch { data = { error: raw } }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || `视觉服务返回 HTTP ${response.status}`
    throw new Error(`图片视觉审核失败：${typeof message === 'string' ? message : JSON.stringify(message)}`)
  }
  const analysis = (data?.candidates?.[0]?.content?.parts || []).map((part) => part?.text).filter(Boolean).join('\n').trim()
  if (!analysis) throw new Error('图片视觉审核失败：视觉模型未返回有效结果')
  return analysis
}

async function recognizeImageText(source, index) {
  const executable = ocrExecutablePath()
  if (!fs.existsSync(executable)) throw new Error('本机图片识别组件缺失，请重新安装最新版应用')
  const temporaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'diefa-ocr-'))
  const imagePath = path.join(temporaryDir, `image-${index}.bin`)
  try {
    await fs.promises.writeFile(imagePath, await imageSourceToBuffer(source))
    const { stdout } = await execFileAsync(executable, [imagePath], {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    return stdout.trim()
  } finally {
    await fs.promises.rm(temporaryDir, { recursive: true, force: true })
  }
}

async function normalizeTextMessage({ role, content }) {
  if (typeof content === 'string') return { role, content: content.slice(0, 60_000) }
  if (role !== 'user' || !Array.isArray(content)) return null

  const textParts = content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
  const imageSources = content
    .filter((part) => part?.type === 'image_url' && typeof part?.image_url?.url === 'string')
    .map((part) => part.image_url.url)
    .slice(0, 4)

  const [visionAnalysis, recognizedImages] = await Promise.all([
    imageSources.length ? analyzeImageLayout(imageSources) : Promise.resolve(''),
    Promise.all(imageSources.map(async (source, index) => {
    const recognizedText = await recognizeImageText(source, index + 1)
    return `\n\n--- 图片 ${index + 1} 本机识别到的可见文字 ---\n${recognizedText || '未识别到清晰文字。请在结论中说明图片文字不可辨认，不要称用户未上传图片。'}`
    })),
  ])

  const visualEvidence = visionAnalysis ? `\n\n--- 视觉模型对图片结构的客观观察 ---\n${visionAnalysis}\n\n请以视觉观察判断 Logo 遮挡、变形、裁切与排版覆盖，以本机 OCR 仅校对文字。` : ''
  const combined = [...textParts, visualEvidence, ...recognizedImages].join('').slice(0, 60_000)
  return combined ? { role, content: combined } : null
}

function searchQueryFromMessages(messages, requestedQuery) {
  if (typeof requestedQuery === 'string' && requestedQuery.trim()) return requestedQuery.trim().slice(0, 600)
  const lastUserMessage = [...messages].reverse().find((message) => message?.role === 'user')
  if (typeof lastUserMessage?.content === 'string') return lastUserMessage.content.trim().slice(0, 600)
  if (Array.isArray(lastUserMessage?.content)) {
    return lastUserMessage.content.find((part) => part?.type === 'text' && typeof part.text === 'string')?.text?.trim().slice(0, 600) || ''
  }
  return ''
}

async function searchWeb(query) {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    const error = new Error('联网搜索尚未配置 TAVILY_API_KEY，请在服务端添加 Tavily 密钥后重试')
    error.status = 503
    throw error
  }
  if (!query) {
    const error = new Error('未找到可用于联网搜索的问题')
    error.status = 400
    throw error
  }
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false, include_raw_content: false }),
    signal: AbortSignal.timeout(20_000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data?.detail || data?.error || `联网搜索服务错误 (${response.status})`)
    error.status = response.status === 401 || response.status === 403 ? 503 : response.status
    throw error
  }
  const seen = new Set()
  return (data.results || []).filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url)).slice(0, 5).map((item) => ({
    title: String(item.title || item.url).slice(0, 200),
    url: item.url,
    content: String(item.content || '').slice(0, 1_200),
  }))
}

function webSourcesPrompt(sources) {
  if (!sources.length) return '已执行联网检索，但没有找到足够可靠的结果。请明确说“联网检索未找到可靠结果”，不要说自己没有联网搜索工具，也不要编造实时信息。'
  return `已完成联网检索。以下是本次检索到的实时资料，必须优先基于这些资料作答；不要声称自己无法联网搜索或没有实时搜索工具。若资料之间有差异，请说明差异。不要捏造来源中没有的信息。不要输出 URL、来源编号或 Markdown 符号（例如 **、#、-）。使用可直接复制的简洁中文自然段；如有多个要点，以“要点名：内容”的短句呈现。\n\n${sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.content}`).join('\n\n')}`
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, apiConfigured: Boolean(process.env.GRSAI_API_KEY), baseUrl: apiBase })
})

app.get('/api/batch-image', async (req, res, next) => {
  try {
    const image = await downloadPublicImage(req.query.url)
    res.set({ 'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=300', 'Content-Length': String(image.buffer.length) })
    res.send(image.buffer)
  } catch (error) { next(error) }
})

app.get('/api/batch-spreadsheet', async (req, res, next) => {
  try {
    res.json(await readTencentSmartSheet(req.query.url))
  } catch (error) { next(error) }
})

app.post('/api/text', requireAuth, async (req, res, next) => {
  try {
    const { messages, systemPrompt, webSearch, searchQuery } = req.body
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages 不能为空' })
    }
    const safeMessages = (await Promise.all(messages
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .map(normalizeTextMessage)))
      .filter(Boolean)
    const sources = webSearch ? await searchWeb(searchQueryFromMessages(messages, searchQuery)) : []
    const combinedSystemPrompt = [systemPrompt, webSearch ? webSourcesPrompt(sources) : ''].filter(Boolean).join('\n\n')
    const data = await requestUpstream('/v1/chat/completions', {
      model: 'gpt-5.6-terra',
      stream: false,
      messages: [
        ...(combinedSystemPrompt ? [{ role: 'system', content: combinedSystemPrompt.slice(0, 18_000) }] : []),
        ...safeMessages,
      ],
    })
    const content = data?.choices?.[0]?.message?.content
    if (!content) throw new Error('接口未返回有效文本')
    res.json({ content, sources, usage: data.usage || null, model: data.model || 'gpt-5.6-terra' })
  } catch (error) {
    next(error)
  }
})

app.post('/api/image', requireAuth, async (req, res, next) => {
  let chargedUser = null
  try {
    const { prompt, images = [], aspectRatio = 'auto' } = req.body
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt 不能为空' })
    }
    if (!Array.isArray(images) || images.length > 4) {
      return res.status(400).json({ error: '参考图最多 4 张' })
    }
    chargedUser = spendCredits(req.user.id, 1)
    const resolvedAspectRatio = aspectRatio === 'auto' ? automaticImageRatio(images[0], prompt) : aspectRatio
    const vipAspectRatio = vipImageSizes[resolvedAspectRatio] || (/^\d+x\d+$/.test(resolvedAspectRatio) ? resolvedAspectRatio : vipImageSizes['1:1'])
    const data = await requestUpstream('/v1/api/generate', {
      model: 'gpt-image-2',
      prompt: prompt.slice(0, 30_000),
      images,
      aspectRatio: vipAspectRatio,
      replyType: 'json',
    })
    const urls = (data.results || []).map((item) => item?.url).filter(Boolean)
    if (data.status !== 'succeeded' || urls.length === 0) {
      throw new Error(data.error || `图片生成未成功，当前状态：${data.status || 'unknown'}`)
    }
    res.json({ id: data.id, status: data.status, aspectRatio: resolvedAspectRatio, urls, user: chargedUser })
  } catch (error) {
    if (chargedUser) refundCredits(req.user.id, 1)
    next(error)
  }
})

app.use('/api/video/assets', express.static(videoAssetsDir, { fallthrough: false }))

app.post('/api/video/references', requireAuth, async (req, res, next) => {
  try {
    const assetPath = await persistVideoReference(req.body?.source)
    res.status(201).json({ url: publicVideoAssetUrl(assetPath) })
  } catch (error) { next(error) }
})

app.post('/api/video/tasks', requireAuth, async (req, res, next) => {
  try {
    const { model, prompt, durationSeconds, resolution, aspectRatio, referenceMode, imageUrl, firstFrameImageUrl, lastFrameImageUrl, referenceImageUrls = [], omniReferenceTaskType } = req.body || {}
    const modelInfo = seedanceModels.get(model)
    if (!modelInfo) return res.status(400).json({ error: '仅支持 Seedance 2.0 和 Seedance 2.5' })
    if (!String(prompt || '').trim()) return res.status(400).json({ error: '视频提示词不能为空' })
    if (!modelInfo.resolutions.includes(resolution)) return res.status(400).json({ error: '该模型不支持所选分辨率' })
    if (!seedanceAspectRatios.has(aspectRatio)) return res.status(400).json({ error: '画幅参数不支持' })
    const taskInput = { model, prompt: String(prompt).trim().slice(0, 30_000), duration_seconds: Number(durationSeconds), resolution, aspect_ratio: aspectRatio }
    const is25 = model.includes('2-5')
    if (taskInput.duration_seconds !== -1 && (!Number.isInteger(taskInput.duration_seconds) || taskInput.duration_seconds < 4 || taskInput.duration_seconds > modelInfo.maxDuration)) return res.status(400).json({ error: `该模型时长应为 4–${modelInfo.maxDuration} 秒，或自动` })
    if (referenceMode === 'single' && imageUrl) taskInput.image_url = imageUrl
    if (referenceMode === 'frames') {
      if (!firstFrameImageUrl) return res.status(400).json({ error: '首帧模式至少需要一张参考图' })
      taskInput.first_frame_image_url = firstFrameImageUrl
      if (lastFrameImageUrl) taskInput.last_frame_image_url = lastFrameImageUrl
    }
    if (referenceMode === 'multi') {
      if (!is25 && referenceImageUrls.length > 9) return res.status(400).json({ error: 'Seedance 2.0 最多支持 9 张参考图' })
      if (is25 && referenceImageUrls.length > 30) return res.status(400).json({ error: 'Seedance 2.5 最多支持 30 张参考图' })
      if (referenceImageUrls.length) taskInput.reference_image_urls = referenceImageUrls
    }
    if (is25 && omniReferenceTaskType) {
      if (!['auto', 'reference', 'edit', 'extend'].includes(omniReferenceTaskType)) return res.status(400).json({ error: '2.5 任务类型不支持' })
      taskInput.omni_reference_task_type = omniReferenceTaskType
      if (omniReferenceTaskType === 'auto') {
        if (!taskInput.reference_image_urls?.length) return res.status(400).json({ error: 'auto 模式需要至少一张全模态参考图' })
        taskInput.duration_seconds = -1
        taskInput.aspect_ratio = 'adaptive'
      }
      if (['edit', 'extend'].includes(omniReferenceTaskType)) return res.status(400).json({ error: '当前工作台仅支持参考图片；2.5 的 edit / extend 还需要参考视频 URL' })
    }
    const created = await vibbitRequest('/tasks', { method: 'POST', body: JSON.stringify({ task_type: 'SEEDANCE_VIDEO_GENERATION', input_info: { input: JSON.stringify(taskInput) } }) })
    if (!created.task_id) throw new Error('Seedance 未返回任务 ID')
    videoTasks.set(created.task_id, { userId: req.user.id, createdAt: Date.now() })
    res.status(202).json({ taskId: created.task_id, status: 'PENDING' })
  } catch (error) { next(error) }
})

app.get('/api/video/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    const localTask = videoTasks.get(req.params.id)
    if (!localTask || localTask.userId !== req.user.id) return res.status(404).json({ error: '视频任务不存在或无权访问' })
    const task = await vibbitRequest(`/tasks/${encodeURIComponent(req.params.id)}`)
    let result = {}
    try { result = JSON.parse(task.task_result?.result || '{}') } catch { result = {} }
    const progressCandidates = [task.progress_percentage, task.progress_percent, task.progress, task.task_result?.progress_percentage, task.task_result?.progress_percent, task.task_result?.progress, result.progress_percentage, result.progress_percent, result.progress]
    const progress = progressCandidates.find((value) => Number.isInteger(value) && value >= 0 && value <= 100)
    if (['COMPLETED', 'FAILED'].includes(task.status)) videoTasks.delete(req.params.id)
    res.json({ taskId: task.task_id || req.params.id, status: task.status, videoUrl: result.video_url || '', error: result.error_message || '', progress: progress ?? null })
  } catch (error) { next(error) }
})

app.use('/api/waterfall/assets', express.static(waterfallAssetsDir, { fallthrough: false }))

app.get('/api/waterfall/tasks', requireAuth, (req, res) => {
  cleanupExpiredFailedTasks()
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 12))
  const ordered = [...waterfallTasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  res.json({ tasks: ordered.slice(offset, offset + limit), total: ordered.length, hasMore: offset + limit < ordered.length, user: req.user })
})

app.post('/api/waterfall/tasks', requireAuth, async (req, res, next) => {
  try {
    const { prompt, images = [], aspectRatio = 'auto', count = 2 } = req.body
    const requestedCount = Number(count)
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: '提示词不能为空' })
    if (!Array.isArray(images) || images.length > 9) return res.status(400).json({ error: '参考图最多 9 张' })
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 4) return res.status(400).json({ error: '生成数量必须为 1 至 4 张' })
    const resolvedAspectRatio = aspectRatio === 'auto' ? automaticImageRatio(images[0], prompt) : (vipImageSizes[aspectRatio] ? aspectRatio : '1:1')
    const vipAspectRatio = vipImageSizes[resolvedAspectRatio]
    const now = new Date().toISOString()
    const id = randomUUID()
    const referenceImages = await Promise.all(images.map((source, index) => persistWaterfallReference(source, id, index)))
    const chargedUser = spendCredits(req.user.id, requestedCount)
    const task = {
      id,
      userId: req.user.id,
      prompt: prompt.trim().slice(0, 30_000),
      aspectRatio,
      resolvedAspectRatio,
      generationSize: vipAspectRatio,
      count: requestedCount,
      referenceCount: images.length,
      referenceImages,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      chargedCredits: requestedCount,
      refundedCredits: 0,
      refundedCount: 0,
      slots: Array.from({ length: requestedCount }, (_, index) => ({ index, status: 'running', url: null, error: null, upstreamId: null })),
    }
    waterfallTasks = [task, ...waterfallTasks]
    saveWaterfallTasks()
    setImmediate(() => runWaterfallTask(task, referenceImages))
    res.status(202).json({ task, user: refundCredits(req.user.id, 0) || chargedUser })
  } catch (error) { next(error) }
})

app.delete('/api/waterfall/tasks/:id', requireAuth, async (req, res) => {
  const task = waterfallTasks.find((item) => item.id === req.params.id)
  if (!task) return res.status(404).json({ error: '任务不存在' })
  const stopped = await stopWaterfallTask(task.id)
  res.json({ task: stopped, user: stopped?.userId === req.user.id ? refundCredits(req.user.id, 0) || req.user : req.user })
})

const distDir = path.join(rootDir, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.use((error, _req, res, _next) => {
  const isTimeout = error?.name === 'TimeoutError'
  const status = Number(error?.status) || (isTimeout ? 504 : 500)
  res.status(status).json({ error: isTimeout ? '请求超时，请稍后重试' : error?.message || '服务暂时不可用' })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Die Fa AI server listening on http://localhost:${port}`)
})
