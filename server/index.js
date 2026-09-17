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
import sharp from 'sharp'
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
const standardImageSizes = {
  '1:1': '1024x1024',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '5:4': '1120x896',
  '4:5': '896x1120',
  '21:9': '1792x768',
  '9:21': '768x1792',
}
const vipImageSizes = {
  '1k': standardImageSizes,
  '2k': {
    '1:1': '2048x2048', '16:9': '2560x1440', '9:16': '1440x2560',
    '4:3': '2304x1728', '3:4': '1728x2304', '3:2': '2496x1664',
    '2:3': '1664x2496', '5:4': '2240x1792', '4:5': '1792x2240',
    '21:9': '2016x864', '9:21': '864x2016',
    '3:1': '3072x1024', '1:3': '1024x3072',
  },
  '4k': {
    '1:1': '2880x2880', '16:9': '3840x2160', '9:16': '2160x3840',
    '4:3': '3264x2448', '3:4': '2448x3264', '3:2': '3504x2336',
    '2:3': '2336x3504', '5:4': '3136x2509', '4:5': '2509x3136',
    '21:9': '3696x1584', '9:21': '1584x3696',
    '3:1': '3840x1280', '1:3': '1280x3840',
  },
}
const imageModels = new Set(['gpt-image-2', 'gpt-image-2-vip', 'gpt-image-2.5', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'])
const imageResolutions = new Set(['1k', '2k', '4k'])
const supportedImageRatios = new Set(Object.keys(standardImageSizes))
const DEFAULT_IMAGE_ASPECT_RATIO = '9:16'
const DEFAULT_IMAGE_QUALITY = 'high'
const imageQualities = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const extremeImageRatios = new Set(['1:3', '3:1'])

function supportsImageRatio(model, resolution, ratio) {
  if (!extremeImageRatios.has(ratio)) return supportedImageRatios.has(ratio)
  return ['gpt-image-2-vip', 'gpt-image-2.5-sunburst'].includes(upstreamImageModel(model)) && ['2k', '4k'].includes(String(resolution).toLowerCase())
}

function imagePromptWithCurrentDate(prompt) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const date = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `日期上下文（仅供理解“今天”、天气和近期活动等即时内容；除非用户明确要求，不要把这段说明或日期本身作为画面文字）：当前中国标准日期为 ${date.year}年${date.month}月${date.day}日。若用户未指定年份，不得使用过往年份或默认年份。\n\n${String(prompt || '').trim()}`
}

function upstreamImageModel(model) {
  return ['image-2.5', 'image-2.5-flare', 'image-2.5-sunburst'].includes(model) ? `gpt-${model}` : model
}

function imageModelSettings(model, resolution, quality) {
  const selectedModel = upstreamImageModel(String(model || 'gpt-image-2.5-sunburst'))
  if (!imageModels.has(selectedModel)) throw Object.assign(new Error('不支持的生图模型'), { status: 400 })
  const selectedQuality = String(quality || DEFAULT_IMAGE_QUALITY).toLowerCase()
  if (!imageQualities.has(selectedQuality)) throw Object.assign(new Error('出图质量仅支持 low、medium、high、xhigh 或 max'), { status: 400 })
  const supportsExtendedQuality = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(selectedModel)
  if (!supportsExtendedQuality && ['xhigh', 'max'].includes(selectedQuality)) throw Object.assign(new Error('此模型仅支持 low、medium 或 high 质量'), { status: 400 })
  if (!['gpt-image-2-vip', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(selectedModel)) return { model: selectedModel, resolution: '1k', quality: selectedQuality }
  const selectedResolution = String(resolution || '2k').toLowerCase()
  if (!imageResolutions.has(selectedResolution)) throw Object.assign(new Error('清晰度仅支持 1K、2K 或 4K'), { status: 400 })
  return { model: selectedModel, resolution: selectedResolution, quality: selectedQuality }
}

function imageCreditCost(model, count = 1) {
  const creditsPerImage = {
    'gpt-image-2-vip': 4,
    'gpt-image-2.5-flare': 4,
    'gpt-image-2.5-sunburst': 5,
  }[model] || 1
  return creditsPerImage * Math.max(1, Number(count) || 1)
}

function generationSize(model, resolution, ratio) {
  const sizes = ['gpt-image-2-vip', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(upstreamImageModel(model)) ? vipImageSizes[resolution] : standardImageSizes
  return sizes[ratio] || sizes['1:1']
}

function aspectRatioValue(ratio) {
  const [width, height] = String(ratio || '').split(':').map(Number)
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : null
}

function imageExtensionForFormat(format, fallback = 'png') {
  if (format === 'jpeg') return 'jpg'
  if (format === 'webp') return 'webp'
  if (format === 'gif') return 'gif'
  if (format === 'png') return 'png'
  return fallback
}

const waterfallDataDir = process.env.DIEFA_DATA_DIR || path.join(rootDir, 'data')
const waterfallAssetsDir = path.join(waterfallDataDir, 'waterfall-assets')
const videoAssetsDir = path.join(waterfallDataDir, 'video-assets')
const waterfallStoreFile = path.join(waterfallDataDir, 'waterfall-tasks.json')
const directImageStoreFile = path.join(waterfallDataDir, 'direct-image-records.json')
const videoTaskStoreFile = path.join(waterfallDataDir, 'video-tasks.json')
const avatarDownloadStoreFile = path.join(waterfallDataDir, 'please-day-avatar-downloads.json')
const waterfallControllers = new Map()
const FAILED_TASK_TTL = 5 * 60 * 1000
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

function avatarDownloadCount() {
  try {
    const count = Number(JSON.parse(fs.readFileSync(avatarDownloadStoreFile, 'utf8')).count)
    return Number.isSafeInteger(count) && count >= 0 ? count : 0
  } catch { return 0 }
}

function increaseAvatarDownloadCount() {
  const count = avatarDownloadCount() + 1
  fs.writeFileSync(avatarDownloadStoreFile, JSON.stringify({ count }), { mode: 0o600 })
  return count
}

function loadWaterfallTasks() {
  try {
    const tasks = JSON.parse(fs.readFileSync(waterfallStoreFile, 'utf8'))
    if (!Array.isArray(tasks)) return []
    return tasks.map((task) => ({
      ...task,
      refundedCount: Math.min(task.refundedCount || 0, task.count || task.slots?.length || 0),
    }))
  } catch { return [] }
}

let waterfallTasks = loadWaterfallTasks()

function loadDirectImageRecords() {
  try {
    const records = JSON.parse(fs.readFileSync(directImageStoreFile, 'utf8'))
    return Array.isArray(records) ? records.filter((record) => record?.id && record?.userId && Array.isArray(record.images)) : []
  } catch { return [] }
}

let directImageRecords = loadDirectImageRecords()

function saveDirectImageRecords() {
  fs.writeFileSync(directImageStoreFile, JSON.stringify(directImageRecords.slice(0, 1_000), null, 2), { mode: 0o600 })
}

function loadVideoTaskRecords() {
  try {
    const records = JSON.parse(fs.readFileSync(videoTaskStoreFile, 'utf8'))
    return Array.isArray(records) ? records.filter((record) => record?.id && record?.userId) : []
  } catch { return [] }
}

const videoTasks = new Map(loadVideoTaskRecords().map((record) => [record.id, record]))

function saveVideoTasks() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const records = [...videoTasks.values()].filter((record) => record.createdAt >= cutoff).slice(-300)
  fs.writeFileSync(videoTaskStoreFile, JSON.stringify(records, null, 2), { mode: 0o600 })
}

function saveWaterfallTasks() {
  fs.writeFileSync(waterfallStoreFile, JSON.stringify(waterfallTasks.slice(0, 300), null, 2))
}

async function createWaterfallThumbnail(sourcePath, thumbnailPath) {
  await sharp(sourcePath, { failOn: 'none' }).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toFile(thumbnailPath)
}

async function backfillWaterfallThumbnails() {
  for (const task of waterfallTasks) {
    for (const slot of task.slots || []) {
      if (slot.thumbnailUrl || !String(slot.url || '').startsWith('/api/waterfall/assets/')) continue
      const fileName = path.basename(slot.url)
      if (!fileName || fileName !== path.basename(fileName)) continue
      const sourcePath = path.join(waterfallAssetsDir, fileName)
      const thumbnailPath = path.join(waterfallAssetsDir, `${fileName}.thumb.webp`)
      try {
        await fs.promises.access(thumbnailPath)
      } catch {
        try {
          await fs.promises.access(sourcePath)
          await createWaterfallThumbnail(sourcePath, thumbnailPath)
        } catch (error) {
          console.warn('Unable to backfill generated-image thumbnail:', error?.message || error)
        }
      }
    }
  }
}

function isExpiredFailedTask(task, now = Date.now()) {
  if (!['failed', 'timeout', 'cancelled'].includes(task.status)) return false
  const completedAt = new Date(task.completedAt || task.updatedAt || task.createdAt).getTime()
  return Number.isFinite(completedAt) && completedAt <= now - FAILED_TASK_TTL
}

function removeWaterfallTaskAsset(task, url) {
  if (!String(url || '').startsWith('/api/waterfall/assets/')) return
  const fileName = path.basename(url)
  if (!fileName || fileName !== path.basename(fileName) || !fileName.startsWith(`${task.id}-`)) return
  fs.rmSync(path.join(waterfallAssetsDir, fileName), { force: true })
}

function cleanupExpiredFailedTasks() {
  const expired = waterfallTasks.filter((task) => isExpiredFailedTask(task))
  if (!expired.length) return
  for (const task of expired) {
    for (const source of task.referenceImages || []) removeWaterfallTaskAsset(task, source)
    for (const slot of task.slots || []) removeWaterfallTaskAsset(task, slot.url)
  }
  waterfallTasks = waterfallTasks.filter((task) => !isExpiredFailedTask(task))
  saveWaterfallTasks()
}

saveWaterfallTasks()
cleanupExpiredFailedTasks()
setImmediate(() => { void backfillWaterfallThumbnails() })
setInterval(cleanupExpiredFailedTasks, 60_000).unref()

// Video references may be up to 200 MB. They are immediately persisted and
// then sent to the provider as public URLs, never forwarded as base64.
app.use(express.json({ limit: '280mb' }))
const { requireAuth, requireAdmin, listUsers, spendCredits, refundCredits } = installAuth(app, { dataDir: waterfallDataDir })

async function refundWaterfallCredits(taskId, amount) {
  if (!amount) return null
  const task = waterfallTasks.find((item) => item.id === taskId)
  const remaining = Math.max(0, Number(task?.chargedCredits || 0) - Number(task?.refundedCredits || 0))
  const refundable = Math.min(amount, remaining)
  if (!refundable) return null
  const updated = updateWaterfallTask(taskId, (current) => ({ ...current, refundedCredits: (current.refundedCredits || 0) + refundable }))
  return updated?.userId ? refundCredits(updated.userId, refundable) : null
}

function waterfallCreditCostPerImage(task) {
  const count = Math.max(1, Number(task?.count) || task?.slots?.length || 1)
  const charged = Number(task?.chargedCredits || 0)
  return charged > 0 ? charged / count : imageCreditCost(task?.model, 1)
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

function vibbitBaseUrl() {
  return (process.env.VIBBIT_OPENAPI_BASE_URL || 'https://openapi.vibbit.cn/openapi/v1').replace(/\/$/, '')
}

function vibbitApiKey() {
  const key = String(process.env.VIBBIT_OPENAPI_KEY || '').trim()
  if (!key) throw Object.assign(new Error('服务端尚未配置 VIBBIT_OPENAPI_KEY'), { status: 500 })
  return key
}

async function vibbitApi(pathname, options = {}) {
  const response = await fetch(`${vibbitBaseUrl()}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${vibbitApiKey()}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    signal: AbortSignal.timeout(50_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.code !== 200) throw Object.assign(new Error(body.message || `视频服务返回 HTTP ${response.status}`), { status: response.status >= 400 ? response.status : 502 })
  return body.data || {}
}

function publicVideoUrl(assetPath) {
  const base = String(process.env.VIBBIT_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '')
  if (!base) throw Object.assign(new Error('服务端尚未配置 VIBBIT_PUBLIC_BASE_URL'), { status: 500 })
  return `${base}${assetPath}`
}

async function saveVideoReference(source) {
  const value = String(source || '')
  const dataMatch = value.match(/^data:((?:image\/(?:jpeg|png|webp))|(?:video\/(?:mp4|quicktime|webm)));base64,([\s\S]+)$/i)
  let buffer
  let extension
  let kind = 'image'
  if (dataMatch) {
    buffer = Buffer.from(dataMatch[2], 'base64')
    const mimeType = dataMatch[1].toLowerCase()
    kind = mimeType.startsWith('video/') ? 'video' : 'image'
    extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'video/quicktime' ? 'mov' : mimeType.split('/')[1]
  } else if (value.startsWith('/api/waterfall/assets/')) {
    const fileName = path.basename(value)
    if (!fileName || fileName !== path.basename(fileName)) throw Object.assign(new Error('参考图地址无效'), { status: 400 })
    buffer = await fs.promises.readFile(path.join(waterfallAssetsDir, fileName)).catch(() => null)
    if (!buffer) throw Object.assign(new Error('参考图已不可用，请重新上传'), { status: 422 })
    extension = path.extname(fileName).slice(1).toLowerCase()
  } else {
    throw Object.assign(new Error('请上传 JPG、PNG、WebP、MP4、MOV 或 WebM 参考素材'), { status: 400 })
  }
  const sizeLimit = kind === 'video' ? 200 : 30
  if (!buffer.length || buffer.length > sizeLimit * 1024 * 1024) throw Object.assign(new Error(`${kind === 'video' ? '参考视频' : '参考图'}必须小于 ${sizeLimit}MB`), { status: 413 })
  const fileName = `${randomUUID()}.${extension}`
  await fs.promises.writeFile(path.join(videoAssetsDir, fileName), buffer)
  return `/api/video/assets/${fileName}`
}

async function requestUpstream(endpoint, body, signal, timeoutMs = 180_000) {
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
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

const pendingUpstreamStatuses = new Set(['running', 'pending', 'queued', 'processing', 'in_progress'])
const succeededUpstreamStatuses = new Set(['succeeded', 'completed', 'success'])

function upstreamStatus(result) {
  return String(result?.status || result?.data?.status || result?.result?.status || '').trim().toLowerCase()
}

function upstreamId(result) {
  return result?.id || result?.data?.id || result?.result?.id || null
}

function upstreamResultUrls(result) {
  const resultLists = [result?.results, result?.data?.results, result?.result?.results]
  const urls = []
  for (const list of resultLists) {
    if (Array.isArray(list)) urls.push(...list.map((item) => item?.url).filter(Boolean))
  }
  urls.push(result?.result?.url, result?.data?.url, result?.url)
  return [...new Set(urls.filter(Boolean))]
}

function upstreamResultUrl(result) {
  return upstreamResultUrls(result)[0] || null
}

function upstreamError(result) {
  const value = result?.error || result?.data?.error || result?.result?.error || result?.message || result?.data?.message
  return typeof value === 'string' ? value : value?.message || ''
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

async function persistWaterfallImage(sourceUrl, taskId, slotIndex, expectedRatio) {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`保存生成图片失败（HTTP ${response.status}）`)
  const contentType = response.headers.get('content-type') || 'image/png'
  const upstreamExtension = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png'
  let imageBuffer = await sharp(Buffer.from(await response.arrayBuffer()), { failOn: 'none' }).rotate().toBuffer()
  let metadata = await sharp(imageBuffer, { failOn: 'none' }).metadata()
  const targetRatio = aspectRatioValue(expectedRatio)
  const returnedRatio = metadata.width && metadata.height ? metadata.width / metadata.height : null

  // Some upstream variants silently substitute an unsupported canvas (for
  // example returning 1:3 for a requested 9:21).  Persist the image at the
  // requested ratio instead of leaving the UI and downloaded file disagreeing.
  if (targetRatio && returnedRatio && Math.abs(Math.log(returnedRatio / targetRatio)) > 0.005) {
    const width = metadata.width
    const height = Math.max(1, Math.round(width / targetRatio))
    imageBuffer = await sharp(imageBuffer, { failOn: 'none' })
      .resize({ width, height, fit: 'cover', position: 'attention' })
      .png()
      .toBuffer()
    metadata = await sharp(imageBuffer, { failOn: 'none' }).metadata()
  }

  const extension = imageExtensionForFormat(metadata.format, upstreamExtension)
  const fileName = `${taskId}-${slotIndex}.${extension}`
  await fs.promises.writeFile(path.join(waterfallAssetsDir, fileName), imageBuffer)
  let thumbnailUrl = null
  try {
    const thumbnailName = `${taskId}-${slotIndex}.thumb.webp`
    await sharp(imageBuffer, { failOn: 'none' }).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(waterfallAssetsDir, thumbnailName))
    thumbnailUrl = `/api/waterfall/assets/${thumbnailName}`
  } catch (error) {
    // The original remains usable if an unusual upstream image cannot be
    // thumbnailed; do not turn a completed generation into a failed one.
    console.warn('Unable to create generated-image thumbnail:', error?.message || error)
  }
  const size = metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : null
  return { url: `/api/waterfall/assets/${fileName}`, thumbnailUrl, size }
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
  if (source.startsWith('/api/waterfall/assets/')) {
    const fileName = path.basename(new URL(source, 'http://localhost').pathname)
    if (!fileName || fileName !== path.basename(fileName)) throw Object.assign(new Error('参考图地址无效，请重新上传'), { status: 422 })
    try {
      const sourcePath = path.join(waterfallAssetsDir, fileName)
      await fs.promises.access(sourcePath)
      const extension = path.extname(fileName).replace('.', '').toLowerCase() || 'png'
      const taskFileName = `${taskId}-reference-${index}.${extension}`
      await fs.promises.copyFile(sourcePath, path.join(waterfallAssetsDir, taskFileName))
      return `/api/waterfall/assets/${taskFileName}`
    } catch {
      // Do this before credits are charged and before the task is created.
      // A missing local reference otherwise fails silently before any upstream
      // generation request can be made.
      throw Object.assign(new Error('参考图已不可用，请重新上传后再生成'), { status: 422 })
    }
  }
  const { mimeType, buffer } = await imageSourceToData(source)
  const fileName = `${taskId}-reference-${index}.${imageExtension(mimeType)}`
  await fs.promises.writeFile(path.join(waterfallAssetsDir, fileName), buffer)
  return `/api/waterfall/assets/${fileName}`
}

async function persistUploadedImage(source, name = 'upload') {
  const { mimeType, buffer } = await imageSourceToData(source)
  const safeName = String(name || 'upload').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'upload'
  const fileName = `${safeName}-${Date.now()}-${randomUUID()}.${imageExtension(mimeType)}`
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
    const savedSlot = waterfallTasks.find((task) => task.id === taskId)?.slots?.[slotIndex]
    let result
    let id = savedSlot?.upstreamId
    if (id) {
      updateWaterfallTask(taskId, (task) => ({ ...task, slots: task.slots.map((slot, index) => index === slotIndex ? { ...slot, phase: 'polling', lastEvent: '正在向生图服务查询结果' } : slot) }))
      result = await requestUpstreamResult(id, controller.signal)
    } else {
      updateWaterfallTask(taskId, (task) => ({ ...task, slots: task.slots.map((slot, index) => index === slotIndex ? { ...slot, phase: 'submitting', submissionStartedAt: new Date().toISOString(), lastEvent: '正在提交到生图服务' } : slot) }))
      result = await requestUpstream('/v1/api/generate', {
        model: upstreamImageModel(config.model),
        prompt: imagePromptWithCurrentDate(config.prompt).slice(0, 30_000),
      images: config.images,
      aspectRatio: config.aspectRatio,
      quality: config.quality,
      replyType: 'async',
      }, controller.signal, 45_000)
      id = upstreamId(result)
      if (!id) throw new Error(upstreamError(result) || '上游未返回任务编号')
      updateWaterfallTask(taskId, (task) => ({ ...task, slots: task.slots.map((slot, index) => index === slotIndex ? { ...slot, upstreamId: id, phase: 'polling', submittedAt: new Date().toISOString(), lastEvent: `已提交生图服务（任务 ${id}）` } : slot) }))
    }

    while (!upstreamStatus(result) || pendingUpstreamStatuses.has(upstreamStatus(result))) {
      await waitForPoll(5_000, controller.signal)
      result = await requestUpstreamResult(id, controller.signal)
    }
    const status = upstreamStatus(result)
    const sourceUrl = upstreamResultUrl(result)
    if (!succeededUpstreamStatuses.has(status) || !sourceUrl) throw new Error(upstreamError(result) || `生成失败（${status || 'unknown'}）`)
    const task = waterfallTasks.find((item) => item.id === taskId)
    const localImage = await persistWaterfallImage(sourceUrl, taskId, slotIndex, task?.resolvedAspectRatio || task?.aspectRatio)
    updateWaterfallTask(taskId, (current) => ({ ...current, actualGenerationSize: localImage.size || current.actualGenerationSize || current.generationSize, slots: current.slots.map((slot, index) => index === slotIndex ? { ...slot, status: 'succeeded', phase: 'completed', lastEvent: '图片已保存', url: localImage.url, thumbnailUrl: localImage.thumbnailUrl, actualSize: localImage.size, completedAt: new Date().toISOString() } : slot) }))
  } catch (error) {
    const task = waterfallTasks.find((item) => item.id === taskId)
    const status = task?.status === 'cancelled' ? 'cancelled' : task?.status === 'timeout' ? 'timeout' : 'failed'
    const shouldRefund = task?.slots[slotIndex]?.status === 'running'
    updateWaterfallTask(taskId, (current) => ({
      ...current,
      refundedCount: (current.refundedCount || 0) + (current.slots[slotIndex]?.status === 'running' ? 1 : 0),
      slots: current.slots.map((slot, index) => index === slotIndex && slot.status === 'running' ? { ...slot, status, phase: 'failed', lastEvent: '提交或查询失败', error: status === 'cancelled' ? '已停止' : status === 'timeout' ? '生成超时' : (error?.name === 'TimeoutError' || /timeout|timed out/i.test(error?.message || '') ? '提交生图服务超时，上游未创建任务' : (error?.message || '生成失败')) } : slot),
    }))
    if (shouldRefund) await refundWaterfallCredits(taskId, waterfallCreditCostPerImage(task))
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
  await refundWaterfallCredits(taskId, unfinishedCount * waterfallCreditCostPerImage(task))
  return waterfallTasks.find((item) => item.id === taskId)
}

async function runWaterfallTask(task, images) {
  const remainingTime = Math.max(5_000, 10 * 60 * 1000 - (Date.now() - new Date(task.createdAt).getTime()))
  const timeout = setTimeout(() => { void stopWaterfallTask(task.id, 'timeout') }, remainingTime)
  try {
    const upstreamImages = await Promise.all(images.map(waterfallReferenceForUpstream))
    const config = {
      model: task.model || 'gpt-image-2.5-sunburst',
      prompt: task.prompt,
      images: upstreamImages,
      aspectRatio: task.generationSize || generationSize(task.model || 'gpt-image-2.5-sunburst', task.resolution || '2k', task.resolvedAspectRatio || '1:1'),
      quality: task.quality || DEFAULT_IMAGE_QUALITY,
    }
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
    await refundWaterfallCredits(task.id, runningCount * waterfallCreditCostPerImage(task))
  } finally { clearTimeout(timeout) }
}

function recoverWaterfallTasks() {
  for (const task of waterfallTasks.filter((item) => item.status === 'running')) {
    // Deploying restarts Node. Continue polling saved upstream IDs rather
    // than leaving an already-completed image in the generating state.
    setImmediate(() => runWaterfallTask(task, task.referenceImages || []))
  }
}

function ocrExecutablePath() {
  // This helper wraps Apple Vision and is bundled only for the macOS desktop
  // app. The Tencent deployment runs Linux, where attempting to execute the
  // Mach-O binary aborts the entire compliance request.
  if (process.platform !== 'darwin') return null
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
  const parts = [{ text: `你是品牌物料和门店店招的视觉检查器。逐张查看图片本身，只输出可直接观察到的事实，不做最终合规结论。

必须检查并清楚描述：
1. 图片内所有可辨认文字，尤其是品牌英文名、中文名、Logo 文案、数字和单位；
2. Logo 的位置、完整性、清晰度，是否被标题、图片或其他元素遮挡/压住/裁切，是否缺少关键字母或部件；
3. Logo 是否旋转、镜像、压扁、拉长、透视变形、改色、描边或使用错误版本；
4. 核心标题、电话号码等是否被裁断或互相覆盖；
5. 对遮挡关系写明“哪个元素遮挡了哪个元素”，不要只转录文字。
6. 如果画面是门店、门头、侧招、玻璃贴、广告牌或施工/效果图，识别可见物料类型，完整转录可辨认的尺寸、比例、材质、工艺、色值、灯箱、侧招、玻璃贴、二维码和导视信息；说明画面是否覆盖门店正面、侧面和玻璃区域。
7. 不要从照片臆测不可见的材质、厚度、色温、调光器、防水、二维码跳转或现场尺寸。看不到时明确写“未提供足够可见证据”。

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
  // Visual analysis remains available on the server, so OCR is an optional
  // supplement. Returning an empty string lets the audit complete even where
  // the platform-specific local OCR runtime is unavailable.
  if (!executable || !fs.existsSync(executable)) return ''
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
  if (!query) {
    const error = new Error('未找到可用于联网搜索的问题')
    error.status = 400
    throw error
  }
  if (!apiKey) return weatherFallbackSearch(query)
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
  return {
    available: true,
    sources: (data.results || []).filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url)).slice(0, 5).map((item) => ({
    title: String(item.title || item.url).slice(0, 200),
    url: item.url,
    content: String(item.content || '').slice(0, 1_200),
    })),
  }
}

function weatherCityFromQuery(query) {
  const matched = String(query || '').match(/([\u4e00-\u9fff]{2,12})(?:的)?(?:天气|气温|温度|降雨|下雨|风力|湿度)/)
  return matched?.[1]?.replace(/^(?:请问|请帮我|帮我|查询|查看|看一下)/, '') || ''
}

function weatherDescription(code) {
  const labels = { 0: '晴', 1: '大部晴朗', 2: '局部多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '小毛毛雨', 53: '毛毛雨', 55: '强毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪', 80: '阵雨', 81: '较强阵雨', 82: '强阵雨', 95: '雷暴', 96: '冰雹雷暴', 99: '强冰雹雷暴' }
  return labels[code] || '未知'
}

async function weatherFallbackSearch(query) {
  const city = weatherCityFromQuery(query)
  if (!city) return { available: false, sources: [] }
  try {
    const geocoding = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`, { signal: AbortSignal.timeout(10_000) })
    const place = (await geocoding.json().catch(() => ({}))).results?.[0]
    if (!geocoding.ok || !place) return { available: false, sources: [] }
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=Asia%2FShanghai`
    const weatherResponse = await fetch(weatherUrl, { signal: AbortSignal.timeout(10_000) })
    const weather = await weatherResponse.json().catch(() => ({}))
    const current = weather.current
    if (!weatherResponse.ok || !current) return { available: false, sources: [] }
    return {
      available: true,
      sources: [{
        title: `${place.name}实时天气（Open-Meteo）`,
        url: weatherUrl,
        content: `观测时间：${current.time}；天气：${weatherDescription(current.weather_code)}；气温：${current.temperature_2m}°C；体感：${current.apparent_temperature}°C；相对湿度：${current.relative_humidity_2m}%；降水：${current.precipitation}mm；风速：${current.wind_speed_10m}km/h。`,
      }],
    }
  } catch { return { available: false, sources: [] } }
}

function shanghaiDate() {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
}

function webSourcesPrompt(sources, available = true) {
  const dateContext = `当前中国标准时间日期为${shanghaiDate()}。凡是回答、图表或图片中出现“今天”、日期、星期或未来日期，必须以此日期和本次联网资料的时间为准，绝不能使用静态示例、旧日期或自行猜测的日期。`
  if (!available) return `${dateContext}\n\n当前未配置通用联网搜索，无法获取实时网页资料。若用户询问时效性信息，请明确说明目前不能完成实时检索，不要猜测或编造。`
  if (!sources.length) return `${dateContext}\n\n已执行联网检索，但没有找到足够可靠的结果。请明确说“联网检索未找到可靠结果”，不要说自己没有联网搜索工具，也不要编造实时信息。`
  return `${dateContext}\n\n已完成联网检索。以下是本次检索到的实时资料，必须优先基于这些资料作答；不要声称自己无法联网搜索或没有实时搜索工具。若资料之间有差异，请说明差异。不要捏造来源中没有的信息。不要输出 URL、来源编号或 Markdown 符号（例如 **、#、-）。使用可直接复制的简洁中文自然段；如有多个要点，以“要点名：内容”的短句呈现。\n\n${sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.content}`).join('\n\n')}`
}

function completionText(data) {
  const message = data?.choices?.[0]?.message || {}
  const asText = (value) => {
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value)) return value.map((part) => asText(part?.text ?? part?.content ?? '')).filter(Boolean).join('\n').trim()
    return ''
  }
  return asText(message.content) || asText(message.reasoning_content) || asText(message.reasoning) || asText(data?.output_text)
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, apiConfigured: Boolean(process.env.GRSAI_API_KEY), baseUrl: apiBase })
})

app.get('/api/please-day/avatar-downloads', (_req, res) => {
  res.json({ count: avatarDownloadCount() })
})

app.post('/api/please-day/avatar-downloads', (_req, res) => {
  res.json({ count: increaseAvatarDownloadCount() })
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
    const webResult = webSearch ? await searchWeb(searchQueryFromMessages(messages, searchQuery)) : { available: true, sources: [] }
    const sources = webResult.sources
    const combinedSystemPrompt = [systemPrompt, webSearch ? webSourcesPrompt(sources, webResult.available) : ''].filter(Boolean).join('\n\n')
    const upstreamRequest = {
      model: 'gpt-6-astra',
      stream: false,
      messages: [
        ...(combinedSystemPrompt ? [{ role: 'system', content: combinedSystemPrompt.slice(0, 18_000) }] : []),
        ...safeMessages,
      ],
    }
    // Text replies should fail visibly instead of keeping a chat card in a
    // running state for several minutes when the upstream stalls.
    let data = await requestUpstream('/v1/chat/completions', upstreamRequest, undefined, 45_000)
    let content = completionText(data)
    // Some compatible reasoning endpoints occasionally return an empty content
    // field on the first completion. Retry once with an explicit answer request
    // so the UI never renders sources without a response.
    if (!content) {
      data = await requestUpstream('/v1/chat/completions', {
        ...upstreamRequest,
        messages: [...upstreamRequest.messages, { role: 'user', content: '请基于以上资料直接给出简洁、完整的中文回答。' }],
      }, undefined, 45_000)
      content = completionText(data)
    }
    if (!content) throw new Error('接口未返回有效文本')
    res.json({ content, sources, usage: data.usage || null, model: data.model || 'gpt-6-astra' })
  } catch (error) {
    next(error)
  }
})

// On the server deployment, user reference images are stored on the instance
// instead of passing through Cloudflare KV or requiring a Google Drive session.
app.post('/api/google-drive/uploads', requireAuth, async (req, res, next) => {
  try {
    const { source, name } = req.body || {}
    if (!String(source || '').startsWith('data:image/')) return res.status(400).json({ error: '请上传有效的图片文件' })
    res.status(201).json({ url: await persistUploadedImage(source, name) })
  } catch (error) { next(error) }
})

app.post('/api/image', requireAuth, async (req, res, next) => {
  let chargedUser = null
  let creditCost = 0
  try {
    const { prompt, images = [], aspectRatio = DEFAULT_IMAGE_ASPECT_RATIO, model, resolution, quality = DEFAULT_IMAGE_QUALITY } = req.body
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt 不能为空' })
    }
    if (!Array.isArray(images) || images.length > 4) {
      return res.status(400).json({ error: '参考图最多 4 张' })
    }
    const settings = imageModelSettings(model, resolution, quality)
    creditCost = imageCreditCost(settings.model)
    chargedUser = spendCredits(req.user.id, creditCost)
    const upstreamImages = await Promise.all(images.map(waterfallReferenceForUpstream))
    const resolvedAspectRatio = supportsImageRatio(settings.model, settings.resolution, aspectRatio) ? aspectRatio : DEFAULT_IMAGE_ASPECT_RATIO
    const data = await requestUpstream('/v1/api/generate', {
      model: upstreamImageModel(settings.model),
      prompt: imagePromptWithCurrentDate(prompt).slice(0, 30_000),
      images: upstreamImages,
      aspectRatio: generationSize(settings.model, settings.resolution, resolvedAspectRatio),
      quality: settings.quality,
      replyType: 'json',
    })
    const urls = upstreamResultUrls(data)
    const status = upstreamStatus(data)
    if (!succeededUpstreamStatuses.has(status) || urls.length === 0) {
      throw new Error(upstreamError(data) || `图片生成未成功，当前状态：${status || 'unknown'}`)
    }
    const assetPrefix = `image-${data.id || randomUUID()}`
    const localImages = await Promise.all(urls.map((url, index) => persistWaterfallImage(url, assetPrefix, index, resolvedAspectRatio)))
    directImageRecords = [{
      id: randomUUID(),
      userId: req.user.id,
      prompt: prompt.trim().slice(0, 30_000),
      model: settings.model,
      resolution: settings.resolution,
      quality: settings.quality,
      aspectRatio: resolvedAspectRatio,
      generationSize: localImages[0]?.size || generationSize(settings.model, settings.resolution, resolvedAspectRatio),
      createdAt: new Date().toISOString(),
      images: localImages,
    }, ...directImageRecords]
    saveDirectImageRecords()
    res.json({ id: upstreamId(data), status, aspectRatio: resolvedAspectRatio, model: settings.model, resolution: settings.resolution, quality: settings.quality, urls: localImages.map((image) => image.url), user: chargedUser })
  } catch (error) {
    if (chargedUser) refundCredits(req.user.id, creditCost)
    next(error)
  }
})

app.use('/api/video/assets', express.static(videoAssetsDir, { fallthrough: false }))

app.post('/api/video/references', requireAuth, async (req, res, next) => {
  try {
    const assetPath = await saveVideoReference(req.body?.source)
    res.status(201).json({ url: publicVideoUrl(assetPath) })
  } catch (error) { next(error) }
})

app.post('/api/video/tasks', requireAuth, async (req, res, next) => {
  try {
    const { model, prompt, durationSeconds, resolution, aspectRatio, referenceMode = 'text', imageUrl, firstFrameImageUrl, lastFrameImageUrl, referenceImageUrls = [], referenceVideoUrls = [], omniReferenceTaskType } = req.body || {}
    if (model === 'minimax-h3') {
      if (!String(prompt || '').trim()) return res.status(400).json({ error: '视频提示词不能为空' })
      if (!['portrait', 'landscape', 'square'].includes(aspectRatio)) return res.status(400).json({ error: 'MiniMax H3 仅支持横屏、竖屏或方屏' })
      if (!['480p', '768p', '1080p'].includes(resolution)) return res.status(400).json({ error: 'MiniMax H3 仅支持 480p、768p 或 1080p' })
      const seconds = Number(durationSeconds)
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 15 || (resolution === '1080p' && seconds > 10)) return res.status(400).json({ error: resolution === '1080p' ? 'MiniMax H3 1080p 最长 10 秒' : 'MiniMax H3 时长应为 1–15 秒' })
      if (!['text', 'image', 'reference'].includes(referenceMode)) return res.status(400).json({ error: 'MiniMax H3 目前支持纯文本、首帧图片和多图参考' })
      if (!Array.isArray(referenceImageUrls) || referenceImageUrls.length > 9) return res.status(400).json({ error: 'MiniMax H3 最多支持 9 张参考图' })
      if (referenceVideoUrls.length) return res.status(400).json({ error: 'MiniMax H3 接口只支持图片参考，不支持视频参考' })
      if (referenceMode === 'image' && !imageUrl) return res.status(400).json({ error: '请添加一张首帧图片' })
      const generated = await requestUpstream('/v1/api/generate', {
        model: 'minimax-h3',
        prompt: String(prompt).trim().slice(0, 30_000),
        aspectRatio,
        images: referenceMode === 'image' ? [imageUrl] : referenceImageUrls,
        audios: [],
        seed: -1,
        resolution,
        duration: seconds,
        replyType: 'json',
      })
      const statusMap = { succeeded: 'COMPLETED', running: 'RUNNING', failed: 'FAILED', violation: 'FAILED' }
      const status = statusMap[String(generated.status || '').toLowerCase()] || 'FAILED'
      const record = { id: generated.id || randomUUID(), userId: req.user.id, provider: 'minimax', prompt: String(prompt).trim().slice(0, 30_000), model, resolution, durationSeconds: seconds, aspectRatio, referenceMode, referenceImages: referenceMode === 'image' ? [imageUrl] : referenceImageUrls, referenceVideos: [], status, videoUrl: generated.results?.[0]?.url || '', error: generated.error || (status === 'FAILED' ? 'MiniMax H3 未返回视频结果' : ''), createdAt: Date.now() }
      videoTasks.set(record.id, record); saveVideoTasks()
      return res.status(status === 'COMPLETED' ? 200 : 202).json({ taskId: record.id, status: record.status, videoUrl: record.videoUrl, error: record.error })
    }
    const modelInfo = {
      'doubao-seedance-2-0-fast-260128': { resolutions: ['480p', '720p'], maximum: 15 },
      'doubao-seedance-2-0-260128': { resolutions: ['480p', '720p', '1080p', '4k'], maximum: 15 },
      'doubao-seedance-2-0-mini-260615': { resolutions: ['480p', '720p'], maximum: 15 },
      'doubao-seedance-2-5-260628': { resolutions: ['480p', '720p', '1080p'], maximum: 30 },
    }[model]
    if (!modelInfo) return res.status(400).json({ error: '不支持的视频模型' })
    if (!String(prompt || '').trim()) return res.status(400).json({ error: '视频提示词不能为空' })
    if (!modelInfo.resolutions.includes(resolution)) return res.status(400).json({ error: '该模型不支持所选分辨率' })
    const is25 = model === 'doubao-seedance-2-5-260628'
    if (!['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].includes(aspectRatio)) return res.status(400).json({ error: '画幅参数不支持' })
    const seconds = Number(durationSeconds)
    if (!Number.isInteger(seconds) || (seconds !== -1 && (seconds < 4 || seconds > modelInfo.maximum))) return res.status(400).json({ error: `时长应为自动或 4–${modelInfo.maximum} 秒` })
    if (!['text', 'image', 'frames', 'reference', 'edit', 'extend'].includes(referenceMode)) return res.status(400).json({ error: '参考方式不支持' })
    if (!is25 && ['edit', 'extend'].includes(referenceMode)) return res.status(400).json({ error: '视频编辑和视频延长仅支持 Seedance 2.5' })
    if (!Array.isArray(referenceImageUrls) || referenceImageUrls.length > (is25 ? 30 : 9)) return res.status(400).json({ error: '参考图数量超出该模型限制' })
    if (!Array.isArray(referenceVideoUrls) || referenceVideoUrls.length > (is25 ? 10 : 0)) return res.status(400).json({ error: is25 ? '参考视频最多 10 段' : 'Seedance 2.0 当前不支持视频参考' })
    const input = { model, prompt: String(prompt).trim().slice(0, 30_000), duration_seconds: seconds, resolution, aspect_ratio: aspectRatio }
    if (referenceMode === 'image') {
      if (!imageUrl) return res.status(400).json({ error: '请添加一张首帧图片' })
      input.image_url = imageUrl
      input.aspect_ratio = 'adaptive'
    }
    if (referenceMode === 'frames') {
      if (!firstFrameImageUrl) return res.status(400).json({ error: '首尾帧模式至少需要一张首帧图片' })
      input.first_frame_image_url = firstFrameImageUrl
      if (lastFrameImageUrl) input.last_frame_image_url = lastFrameImageUrl
      input.aspect_ratio = 'adaptive'
    }
    if (referenceMode === 'reference') {
      if (referenceImageUrls.length) input.reference_image_urls = referenceImageUrls
      if (referenceVideoUrls.length) input.reference_video_urls = referenceVideoUrls
    }
    if (['edit', 'extend'].includes(referenceMode)) {
      if (!referenceVideoUrls.length) return res.status(400).json({ error: '视频编辑和视频延长都需要上传一段源视频' })
      input.reference_video_urls = referenceVideoUrls
      if (referenceImageUrls.length) input.reference_image_urls = referenceImageUrls
      input.aspect_ratio = 'adaptive'
      if (referenceMode === 'edit') input.duration_seconds = -1
    }
    if (is25 && omniReferenceTaskType) {
      if (!['auto', 'reference', 'edit', 'extend'].includes(omniReferenceTaskType)) return res.status(400).json({ error: 'Seedance 2.5 任务类型不支持' })
      input.omni_reference_task_type = omniReferenceTaskType
    }
    const created = await vibbitApi('/tasks', { method: 'POST', body: JSON.stringify({ task_type: 'SEEDANCE_VIDEO_GENERATION', input_info: { input: JSON.stringify(input) } }) })
    if (!created.task_id) throw new Error('Seedance 未返回任务 ID')
    videoTasks.set(created.task_id, { id: created.task_id, userId: req.user.id, prompt: input.prompt, model, resolution, durationSeconds: input.duration_seconds, aspectRatio: input.aspect_ratio, referenceMode, referenceImages: referenceMode === 'image' ? [imageUrl] : referenceMode === 'frames' ? [firstFrameImageUrl, lastFrameImageUrl].filter(Boolean) : referenceImageUrls, referenceVideos: referenceVideoUrls, status: 'PENDING', createdAt: Date.now() })
    saveVideoTasks()
    res.status(202).json({ taskId: created.task_id, status: 'PENDING' })
  } catch (error) { next(error) }
})

app.get('/api/video/tasks', requireAuth, (req, res) => {
  const tasks = [...videoTasks.values()]
    .filter((task) => task.userId === req.user.id)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 30)
    .map(({ userId: _userId, ...task }) => task)
  res.json({ tasks })
})

app.get('/api/video/tasks/:id', requireAuth, async (req, res, next) => {
  try {
    const localTask = videoTasks.get(req.params.id)
    if (!localTask || localTask.userId !== req.user.id) return res.status(404).json({ error: '视频任务不存在或无权访问' })
    if (localTask.provider === 'minimax') return res.json({ ...localTask, taskId: req.params.id })
    if (Date.now() - localTask.createdAt > 20 * 60 * 1000 && ['PENDING', 'RUNNING'].includes(localTask.status)) {
      const failed = { ...localTask, status: 'FAILED', error: '视频生成超时，请重新生成' }
      videoTasks.set(req.params.id, failed); saveVideoTasks()
      return res.json({ ...failed, taskId: req.params.id, videoUrl: '' })
    }
    const task = await vibbitApi(`/tasks/${encodeURIComponent(req.params.id)}`)
    let result = {}
    try { result = JSON.parse(task.task_result?.result || '{}') } catch { result = {} }
    const nextTask = { ...localTask, status: task.status, videoUrl: result.video_url || '', error: result.error_message || '' }
    videoTasks.set(req.params.id, nextTask); saveVideoTasks()
    res.json({ ...nextTask, taskId: task.task_id || req.params.id })
  } catch (error) { next(error) }
})

app.get('/api/waterfall/thumbnails/:fileName', async (req, res, next) => {
  try {
    const fileName = path.basename(req.params.fileName)
    if (!fileName || fileName !== req.params.fileName) return res.status(400).json({ error: '缩略图文件名无效' })
    const sourcePath = path.join(waterfallAssetsDir, fileName)
    const thumbnailPath = path.join(waterfallAssetsDir, `${fileName}.thumb.webp`)
    await fs.promises.access(sourcePath)
    try {
      await fs.promises.access(thumbnailPath)
    } catch {
      await createWaterfallThumbnail(sourcePath, thumbnailPath)
    }
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.type('image/webp').sendFile(thumbnailPath)
  } catch (error) { next(error) }
})

app.use('/api/waterfall/assets', express.static(waterfallAssetsDir, { fallthrough: false }))

app.get('/api/waterfall/tasks', requireAuth, (req, res) => {
  cleanupExpiredFailedTasks()
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const limit = Math.min(300, Math.max(6, Number(req.query.limit) || 8))
  const ordered = waterfallTasks.filter((task) => task.userId === req.user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  res.json({ tasks: ordered.slice(offset, offset + limit), total: ordered.length, hasMore: offset + limit < ordered.length, user: req.user })
})

app.post('/api/waterfall/tasks', requireAuth, async (req, res, next) => {
  try {
    const { prompt, images = [], aspectRatio = DEFAULT_IMAGE_ASPECT_RATIO, count = 2, model, resolution, quality = DEFAULT_IMAGE_QUALITY, clientRequestId } = req.body
    const requestedCount = Number(count)
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: '提示词不能为空' })
    if (!Array.isArray(images) || images.length > 9) return res.status(400).json({ error: '参考图最多 9 张' })
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 4) return res.status(400).json({ error: '生成数量必须为 1 至 4 张' })
    const settings = imageModelSettings(model, resolution, quality)
    const resolvedAspectRatio = supportsImageRatio(settings.model, settings.resolution, aspectRatio) ? aspectRatio : DEFAULT_IMAGE_ASPECT_RATIO
    const imageSize = generationSize(settings.model, settings.resolution, resolvedAspectRatio)
    const now = new Date().toISOString()
    const id = randomUUID()
    const referenceImages = await Promise.all(images.map((source, index) => persistWaterfallReference(source, id, index)))
    const creditCostPerImage = imageCreditCost(settings.model)
    const chargedCredits = imageCreditCost(settings.model, requestedCount)
    const chargedUser = spendCredits(req.user.id, chargedCredits)
    const task = {
      id,
      userId: req.user.id,
      prompt: prompt.trim().slice(0, 30_000),
      aspectRatio,
      resolvedAspectRatio,
      model: settings.model,
      resolution: settings.resolution,
      quality: settings.quality,
      generationSize: imageSize,
      count: requestedCount,
      referenceCount: images.length,
      referenceImages,
      status: 'running',
      clientRequestId: typeof clientRequestId === 'string' ? clientRequestId.slice(0, 96) : null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      chargedCredits,
      creditCostPerImage,
      refundedCredits: 0,
      refundedCount: 0,
      slots: Array.from({ length: requestedCount }, (_, index) => ({ index, status: 'running', phase: 'queued', lastEvent: '等待提交', url: null, error: null, upstreamId: null })),
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
  if (task.userId !== req.user.id) return res.status(404).json({ error: '任务不存在或无权操作' })
  const stopped = await stopWaterfallTask(task.id)
  res.json({ task: stopped, user: stopped?.userId === req.user.id ? refundCredits(req.user.id, 0) || req.user : req.user })
})

app.get('/api/admin/overview', requireAdmin, (_req, res) => {
  const waterfallImages = waterfallTasks.flatMap((task) => (task.slots || [])
    .filter((slot) => slot.status === 'succeeded' && slot.url)
    .map((slot) => ({
      id: `${task.id}-${slot.index}`,
      userId: task.userId,
      url: slot.url,
      thumbnailUrl: slot.thumbnailUrl || '',
      prompt: task.prompt,
      model: task.model,
      resolution: task.resolution,
      aspectRatio: task.resolvedAspectRatio || task.aspectRatio,
      createdAt: slot.completedAt || task.completedAt || task.createdAt,
    })))
  const directImages = directImageRecords.flatMap((record) => record.images.map((image, index) => ({
    id: `${record.id}-${index}`,
    userId: record.userId,
    url: image.url,
    thumbnailUrl: image.thumbnailUrl || '',
    prompt: record.prompt,
    model: record.model,
    resolution: record.resolution,
    aspectRatio: record.aspectRatio,
    createdAt: record.createdAt,
  })))
  const images = [...waterfallImages, ...directImages].sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
  res.json({ users: listUsers(), images })
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

recoverWaterfallTasks()

app.listen(port, '0.0.0.0', () => {
  console.log(`Die Fa AI server listening on http://localhost:${port}`)
})
