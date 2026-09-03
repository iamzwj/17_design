import { connect } from 'cloudflare:sockets'

const SIZES = {
  '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280',
  '4:3': '1152x864', '3:4': '864x1152', '3:2': '1536x1024',
  '2:3': '1024x1536', '21:9': '1456x624', '9:21': '624x1456',
}
const IMAGE_MODELS = new Set(['gpt-image-2', 'gpt-image-2-vip'])
const IMAGE_RESOLUTIONS = new Set(['1k', '2k', '4k'])
const VIP_SIZES = {
  '1k': SIZES,
  '2k': {
    '1:1': '2048x2048', '16:9': '2560x1440', '9:16': '1440x2560',
    '4:3': '2304x1728', '3:4': '1728x2304', '3:2': '2496x1664',
    '2:3': '1664x2496', '21:9': '3024x1296', '9:21': '1296x3024',
  },
  '4k': {
    '1:1': '2880x2880', '16:9': '3840x2160', '9:16': '2160x3840',
    '4:3': '3264x2448', '3:4': '2448x3264', '3:2': '3504x2336',
    '2:3': '2336x3504', '21:9': '3696x1584', '9:21': '1584x3696',
  },
}

function imageModelSettings(model, resolution) {
  const selectedModel = String(model || 'gpt-image-2-vip')
  if (!IMAGE_MODELS.has(selectedModel)) throw new HttpError('不支持的生图模型', 400)
  if (selectedModel !== 'gpt-image-2-vip') return { model: selectedModel, resolution: '1k' }
  const selectedResolution = String(resolution || '2k').toLowerCase()
  if (!IMAGE_RESOLUTIONS.has(selectedResolution)) throw new HttpError('VIP 清晰度仅支持 1K、2K 或 4K', 400)
  return { model: selectedModel, resolution: selectedResolution }
}

function generationSize(model, resolution, ratio) {
  const sizes = model === 'gpt-image-2-vip' ? VIP_SIZES[resolution] : SIZES
  return sizes[ratio] || sizes['1:1']
}
const KEY_PREFIX = 'task:'
const TASK_INDEX_KEY = 'waterfall:task-index'
const AUTH_USER_PREFIX = 'auth:user:'
const AUTH_CODE_PREFIX = 'auth:code:'
const AUTH_SESSION_PREFIX = 'auth:session:'
const GOOGLE_DRIVE_STATE_PREFIX = 'auth:google-drive:state:'
const GOOGLE_DRIVE_CONFIG_KEY = 'auth:google-drive:config'
const GOOGLE_DRIVE_FOLDER_CACHE_PREFIX = 'google-drive:folder:'
const AVATAR_DOWNLOAD_COUNTER_NAME = 'please-day-avatar-downloads'
const VIDEO_TASK_PREFIX = 'video:task:'
const VIDEO_ASSET_PREFIX = 'video:asset:'
const VIDEO_ASSET_META_PREFIX = 'video:asset-meta:'
const VIDEO_TASK_TTL_SECONDS = 60 * 60
const VIDEO_RESULT_TTL_SECONDS = 30 * 24 * 60 * 60
const VIDEO_ASSET_TTL_SECONDS = 60 * 60
const MAX_VIDEO_REFERENCE_BYTES = 24 * 1024 * 1024
const VIBBIT_API_BASE = 'https://openapi.vibbit.cn/openapi/v1'
const TEXT_MODEL = 'gpt-5.6-terra'
const SEEDANCE_MODELS = {
  'doubao-seedance-2-0-260128': { resolutions: ['480p', '720p', '1080p', '4k'], maxDuration: 15 },
  'doubao-seedance-2-5-260628': { resolutions: ['480p', '720p', '1080p'], maxDuration: 30 },
}
const SEEDANCE_ASPECT_RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])
const MAX_TASKS = 300
const FAILED_TASK_TTL_SECONDS = 5 * 60
const IMAGE_RETENTION_SECONDS = 30 * 24 * 60 * 60
const IMAGE_RETENTION_MS = IMAGE_RETENTION_SECONDS * 1000
const EMAIL_PATTERN = /^[^\s@]+@onewo\.com$/i
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,64}$/
const DEFAULT_CREDITS = 50
const CREDIT_OVERRIDES = new Map([
  ['zhangwj159@onewo.com', 999],
])
const REGISTRATION_WHITELIST = new Set([
  'zhoumt10@onewo.com', 'chenjl76@onewo.com', 'cheny453@onewo.com',
  'helg03@onewo.com', 'huangjq59@onewo.com', 'ligy70@onewo.com',
  'yem15@onewo.com', 'zhangwj159@onewo.com', 'zhouz76@onewo.com', 'wangnf@onewo.com',
])

const time = () => new Date().toISOString()
const taskKey = (id) => `${KEY_PREFIX}${id}`
const reply = (body, request, env, status = 200) => new Response(JSON.stringify(body), {
  status,
  // API responses include task state and must never be reused as an old
  // “生成中” snapshot by the browser or a CDN.
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(request, env) },
})
const failure = (message, request, env, status = 500) => reply({ error: message }, request, env, status)

function cors(request, env) {
  const requestedOrigin = request.headers.get('origin') || ''
  const allowedOrigin = env.ALLOWED_ORIGIN || '*'
  return {
    'access-control-allow-origin': allowedOrigin === '*' ? '*' : allowedOrigin === requestedOrigin ? requestedOrigin : allowedOrigin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

class HttpError extends Error { constructor(message, status = 400) { super(message); this.status = status } }

export class AvatarDownloadCounter {
  constructor(state) { this.state = state }

  async fetch(request) {
    const current = Number(await this.state.storage.get('count') || 0)
    if (request.method === 'POST') {
      const count = current + 1
      await this.state.storage.put('count', count)
      return Response.json({ count })
    }
    return Response.json({ count: current })
  }
}

async function avatarDownloadCount(request, env) {
  const id = env.AVATAR_DOWNLOAD_COUNTER.idFromName(AVATAR_DOWNLOAD_COUNTER_NAME)
  const response = await env.AVATAR_DOWNLOAD_COUNTER.get(id).fetch(new Request('https://avatar-download-counter/count', { method: request.method }))
  if (!response.ok) throw new HttpError('次数统计暂不可用', 503)
  return response.json()
}

function publicImageUrl(value) {
  let url
  try { url = new URL(String(value || '')) } catch { throw new HttpError('二维码链接格式不正确', 400) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new HttpError('仅支持公开的 HTTP/HTTPS 图片链接', 400)
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.local') || /^(?:0|10|127|169\.254|192\.168)\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || /^(?:fc|fd|fe8|fe9|fea|feb)/.test(host)) throw new HttpError('不允许访问内网图片地址', 400)
  return url
}

async function batchImage(request, env) {
  let url = publicImageUrl(new URL(request.url).searchParams.get('url'))
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(25_000), headers: { 'user-agent': 'Xiaodie-Batch-Composer/1.0' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new HttpError('图片地址重定向无效', 502)
      url = publicImageUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new HttpError(`图片下载失败（HTTP ${response.status}）`, 502)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('image/')) throw new HttpError('链接返回的不是图片', 415)
    const declaredSize = Number(response.headers.get('content-length'))
    if (declaredSize > 12 * 1024 * 1024) throw new HttpError('二维码图片超过 12MB', 413)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > 12 * 1024 * 1024) throw new HttpError('二维码图片超过 12MB', 413)
    return new Response(buffer, { headers: { 'content-type': contentType, 'cache-control': 'private, max-age=300', ...cors(request, env) } })
  }
  throw new HttpError('图片地址重定向次数过多', 502)
}

const TENCENT_DOCS_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const MAX_ONLINE_SHEET_ROWS = 5_000
const MAX_ONLINE_SHEET_BYTES = 20 * 1024 * 1024

function publicTencentSmartSheetUrl(value) {
  let url
  try { url = new URL(String(value || '')) } catch { throw new HttpError('请输入有效的腾讯文档链接', 400) }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'docs.qq.com' || !/^\/smartsheet\/[^/]+/i.test(url.pathname)) {
    throw new HttpError('目前仅支持公开的腾讯文档“智能表格”链接', 400)
  }
  return url
}

function responseCookies(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || '']
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

async function inflateTencentSheet(value) {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return JSON.parse(await new Response(stream).text())
}

async function tencentSheetRows(documentData) {
  const compressed = documentData?.clientVars?.collab_client_vars?.initialAttributedText?.text?.find((item) => item?.smartsheet)?.smartsheet
  if (!compressed) throw new HttpError('未找到可读取的表格数据，请确认链接已公开', 422)
  const decoded = await inflateTencentSheet(compressed)
  const [model, recordsChunk] = decoded?.[0] || []
  const sheet = model?.c?.k3
  const fields = sheet?.k3 || {}
  const orderedIds = sheet?.k4?.[0]?.k1?.k1 || []
  const records = recordsChunk?.c?.k2?.k1 || {}
  if (!Object.keys(fields).length || !orderedIds.length) throw new HttpError('在线表格数据格式暂不支持', 422)
  if (orderedIds.length > MAX_ONLINE_SHEET_ROWS) throw new HttpError(`在线表格共有 ${orderedIds.length.toLocaleString()} 条，单次最多支持 ${MAX_ONLINE_SHEET_ROWS.toLocaleString()} 条`, 413)
  const columns = Object.entries(fields).map(([id, field]) => ({ id, name: String(field?.k30 || id) }))
  const rows = orderedIds.map((recordId) => {
    const cells = records[recordId]?.k1 || {}
    return Object.fromEntries(columns.map(({ id, name }) => [name, onlineSheetCellValue(cells[id])]))
  })
  return { columns: columns.map(({ name }) => name), rows }
}

async function batchSpreadsheet(request, env) {
  const source = publicTencentSmartSheetUrl(new URL(request.url).searchParams.get('url'))
  const documentResponse = await fetch(source, {
    signal: AbortSignal.timeout(25_000),
    headers: { 'user-agent': TENCENT_DOCS_USER_AGENT, accept: 'text/html,application/xhtml+xml' },
  })
  if (!documentResponse.ok) throw new HttpError(`在线表格打开失败（HTTP ${documentResponse.status}）`, 502)
  const html = await documentResponse.text()
  const documentId = source.pathname.split('/').filter(Boolean).pop()
  const tab = source.searchParams.get('tab') || html.match(/\/dop-api\/opendoc\?tab=([^&"']+)/)?.[1] || ''
  if (!documentId || !tab) throw new HttpError('未识别到腾讯智能表格，请检查链接是否完整', 422)
  const endpoint = new URL('/dop-api/opendoc', source.origin)
  endpoint.search = new URLSearchParams({ tab, u: '', noEscape: '1', enableSmartsheetSplit: '1', supportOptimizedVer: '4', chunkCellSize: '15000', enableChunkRank: '1', startrow: '0', endrow: String(MAX_ONLINE_SHEET_ROWS), id: documentId, normal: '1', outformat: '1', wb: '1', nowb: '0', callback: 'clientVarsCallback', xsrf: '' }).toString()
  const dataResponse = await fetch(endpoint, {
    signal: AbortSignal.timeout(35_000),
    headers: { 'user-agent': TENCENT_DOCS_USER_AGENT, referer: source.toString(), cookie: responseCookies(documentResponse), accept: '*/*' },
  })
  if (!dataResponse.ok) throw new HttpError(dataResponse.status === 401 ? '腾讯文档拒绝读取，请将链接设为“获得链接的人可查看”后重试' : `在线表格读取失败（HTTP ${dataResponse.status}）`, 502)
  const size = Number(dataResponse.headers.get('content-length'))
  if (size > MAX_ONLINE_SHEET_BYTES) throw new HttpError('在线表格数据过大，请拆分后再导入', 413)
  const script = await dataResponse.text()
  if (script.length > MAX_ONLINE_SHEET_BYTES) throw new HttpError('在线表格数据过大，请拆分后再导入', 413)
  const callbackMatch = script.match(/^\s*clientVarsCallback\(([\s\S]+)\)\s*;?\s*$/)
  if (!callbackMatch) throw new HttpError('腾讯文档未返回可读取的数据，请确认链接公开且没有访问限制', 422)
  let documentData
  try { documentData = JSON.parse(callbackMatch[1]) } catch { throw new HttpError('在线表格数据解析失败', 422) }
  const data = await tencentSheetRows(documentData)
  const title = html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1] || '腾讯文档智能表格'
  return { ...data, title }
}
const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
function creditLimit(email) { return CREDIT_OVERRIDES.get(normalizeEmail(email)) ?? DEFAULT_CREDITS }
function bytesToHex(bytes) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
function randomToken(size = 32) { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function utf8Base64(value) { return btoa(String.fromCharCode(...new TextEncoder().encode(value))) }
async function sha256(value) { return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))) }
async function hashPassword(password, salt = randomToken(16)) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, material, 256)
  return `${salt}:${bytesToHex(derived)}`
}
async function passwordMatches(password, stored) {
  const salt = String(stored || '').split(':')[0]
  return Boolean(salt) && await hashPassword(password, salt) === stored
}
function bearer(request) { return request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '' }
function currentCreditDay() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
function refreshDailyCredits(user) {
  const today = currentCreditDay()
  const limit = creditLimit(user?.email)
  const hasCurrentCredits = user?.creditsUpdatedOn === today && Number.isInteger(user.credits) && user.credits >= 0
  if (hasCurrentCredits && user.creditLimit === limit) return false
  if (hasCurrentCredits && limit === DEFAULT_CREDITS) {
    user.creditLimit = limit
    return true
  }
  user.credits = limit
  user.creditLimit = limit
  user.creditsUpdatedOn = today
  return true
}
function userCredits(user) { return user?.creditsUpdatedOn === currentCreditDay() && Number.isInteger(user.credits) && user.credits >= 0 ? user.credits : creditLimit(user?.email) }
function publicUser(user) { return { id: user.id, email: user.email, credits: userCredits(user), createdAt: user.createdAt } }
function ensureWhitelisted(email) {
  if (!REGISTRATION_WHITELIST.has(email)) throw new HttpError('没有权限，请联系管理人员', 403)
}
async function spendCredits(env, user, amount) {
  const key = `${AUTH_USER_PREFIX}${user.email}`
  const current = await env.XIAODIE_TASKS.get(key, 'json')
  if (!current) throw new HttpError('请先登录', 401)
  refreshDailyCredits(current)
  if (current.credits < amount) throw new HttpError('积分不足，无法生成图片', 402)
  current.credits -= amount
  await env.XIAODIE_TASKS.put(key, JSON.stringify(current))
  return current
}
async function refundCredits(env, email, amount) {
  if (!amount || !email) return null
  const key = `${AUTH_USER_PREFIX}${email}`
  const current = await env.XIAODIE_TASKS.get(key, 'json')
  if (!current) return null
  refreshDailyCredits(current)
  current.credits = Math.min(creditLimit(current.email), current.credits + amount)
  await env.XIAODIE_TASKS.put(key, JSON.stringify(current))
  return current
}
async function authenticated(request, env) {
  const token = bearer(request)
  if (!token) return null
  const session = await env.XIAODIE_TASKS.get(`${AUTH_SESSION_PREFIX}${await sha256(token)}`, 'json')
  if (!session || session.expiresAt <= Date.now()) return null
  const user = await env.XIAODIE_TASKS.get(`${AUTH_USER_PREFIX}${session.email}`, 'json')
  if (user && refreshDailyCredits(user)) await env.XIAODIE_TASKS.put(`${AUTH_USER_PREFIX}${user.email}`, JSON.stringify(user))
  return user ? { user, session } : null
}
async function requireAuth(request, env) {
  const auth = await authenticated(request, env)
  if (!auth) throw new HttpError('请先登录', 401)
  return auth
}
async function issueSession(env, user, remember) {
  if (refreshDailyCredits(user)) await env.XIAODIE_TASKS.put(`${AUTH_USER_PREFIX}${user.email}`, JSON.stringify(user))
  const token = randomToken()
  const expiresAt = Date.now() + (remember ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000)
  await env.XIAODIE_TASKS.put(`${AUTH_SESSION_PREFIX}${await sha256(token)}`, JSON.stringify({ email: user.email, expiresAt }), { expirationTtl: Math.ceil((expiresAt - Date.now()) / 1000) })
  return { token, expiresAt, user: publicUser(user) }
}

function googleDriveReady(env) {
  return Boolean(env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET && env.GOOGLE_DRIVE_FOLDER_ID && env.GOOGLE_OAUTH_REDIRECT_URI)
}

async function googleDriveConfig(env) {
  if (!googleDriveReady(env)) return null
  const config = await env.XIAODIE_TASKS.get(GOOGLE_DRIVE_CONFIG_KEY, 'json')
  return config?.refreshToken ? config : null
}

async function googleDriveAccessToken(env) {
  const config = await googleDriveConfig(env)
  if (!config) return null
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new HttpError('Google Drive 授权已失效，请重新连接网盘', 503)
  return data.access_token
}

function driveImageUrl(fileId) { return `/api/google-drive/images/${encodeURIComponent(fileId)}` }
function driveVideoUrl(fileId) { return `/api/google-drive/videos/${encodeURIComponent(fileId)}` }
const DRIVE_MEDIA_FOLDERS = {
  uploads: '上传参考图',
  images: '生成图片',
  videos: '生成视频',
}

async function googleDriveMediaFolder(env, accessToken, bucket) {
  const name = DRIVE_MEDIA_FOLDERS[bucket] || DRIVE_MEDIA_FOLDERS.uploads
  const cacheKey = `${GOOGLE_DRIVE_FOLDER_CACHE_PREFIX}${bucket}`
  const cached = await env.XIAODIE_TASKS.get(cacheKey)
  if (cached) return cached
  const query = new URL('https://www.googleapis.com/drive/v3/files')
  query.search = new URLSearchParams({
    q: `'${env.GOOGLE_DRIVE_FOLDER_ID}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)', pageSize: '1',
  }).toString()
  const listed = await fetch(query, { headers: { authorization: `Bearer ${accessToken}` } })
  const existing = await listed.json().catch(() => ({}))
  let id = listed.ok ? existing.files?.[0]?.id : ''
  if (!id) {
    const create = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [env.GOOGLE_DRIVE_FOLDER_ID] }),
    })
    const folder = await create.json().catch(() => ({}))
    if (!create.ok || !folder.id) throw new Error(`创建 Google Drive 文件夹失败（HTTP ${create.status}）`)
    id = folder.id
  }
  await env.XIAODIE_TASKS.put(cacheKey, id, { expirationTtl: 7 * 24 * 60 * 60 })
  return id
}
function driveImageName(prefix, contentType) {
  const extension = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : contentType.includes('gif') ? 'gif' : 'png'
  return `${prefix}-${Date.now()}.${extension}`
}

async function persistGoogleDriveImage(env, sourceUrl, namePrefix, bucket = 'images') {
  const accessToken = await googleDriveAccessToken(env)
  if (!accessToken) return sourceUrl
  const folderId = await googleDriveMediaFolder(env, accessToken, bucket)
  const source = String(sourceUrl || '').startsWith('data:image/')
    ? (() => {
        const match = String(sourceUrl).match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/)
        if (!match) throw new HttpError('参考图格式无效', 400)
        const binary = atob(match[2])
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        return new Response(bytes, { headers: { 'content-type': match[1] } })
      })()
    : await fetch(sourceUrl)
  if (!source.ok) throw new Error(`图片保存失败（下载源文件 HTTP ${source.status}）`)
  const contentType = source.headers.get('content-type') || 'image/png'
  const boundary = `xiaodie-${randomToken(18)}`
  const metadata = JSON.stringify({
    name: driveImageName(namePrefix, contentType),
    mimeType: contentType,
    parents: [folderId],
    appProperties: { xiaodieAsset: 'image', xiaodieFolder: bucket },
  })
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    await source.arrayBuffer(),
    `\r\n--${boundary}--\r\n`,
  ])
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.id) throw new Error(`图片保存到 Google Drive 失败（HTTP ${response.status}）`)
  return driveImageUrl(data.id)
}

async function saveUploadedImage(request, env) {
  const { source, name = 'reference' } = await request.json()
  if (!String(source || '').startsWith('data:image/')) throw new HttpError('请上传有效的图片文件', 400)
  const safeName = String(name || 'reference').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'reference'
  return { url: await persistGoogleDriveImage(env, source, `upload-${safeName}`, 'uploads') }
}

async function persistGoogleDriveVideo(env, sourceUrl, namePrefix) {
  const accessToken = await googleDriveAccessToken(env)
  if (!accessToken) return sourceUrl
  const folderId = await googleDriveMediaFolder(env, accessToken, 'videos')
  const source = await fetch(sourceUrl)
  if (!source.ok || !source.body) throw new Error(`视频保存失败（下载源文件 HTTP ${source.status}）`)
  const contentType = source.headers.get('content-type') || 'video/mp4'
  const contentLength = Number(source.headers.get('content-length'))
  if (!contentType.startsWith('video/') || !Number.isInteger(contentLength) || contentLength <= 0) throw new Error('视频源缺少可用的格式或文件大小，无法保存到 Google Drive')
  const metadata = JSON.stringify({
    name: `${namePrefix}-${Date.now()}.${contentType.includes('webm') ? 'webm' : 'mp4'}`,
    mimeType: contentType,
    parents: [folderId],
    appProperties: { xiaodieAsset: 'video', xiaodieFolder: 'videos' },
  })
  const create = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': contentType,
      'x-upload-content-length': String(contentLength),
    },
    body: metadata,
  })
  const uploadUrl = create.headers.get('location')
  if (!create.ok || !uploadUrl) throw new Error(`视频保存到 Google Drive 失败（创建上传 HTTP ${create.status}）`)
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': contentType,
      'content-length': String(contentLength),
      'content-range': `bytes 0-${contentLength - 1}/${contentLength}`,
    },
    body: source.body,
  })
  const data = await upload.json().catch(() => ({}))
  if (!upload.ok || !data.id) throw new Error(`视频保存到 Google Drive 失败（上传 HTTP ${upload.status}）`)
  return driveVideoUrl(data.id)
}

async function deleteExpiredGoogleDriveImages(env) {
  const accessToken = await googleDriveAccessToken(env)
  if (!accessToken) return
  let pageToken = ''
  do {
    const query = new URL('https://www.googleapis.com/drive/v3/files')
    query.search = new URLSearchParams({
      q: `'${env.GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,createdTime,appProperties)',
      pageSize: '100',
      pageToken,
    }).toString()
    const response = await fetch(query, { headers: { authorization: `Bearer ${accessToken}` } })
    if (!response.ok) throw new Error(`读取 Google Drive 图片列表失败（HTTP ${response.status}）`)
    const data = await response.json()
    const now = Date.now()
    const expired = (data.files || []).filter((file) => {
      if (file.appProperties?.xiaodieImage !== 'true' && file.appProperties?.xiaodieVideo !== 'true') return false
      const expiresAt = Number(file.appProperties?.expiresAt) || new Date(file.createdTime).getTime() + IMAGE_RETENTION_MS
      return Number.isFinite(expiresAt) && expiresAt <= now
    })
    await Promise.all(expired.map(async (file) => {
      const remove = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`, {
        method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` },
      })
      if (!remove.ok && remove.status !== 404) throw new Error(`删除过期 Google Drive 图片失败（HTTP ${remove.status}）`)
    }))
    pageToken = data.nextPageToken || ''
  } while (pageToken)
}

async function googleDriveImageResponse(request, env, fileId) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new HttpError('图片标识无效', 400)
  const accessToken = await googleDriveAccessToken(env)
  if (!accessToken) throw new HttpError('图片存储尚未连接 Google Drive', 503)
  const wantsThumbnail = new URL(request.url).searchParams.get('thumbnail') === '1'
  let response
  let thumbnail = false
  if (wantsThumbnail) {
    // The result grid must never decode four 4K originals at once. Drive
    // creates a lightweight image thumbnail for raster uploads; proxy it so
    // the private Drive folder remains private to the application.
    const metadata = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    const data = await metadata.json().catch(() => ({}))
    if (metadata.ok && data.thumbnailLink) {
      const thumbnailUrl = String(data.thumbnailLink).replace(/=s\d+(?:-[a-z]+)?$/i, '=w480')
      response = await fetch(thumbnailUrl, { method: request.method, headers: { authorization: `Bearer ${accessToken}` } })
      thumbnail = response.ok
    }
  }
  if (!response || !response.ok) {
    response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      method: request.method,
      headers: { authorization: `Bearer ${accessToken}` },
    })
  }
  if (!response.ok) throw new HttpError(response.status === 404 ? '图片不存在或已被删除' : '读取 Google Drive 图片失败', response.status === 404 ? 404 : 502)
  const headers = new Headers(cors(request, env))
  headers.set('content-type', response.headers.get('content-type') || 'image/png')
  headers.set('cache-control', thumbnail ? 'public, max-age=604800, immutable' : 'private, max-age=86400')
  return new Response(request.method === 'HEAD' ? null : response.body, { status: 200, headers })
}

async function googleDriveVideoResponse(request, env, fileId) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new HttpError('视频标识无效', 400)
  const accessToken = await googleDriveAccessToken(env)
  if (!accessToken) throw new HttpError('视频存储尚未连接 Google Drive', 503)
  const headers = { authorization: `Bearer ${accessToken}` }
  if (request.headers.get('range')) headers.range = request.headers.get('range')
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { method: request.method, headers })
  if (!response.ok) throw new HttpError(response.status === 404 ? '视频不存在或已被删除' : '读取 Google Drive 视频失败', response.status === 404 ? 404 : 502)
  const outputHeaders = new Headers(cors(request, env))
  outputHeaders.set('content-type', response.headers.get('content-type') || 'video/mp4')
  outputHeaders.set('cache-control', 'private, max-age=86400')
  outputHeaders.set('accept-ranges', 'bytes')
  for (const key of ['content-length', 'content-range']) if (response.headers.get(key)) outputHeaders.set(key, response.headers.get(key))
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: outputHeaders })
}

async function googleDriveAuthorizeUrl(env) {
  if (!googleDriveReady(env)) throw new HttpError('Google Drive 客户端密钥尚未配置', 503)
  const state = randomToken(24)
  await env.XIAODIE_TASKS.put(`${GOOGLE_DRIVE_STATE_PREFIX}${state}`, JSON.stringify({ createdAt: Date.now() }), { expirationTtl: 600 })
  const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorize.search = new URLSearchParams({
    client_id: env.GOOGLE_DRIVE_CLIENT_ID,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString()
  return authorize.toString()
}

async function beginGoogleDriveConnect(request, env) {
  if (!googleDriveReady(env)) throw new HttpError('Google Drive 客户端密钥尚未配置', 503)
  const url = new URL(request.url)
  if (url.searchParams.get('setup') !== env.GOOGLE_DRIVE_SETUP_TOKEN) throw new HttpError('网盘连接地址无效', 403)
  return Response.redirect(await googleDriveAuthorizeUrl(env), 302)
}

async function finishGoogleDriveConnect(request, env) {
  if (!googleDriveReady(env)) throw new HttpError('Google Drive 客户端密钥尚未配置', 503)
  const url = new URL(request.url)
  const state = url.searchParams.get('state') || ''
  const code = url.searchParams.get('code') || ''
  const stateKey = `${GOOGLE_DRIVE_STATE_PREFIX}${state}`
  const savedState = await env.XIAODIE_TASKS.get(stateKey, 'json')
  await env.XIAODIE_TASKS.delete(stateKey)
  if (!savedState || !code) throw new HttpError('Google Drive 授权已过期，请重新开始连接', 400)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.refresh_token) throw new HttpError('Google Drive 未返回长期授权，请重新连接', 502)
  await env.XIAODIE_TASKS.put(GOOGLE_DRIVE_CONFIG_KEY, JSON.stringify({ refreshToken: data.refresh_token, connectedAt: time() }))
  return new Response('<!doctype html><meta charset="utf-8"><title>小蝶</title><body style="font:16px system-ui;padding:40px">Google Drive 已连接。现在可以关闭此页面，之后生成的图片会自动保存到“小蝶图片库”。</body>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
async function sendVerificationEmail(env, email, code) {
  if (!env.SMTP_HOST || !env.SMTP_USERNAME || !env.SMTP_PASSWORD) {
    if (env.ENVIRONMENT === 'development') return false
    throw new HttpError('邮件服务尚未配置，请联系管理员', 503)
  }
  const socket = connect({ hostname: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465) }, { secureTransport: 'on', allowHalfOpen: false })
  const writer = socket.writable.getWriter()
  const reader = socket.readable.getReader()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffered = ''
  async function response() {
    while (true) {
      const lines = buffered.split('\r\n')
      for (let index = 0; index < lines.length - 1; index += 1) {
        if (/^\d{3} /.test(lines[index])) {
          const result = lines.slice(0, index + 1).join('\r\n')
          buffered = lines.slice(index + 1).join('\r\n')
          return result
        }
      }
      const chunk = await reader.read()
      if (chunk.done) throw new Error('SMTP 连接意外关闭')
      buffered += decoder.decode(chunk.value, { stream: true })
    }
  }
  async function command(value, expected) {
    if (value) await writer.write(encoder.encode(`${value}\r\n`))
    const result = await response()
    if (!expected.some((status) => result.startsWith(String(status)))) throw new Error(`邮件服务器拒绝请求 (${result.slice(0, 3)})`)
  }
  try {
    await command('', [220])
    await command(`EHLO ${env.SMTP_HELO || 'onewo.com'}`, [250])
    await command('AUTH LOGIN', [334])
    await command(btoa(env.SMTP_USERNAME), [334])
    await command(btoa(env.SMTP_PASSWORD), [235])
    await command(`MAIL FROM:<${env.SMTP_USERNAME}>`, [250])
    await command(`RCPT TO:<${email}>`, [250, 251])
    await command('DATA', [354])
    const html = `<div style="font-family:sans-serif;color:#1a2e1f"><h2>欢迎使用小蝶</h2><p>你的注册验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 10 分钟内有效。如非本人操作，请忽略此邮件。</p></div>`
    const subject = `=?UTF-8?B?${utf8Base64('小蝶注册验证码')}?=`
    await writer.write(encoder.encode(`From: 小蝶 <${env.SMTP_USERNAME}>\r\nTo: <${email}>\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n.\r\n`))
    const delivered = await response()
    if (!delivered.startsWith('250')) throw new Error('邮件服务器未接受验证码邮件')
    await command('QUIT', [221])
    return true
  } catch {
    throw new HttpError('验证码邮件发送失败，请稍后重试', 502)
  } finally {
    writer.releaseLock(); reader.releaseLock(); socket.close()
  }
}
async function requestCode(request, env) {
  const { email: input } = await request.json()
  const email = normalizeEmail(input)
  if (!EMAIL_PATTERN.test(email)) throw new HttpError('仅支持 @onewo.com 企业邮箱')
  ensureWhitelisted(email)
  if (await env.XIAODIE_TASKS.get(`${AUTH_USER_PREFIX}${email}`)) throw new HttpError('该邮箱已注册，请直接登录', 409)
  const key = `${AUTH_CODE_PREFIX}${email}`
  const previous = await env.XIAODIE_TASKS.get(key, 'json')
  if (previous?.sentAt > Date.now() - 60000) throw new HttpError('请 60 秒后再获取验证码', 429)
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000)
  const record = { codeHash: await sha256(code), attempts: 0, sentAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 }
  await env.XIAODIE_TASKS.put(key, JSON.stringify(record), { expirationTtl: 600 })
  const sent = await sendVerificationEmail(env, email, code)
  return { ok: true, ...(sent ? {} : { devCode: code }) }
}
async function register(request, env) {
  const body = await request.json()
  const email = normalizeEmail(body.email)
  const password = String(body.password || '')
  if (!EMAIL_PATTERN.test(email)) throw new HttpError('仅支持 @onewo.com 企业邮箱')
  ensureWhitelisted(email)
  if (!PASSWORD_PATTERN.test(password)) throw new HttpError('密码须为 8–64 位，且同时包含字母和数字')
  const userKey = `${AUTH_USER_PREFIX}${email}`
  if (await env.XIAODIE_TASKS.get(userKey)) throw new HttpError('该邮箱已注册，请直接登录', 409)
  const codeKey = `${AUTH_CODE_PREFIX}${email}`
  const record = await env.XIAODIE_TASKS.get(codeKey, 'json')
  if (!record || record.expiresAt <= Date.now()) throw new HttpError('验证码已过期，请重新获取')
  if (record.attempts >= 5) throw new HttpError('验证码错误次数过多，请重新获取', 429)
  if (record.codeHash !== await sha256(String(body.code || '').trim())) {
    record.attempts += 1
    await env.XIAODIE_TASKS.put(codeKey, JSON.stringify(record), { expirationTtl: Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000)) })
    throw new HttpError('验证码不正确')
  }
  const credits = creditLimit(email)
  const user = { id: crypto.randomUUID(), email, passwordHash: await hashPassword(password), credits, creditLimit: credits, creditsUpdatedOn: currentCreditDay(), createdAt: time() }
  await env.XIAODIE_TASKS.put(userKey, JSON.stringify(user))
  await env.XIAODIE_TASKS.delete(codeKey)
  return issueSession(env, user, Boolean(body.remember))
}
async function verifyCode(request, env) {
  const body = await request.json()
  const email = normalizeEmail(body.email)
  if (!EMAIL_PATTERN.test(email)) throw new HttpError('仅支持 @onewo.com 企业邮箱')
  ensureWhitelisted(email)
  const codeKey = `${AUTH_CODE_PREFIX}${email}`
  const record = await env.XIAODIE_TASKS.get(codeKey, 'json')
  if (!record || record.expiresAt <= Date.now()) throw new HttpError('验证码已过期，请重新获取')
  if (record.attempts >= 5) throw new HttpError('验证码错误次数过多，请重新获取', 429)
  if (record.codeHash !== await sha256(String(body.code || '').trim())) {
    record.attempts += 1
    await env.XIAODIE_TASKS.put(codeKey, JSON.stringify(record), { expirationTtl: Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000)) })
    throw new HttpError('验证码不正确')
  }
  return { ok: true }
}
async function login(request, env) {
  const body = await request.json()
  const email = normalizeEmail(body.email)
  const user = await env.XIAODIE_TASKS.get(`${AUTH_USER_PREFIX}${email}`, 'json')
  if (!user || !await passwordMatches(String(body.password || ''), user.passwordHash)) throw new HttpError('邮箱或密码不正确', 401)
  return issueSession(env, user, Boolean(body.remember))
}
async function changePassword(request, env) {
  const auth = await requireAuth(request, env)
  const body = await request.json()
  const currentPassword = String(body.currentPassword || '')
  const newPassword = String(body.newPassword || '')
  if (!await passwordMatches(currentPassword, auth.user.passwordHash)) throw new HttpError('当前密码不正确')
  if (!PASSWORD_PATTERN.test(newPassword)) throw new HttpError('新密码须为 8–64 位，且同时包含字母和数字')
  if (currentPassword === newPassword) throw new HttpError('新密码不能与当前密码相同')
  auth.user.passwordHash = await hashPassword(newPassword)
  await env.XIAODIE_TASKS.put(`${AUTH_USER_PREFIX}${auth.user.email}`, JSON.stringify(auth.user))
  return { ok: true }
}

function promptRatio(prompt) {
  const match = String(prompt || '').match(/(\d{1,2})\s*[:：比x×]\s*(\d{1,2})/i)
  const ratio = match ? `${Number(match[1])}:${Number(match[2])}` : '1:1'
  return SIZES[ratio] ? ratio : '1:1'
}

function imageDimensionsFromDataUrl(source) {
  const match = String(source || '').match(/^data:image\/[\w.+-]+;base64,([\s\S]+)$/)
  if (!match) return null
  const binary = atob(match[1])
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const read16 = (offset) => (bytes[offset] << 8) | bytes[offset + 1]
  const read24 = (offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
  const read32 = (offset) => ((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
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
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const type = String.fromCharCode(...bytes.slice(12, 16))
    if (type === 'VP8X') return { width: read24(24) + 1, height: read24(27) + 1 }
    if (type === 'VP8L' && bytes[20] === 0x2f) return { width: 1 + ((bytes[21] | (bytes[22] << 8)) & 0x3fff), height: 1 + (((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)) & 0x3fff) }
    if (type === 'VP8 ') return { width: read16(26) & 0x3fff, height: read16(28) & 0x3fff }
  }
  return null
}

function automaticImageRatio(source, prompt) {
  const dimensions = imageDimensionsFromDataUrl(source)
  if (!dimensions?.width || !dimensions?.height) return promptRatio(prompt)
  const target = dimensions.width / dimensions.height
  return Object.keys(SIZES).reduce((nearest, ratio) => Math.abs(Math.log((Number(ratio.split(':')[0]) / Number(ratio.split(':')[1])) / target)) < Math.abs(Math.log((Number(nearest.split(':')[0]) / Number(nearest.split(':')[1])) / target)) ? ratio : nearest, '1:1')
}

async function getTask(env, id) { return env.XIAODIE_TASKS.get(taskKey(id), 'json') }
async function updateTaskIndex(env, id) {
  const saved = await env.XIAODIE_TASKS.get(TASK_INDEX_KEY, 'json')
  const existing = Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : []
  const next = id ? [id, ...existing.filter((item) => item !== id)] : existing
  await env.XIAODIE_TASKS.put(TASK_INDEX_KEY, JSON.stringify(next.slice(0, MAX_TASKS)))
  return next.slice(0, MAX_TASKS)
}
function isExpiredFailedTask(task, now = Date.now()) {
  if (!['failed', 'timeout'].includes(task.status)) return false
  const finishedAt = new Date(task.completedAt || task.updatedAt || task.createdAt).getTime()
  return Number.isFinite(finishedAt) && finishedAt <= now - FAILED_TASK_TTL_SECONDS * 1000
}
async function putTask(env, task) {
  task.updatedAt = time()
  const expirationTtl = ['failed', 'timeout'].includes(task.status)
    ? FAILED_TASK_TTL_SECONDS
    : ['succeeded', 'partial', 'cancelled'].includes(task.status)
      ? IMAGE_RETENTION_SECONDS
      : 0
  const options = expirationTtl ? { expirationTtl } : undefined
  await env.XIAODIE_TASKS.put(taskKey(task.id), JSON.stringify(task), options)
  await updateTaskIndex(env, task.id)
  return task
}
async function refundTaskCredits(env, task, amount) {
  const remaining = Math.max(0, Number(task.chargedCredits || 0) - Number(task.refundedCredits || 0))
  const refundable = Math.min(amount, remaining)
  if (!refundable) return null
  task.refundedCredits = Number(task.refundedCredits || 0) + refundable
  return refundCredits(env, task.userEmail, refundable)
}
async function listTasks(env) {
  const savedIds = await env.XIAODIE_TASKS.get(TASK_INDEX_KEY, 'json')
  const indexedIds = Array.isArray(savedIds) ? savedIds.filter((id) => typeof id === 'string') : []
  // Always merge the KV keys with the index.  A transient read failure used to
  // shrink the index and make still-existing history disappear from the UI.
  const keys = await env.XIAODIE_TASKS.list({ prefix: KEY_PREFIX, limit: MAX_TASKS })
  const listedIds = keys.keys.map((key) => key.name.slice(KEY_PREFIX.length))
  const ids = [...new Set([...indexedIds, ...listedIds])].slice(0, MAX_TASKS)
  const loaded = await Promise.allSettled(ids.map((id) => getTask(env, id)))
  const tasks = loaded.filter((result) => result.status === 'fulfilled' && result.value).map((result) => result.value)
  const unreadableIds = loaded.flatMap((result, index) => result.status === 'rejected' ? [ids[index]] : [])
  const expired = tasks.filter((task) => isExpiredFailedTask(task))
  await Promise.all(expired.map((task) => env.XIAODIE_TASKS.delete(taskKey(task.id))))
  const activeTasks = tasks.filter((task) => !isExpiredFailedTask(task))
  const refreshedIds = [...activeTasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((task) => task.id)
  // Keep an unreadable key in the index for a later retry; do not make a
  // temporary KV error look like a deleted task.
  await env.XIAODIE_TASKS.put(TASK_INDEX_KEY, JSON.stringify([...new Set([...refreshedIds, ...unreadableIds])].slice(0, MAX_TASKS)))
  return activeTasks
}

async function upstream(env, endpoint, body) {
  if (!env.GRSAI_API_KEY) throw new Error('Worker 尚未配置 GRSAI_API_KEY')
  const bases = [...new Set([
    env.GRSAI_BASE_URL || 'https://grsaiapi.com',
    env.GRSAI_FALLBACK_BASE_URL || 'https://grsai.dakka.com.cn',
  ].map((base) => base.replace(/\/$/, '')))]
  let lastError

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${endpoint}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${env.GRSAI_API_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const raw = await response.text()
      let data
      try { data = JSON.parse(raw) } catch { data = { error: raw } }
      if (response.ok) return data

      const error = new Error(data?.error?.message || data?.error || data?.message || `上游服务错误 (${response.status})`)
      error.status = response.status
      lastError = error
      if (![502, 503, 504].includes(response.status)) throw error
    } catch (error) {
      lastError = error
      if (error.status && ![502, 503, 504].includes(error.status)) throw error
    }
  }
  throw lastError || new Error('上游服务暂时不可用')
}
async function upstreamResult(env, id) { return upstream(env, `/v1/api/result?id=${encodeURIComponent(id)}`) }

async function vibbit(env, pathname, options = {}) {
  if (!env.VIBBIT_OPENAPI_KEY) throw new HttpError('Worker 尚未配置 VIBBIT_OPENAPI_KEY', 503)
  const response = await fetch(`${(env.VIBBIT_OPENAPI_BASE_URL || VIBBIT_API_BASE).replace(/\/$/, '')}${pathname}`, {
    ...options,
    headers: { authorization: `Bearer ${env.VIBBIT_OPENAPI_KEY}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.code !== 200) throw new HttpError(data?.message || `Seedance 服务错误（HTTP ${response.status}）`, response.status >= 400 ? response.status : 502)
  return data.data || {}
}

function externalUrl(request, value) {
  try { return new URL(String(value || ''), request.url).toString() } catch { throw new HttpError('参考图片地址无效', 400) }
}

function detectedImageMime(bytes, declared = '') {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return declared
}

async function saveVideoReference(request, env) {
  const { source } = await request.json()
  const value = String(source || '')
  // 图片节点返回的是本站的 Google Drive 代理 URL。不要再绕回 HTTP 下载，
  // 直接用 Drive access token 读取，避免代理地址在 Worker 内部下载失败。
  const preparedSource = !value.startsWith('data:image/') && driveReferenceFileId(value)
    ? await driveReferenceForUpstream(env, value)
    : value
  const match = preparedSource.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/)
  let mimeType
  let bytes
  if (match) {
    const binary = atob(match[2])
    mimeType = match[1].toLowerCase()
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } else {
    let sourceUrl
    try { sourceUrl = new URL(preparedSource, request.url) } catch { throw new HttpError('参考图格式无效', 400) }
    if (sourceUrl.protocol !== 'https:') throw new HttpError('参考图地址必须使用 HTTPS', 400)
    const response = await fetch(sourceUrl.toString(), { redirect: 'follow' })
    if (!response.ok) throw new HttpError('参考图下载失败', 400)
    mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    bytes = new Uint8Array(await response.arrayBuffer())
  }
  if (!bytes.length || bytes.length > MAX_VIDEO_REFERENCE_BYTES) throw new HttpError('参考图必须小于 24MB', 413)
  mimeType = detectedImageMime(bytes, mimeType)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new HttpError('参考图仅支持 JPG、PNG 或 WebP', 400)
  const id = crypto.randomUUID()
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
  await Promise.all([
    env.XIAODIE_TASKS.put(`${VIDEO_ASSET_PREFIX}${id}`, bytes, { expirationTtl: VIDEO_ASSET_TTL_SECONDS }),
    env.XIAODIE_TASKS.put(`${VIDEO_ASSET_META_PREFIX}${id}`, JSON.stringify({ mimeType }), { expirationTtl: VIDEO_ASSET_TTL_SECONDS }),
  ])
  const publicOrigin = String(env.VIDEO_ASSET_PUBLIC_ORIGIN || new URL(request.url).origin).replace(/\/$/, '')
  return { url: new URL(`/api/video/assets/${id}.${extension}`, `${publicOrigin}/`).toString() }
}

async function videoReferenceResponse(request, env, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new HttpError('参考图标识无效', 400)
  const [asset, meta] = await Promise.all([env.XIAODIE_TASKS.get(`${VIDEO_ASSET_PREFIX}${id}`, 'arrayBuffer'), env.XIAODIE_TASKS.get(`${VIDEO_ASSET_META_PREFIX}${id}`, 'json')])
  if (!asset || !meta?.mimeType) throw new HttpError('参考图已过期', 404)
  const range = request.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/i)
  let start = 0
  let end = asset.byteLength - 1
  if (range) {
    start = range[1] ? Number(range[1]) : Math.max(0, asset.byteLength - Number(range[2] || 0))
    end = range[2] ? Math.min(asset.byteLength - 1, Number(range[2])) : end
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= asset.byteLength) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${asset.byteLength}`, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' } })
  }
  const body = range ? asset.slice(start, end + 1) : asset
  const headers = {
    'content-type': meta.mimeType,
    'content-length': String(end - start + 1),
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'x-content-type-options': 'nosniff',
  }
  if (range) headers['content-range'] = `bytes ${start}-${end}/${asset.byteLength}`
  return new Response(request.method === 'HEAD' ? null : body, { status: range ? 206 : 200, headers })
}

async function createVideoTask(request, env, user) {
  const { model, prompt, durationSeconds, resolution, aspectRatio, referenceMode, imageUrl, firstFrameImageUrl, lastFrameImageUrl, referenceImageUrls = [], omniReferenceTaskType } = await request.json()
  const spec = SEEDANCE_MODELS[model]
  if (!spec) throw new HttpError('仅支持 Seedance 2.0 和 Seedance 2.5', 400)
  if (!String(prompt || '').trim()) throw new HttpError('视频提示词不能为空', 400)
  if (!spec.resolutions.includes(resolution)) throw new HttpError('该模型不支持所选分辨率', 400)
  if (!SEEDANCE_ASPECT_RATIOS.has(aspectRatio)) throw new HttpError('画幅参数不支持', 400)
  const taskInput = { model, prompt: String(prompt).trim().slice(0, 30_000), duration_seconds: Number(durationSeconds), resolution, aspect_ratio: aspectRatio }
  if (taskInput.duration_seconds !== -1 && (!Number.isInteger(taskInput.duration_seconds) || taskInput.duration_seconds < 4 || taskInput.duration_seconds > spec.maxDuration)) throw new HttpError(`该模型时长应为 4–${spec.maxDuration} 秒，或自动`, 400)
  if (referenceMode === 'single' && imageUrl) taskInput.image_url = externalUrl(request, imageUrl)
  if (referenceMode === 'frames') {
    if (!firstFrameImageUrl) throw new HttpError('首帧模式至少需要一张参考图', 400)
    taskInput.first_frame_image_url = externalUrl(request, firstFrameImageUrl)
    if (lastFrameImageUrl) taskInput.last_frame_image_url = externalUrl(request, lastFrameImageUrl)
  }
  if (referenceMode === 'multi') {
    if (!Array.isArray(referenceImageUrls) || referenceImageUrls.length > (model.includes('2-5') ? 30 : 9)) throw new HttpError(`该模型最多支持 ${model.includes('2-5') ? 30 : 9} 张参考图`, 400)
    if (referenceImageUrls.length) taskInput.reference_image_urls = referenceImageUrls.map((item) => externalUrl(request, item))
  }
  if (model.includes('2-5') && omniReferenceTaskType) {
    if (!['auto', 'reference', 'edit', 'extend'].includes(omniReferenceTaskType)) throw new HttpError('2.5 任务类型不支持', 400)
    if (['edit', 'extend'].includes(omniReferenceTaskType)) throw new HttpError('当前工作台仅支持参考图片；2.5 的 edit / extend 还需要参考视频 URL', 400)
    taskInput.omni_reference_task_type = omniReferenceTaskType
    if (omniReferenceTaskType === 'auto') {
      if (!taskInput.reference_image_urls?.length) throw new HttpError('auto 模式需要至少一张全模态参考图', 400)
      taskInput.duration_seconds = -1
      taskInput.aspect_ratio = 'adaptive'
    }
  }
  const created = await vibbit(env, '/tasks', { method: 'POST', body: JSON.stringify({ task_type: 'SEEDANCE_VIDEO_GENERATION', input_info: { input: JSON.stringify(taskInput) } }) })
  if (!created.task_id) throw new HttpError('Seedance 未返回任务 ID', 502)
  await env.XIAODIE_TASKS.put(`${VIDEO_TASK_PREFIX}${created.task_id}`, JSON.stringify({ email: user.email }), { expirationTtl: VIDEO_TASK_TTL_SECONDS })
  return { taskId: created.task_id, status: 'PENDING' }
}

async function getVideoTask(request, env, user, id) {
  const local = await env.XIAODIE_TASKS.get(`${VIDEO_TASK_PREFIX}${id}`, 'json')
  if (!local || local.email !== user.email) throw new HttpError('视频任务不存在或无权访问', 404)
  if (local.status === 'COMPLETED' && local.videoUrl) return { taskId: id, status: 'COMPLETED', videoUrl: local.videoUrl, error: '', progress: 100 }
  const task = await vibbit(env, `/tasks/${encodeURIComponent(id)}`)
  let result = {}
  try { result = JSON.parse(task.task_result?.result || '{}') } catch { result = {} }
  const progressCandidates = [task.progress_percentage, task.progress_percent, task.progress, task.task_result?.progress_percentage, task.task_result?.progress_percent, task.task_result?.progress, result.progress_percentage, result.progress_percent, result.progress]
  const progress = progressCandidates.find((value) => Number.isInteger(value) && value >= 0 && value <= 100)
  if (task.status === 'COMPLETED') {
    if (!result.video_url) throw new HttpError('视频任务已完成，但未返回视频地址', 502)
    const videoUrl = await persistGoogleDriveVideo(env, result.video_url, `video-${id}`)
    await env.XIAODIE_TASKS.put(`${VIDEO_TASK_PREFIX}${id}`, JSON.stringify({ ...local, status: 'COMPLETED', videoUrl }), { expirationTtl: VIDEO_RESULT_TTL_SECONDS })
    return { taskId: task.task_id || id, status: task.status, videoUrl, error: '', progress: 100 }
  }
  if (task.status === 'FAILED') await env.XIAODIE_TASKS.delete(`${VIDEO_TASK_PREFIX}${id}`)
  return { taskId: task.task_id || id, status: task.status, videoUrl: '', error: result.error_message || '', progress: progress ?? null }
}

function searchQueryFromMessages(messages, requestedQuery) {
  if (typeof requestedQuery === 'string' && requestedQuery.trim()) return requestedQuery.trim().slice(0, 600)
  const lastUserMessage = [...messages].reverse().find((message) => message?.role === 'user')
  if (typeof lastUserMessage?.content === 'string') return lastUserMessage.content.trim().slice(0, 600)
  if (Array.isArray(lastUserMessage?.content)) return lastUserMessage.content.find((part) => part?.type === 'text' && typeof part.text === 'string')?.text?.trim().slice(0, 600) || ''
  return ''
}

async function searchWeb(env, query) {
  if (!env.TAVILY_API_KEY) throw new HttpError('联网搜索尚未配置 TAVILY_API_KEY，请在 Worker 添加 Tavily 密钥后重试', 503)
  if (!query) throw new HttpError('未找到可用于联网搜索的问题')
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.TAVILY_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false, include_raw_content: false }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new HttpError(data?.detail || data?.error || `联网搜索服务错误 (${response.status})`, response.status === 401 || response.status === 403 ? 503 : response.status)
  const seen = new Set()
  return (data.results || []).filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url)).slice(0, 5).map((item) => ({
    title: String(item.title || item.url).slice(0, 200), url: item.url, content: String(item.content || '').slice(0, 1_200),
  }))
}

function webSourcesPrompt(sources) {
  if (!sources.length) return '已执行联网检索，但没有找到足够可靠的结果。请明确说“联网检索未找到可靠结果”，不要说自己没有联网搜索工具，也不要编造实时信息。'
  return `已完成联网检索。以下是本次检索到的实时资料，必须优先基于这些资料作答；不要声称自己无法联网搜索或没有实时搜索工具。若资料之间有差异，请说明差异。不要捏造来源中没有的信息。不要输出 URL、来源编号或 Markdown 符号（例如 **、#、-）。使用可直接复制的简洁中文自然段；如有多个要点，以“要点名：内容”的短句呈现。\n\n${sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.content}`).join('\n\n')}`
}

function validateReference(source) {
  if (typeof source !== 'string') throw new Error('参考图格式无效')
  const match = source.match(/^data:image\/[\w.+-]+;base64,([\s\S]+)$/)
  if (match && Math.ceil(match[1].length * 0.75) > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB')
  return source
}

function driveReferenceFileId(source) {
  let pathname
  try { pathname = new URL(String(source || ''), 'https://xiaodie.local').pathname } catch { return '' }
  return pathname.match(/^\/api\/google-drive\/images\/([A-Za-z0-9_-]{10,200})$/)?.[1] || ''
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function driveReferenceForUpstream(env, source) {
  const fileId = driveReferenceFileId(source)
  if (!fileId) return validateReference(source)
  const accessToken = await googleDriveAccessToken(env)
  if (!accessToken) throw new HttpError('图片存储尚未连接 Google Drive', 503)
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new HttpError(response.status === 404 ? '参考图不存在或已被删除' : '读取 Google Drive 参考图失败', response.status === 404 ? 404 : 502)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 10 * 1024 * 1024) throw new HttpError('图片不能超过 10MB', 400)
  const contentType = response.headers.get('content-type') || 'image/png'
  return `data:${contentType};base64,${bytesToBase64(bytes)}`
}

function settle(task) {
  if (task.status !== 'running' || task.slots.some((slot) => slot.status === 'running')) return false
  const succeeded = task.slots.filter((slot) => slot.status === 'succeeded').length
  task.status = succeeded === task.slots.length ? 'succeeded' : succeeded > 0 ? 'partial' : 'failed'
  task.completedAt = time()
  return true
}
function assetSyncCanResume(slot) {
  const startedAt = new Date(slot?.driveSyncStartedAt || '').getTime()
  return !Number.isFinite(startedAt) || Date.now() - startedAt > 30_000
}
async function persistWaterfallResult(env, taskId, slotIndex, sourceUrl) {
  try {
    const storedUrl = await persistGoogleDriveImage(env, sourceUrl, `waterfall-${taskId}-${slotIndex}`)
    const latest = await getTask(env, taskId)
    const slot = latest?.slots?.[slotIndex]
    if (!latest || !slot || slot.status !== 'succeeded' || slot.url !== sourceUrl) return
    Object.assign(slot, { url: storedUrl, driveSyncPending: false, driveSyncStartedAt: null })
    await putTask(env, latest)
  } catch (error) {
    console.error('瀑布流结果存储到 Google Drive 失败', error)
    // Keep the already-visible upstream result.  Storage synchronisation is a
    // background concern and must never turn a completed picture into a
    // failure card; it will be retried after the short cooldown.
  }
}

async function queuePendingWaterfallAssetSync(env, taskId, slotIndex, ctx) {
  const task = await getTask(env, taskId)
  const slot = task?.slots?.[slotIndex]
  if (!task || !slot || slot.status !== 'succeeded' || !slot.url || !slot.driveSyncPending || !assetSyncCanResume(slot)) return false
  slot.driveSyncStartedAt = time()
  await putTask(env, task)
  ctx.waitUntil(persistWaterfallResult(env, task.id, slot.index, slot.url))
  return true
}

async function refreshTask(env, task, ctx) {
  if (task.status !== 'running') return task
  if (Date.now() - new Date(task.createdAt).getTime() > 10 * 60 * 1000) {
    task.status = 'timeout'
    task.completedAt = time()
    task.slots = task.slots.map((slot) => slot.status === 'running' ? { ...slot, status: 'timeout', error: '生成超过 10 分钟，已自动结束' } : slot)
    const timedOut = task.slots.filter((slot) => slot.status === 'timeout').length
    task.refundedCount = Number(task.refundedCount || 0) + timedOut
    await refundTaskCredits(env, task, timedOut)
    return putTask(env, task)
  }

  // Poll every slot concurrently.  The previous serial loop made one slow
  // upstream status check hold every other image and every following task.
  const updates = await Promise.all(task.slots.map(async (slot) => {
    if (slot.status !== 'running' || !slot.upstreamId) return null
    try {
      const result = await upstreamResult(env, slot.upstreamId)
      const status = String(result.status || result.data?.status || '').toLowerCase()
      const resultUrl = result.results?.[0]?.url || result.data?.results?.[0]?.url || result.result?.url || result.data?.url || result.url
      if (!status || ['running', 'pending', 'queued', 'processing'].includes(status)) return null
      if (['succeeded', 'completed', 'success'].includes(status) && resultUrl) return { index: slot.index, status: 'succeeded', url: resultUrl }
      return { index: slot.index, status: 'failed', error: result.error || result.data?.error || '生成失败' }
    } catch (error) {
      // A transient poll failure must not turn a still-running upstream task
      // into a permanent failure.  The next five-second poll will retry it.
      console.warn('瀑布流任务状态查询失败，将重试', task.id, slot.index, error)
      return null
    }
  }))
  const completed = updates.filter(Boolean)
  if (!completed.length) return task

  // Merge every slot result into one current KV record, then write once. This
  // avoids concurrent slot updates overwriting each other.
  const latest = await getTask(env, task.id)
  if (!latest || latest.status !== 'running') return latest || task
  let changed = false
  let failedCount = 0
  const pendingAssetSyncs = []
  for (const update of completed) {
    const slot = latest.slots?.[update.index]
    if (!slot || slot.status !== 'running' || slot.upstreamId !== task.slots?.[update.index]?.upstreamId) continue
    if (update.status === 'succeeded') {
      // Display the completed upstream image immediately.  Drive persistence
      // starts after the task record is written and never blocks this response.
      Object.assign(slot, { status: 'succeeded', url: update.url, completedAt: time(), driveSyncPending: true, driveSyncStartedAt: time() })
      pendingAssetSyncs.push({ index: slot.index, url: update.url })
    } else {
      Object.assign(slot, { status: 'failed', error: update.error })
      failedCount += 1
    }
    changed = true
  }
  if (!changed) return latest
  if (failedCount) {
    latest.refundedCount = Number(latest.refundedCount || 0) + failedCount
    await refundTaskCredits(env, latest, failedCount)
  }
  settle(latest)
  await putTask(env, latest)
  for (const sync of pendingAssetSyncs) ctx?.waitUntil(persistWaterfallResult(env, latest.id, sync.index, sync.url))
  return latest
}

async function generateImage(request, env, user) {
  const { prompt, images = [], aspectRatio = 'auto', model, resolution } = await request.json()
  if (!prompt || typeof prompt !== 'string') throw new Error('prompt 不能为空')
  if (!Array.isArray(images) || images.length > 4) throw new Error('参考图最多 4 张')
  const settings = imageModelSettings(model, resolution)
  const chargedUser = await spendCredits(env, user, 1)
  try {
    const upstreamImages = await Promise.all(images.map((source) => driveReferenceForUpstream(env, source)))
    const resolvedAspectRatio = aspectRatio === 'auto' ? automaticImageRatio(upstreamImages[0], prompt) : SIZES[aspectRatio] ? aspectRatio : '1:1'
    const data = await upstream(env, '/v1/api/generate', {
      model: settings.model,
      prompt: prompt.slice(0, 30_000),
      images: upstreamImages,
      aspectRatio: generationSize(settings.model, settings.resolution, resolvedAspectRatio),
      replyType: 'json',
    })
    const urls = (data.results || []).map((result) => result?.url).filter(Boolean)
    if (data.status !== 'succeeded' || !urls.length) throw new Error(data.error || '图片生成未成功')
    return { id: data.id, status: data.status, aspectRatio: resolvedAspectRatio, model: settings.model, resolution: settings.resolution, urls: await Promise.all(urls.map((url, index) => persistGoogleDriveImage(env, url, `image-${data.id || 'result'}-${index + 1}`))), user: publicUser(chargedUser) }
  } catch (error) {
    await refundCredits(env, chargedUser.email, 1)
    throw error
  }
}

async function generateText(request, env) {
  const { messages, systemPrompt, webSearch, searchQuery } = await request.json()
  if (!Array.isArray(messages) || !messages.length) throw new Error('messages 不能为空')
  const sources = webSearch ? await searchWeb(env, searchQueryFromMessages(messages, searchQuery)) : []
  const combinedSystemPrompt = [systemPrompt, webSearch ? webSourcesPrompt(sources) : ''].filter(Boolean).join('\n\n')
  const data = await upstream(env, '/v1/chat/completions', {
    model: TEXT_MODEL, stream: false,
    messages: [
      ...(combinedSystemPrompt ? [{ role: 'system', content: combinedSystemPrompt.slice(0, 18_000) }] : []),
      ...messages.filter((message) => ['user', 'assistant'].includes(message.role)),
    ],
  })
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('接口未返回有效文本')
  return { content, sources, usage: data.usage || null, model: data.model || TEXT_MODEL }
}

function hasUnsubmittedSlots(task) {
  return task?.status === 'running' && task.slots?.some((slot) => slot.status === 'running' && !slot.upstreamId)
}

function submissionCanResume(task) {
  const lastStarted = new Date(task?.submissionStartedAt || '').getTime()
  return !Number.isFinite(lastStarted) || Date.now() - lastStarted > 60_000
}

async function queuePendingWaterfallSubmission(env, taskId, ctx) {
  const task = await getTask(env, taskId)
  if (!hasUnsubmittedSlots(task) || !submissionCanResume(task)) return false
  task.submissionStartedAt = time()
  await putTask(env, task)
  ctx.waitUntil(submitPendingWaterfallSlots(env, task.id))
  return true
}

async function submitPendingWaterfallSlots(env, taskId) {
  const initialTask = await getTask(env, taskId)
  if (!hasUnsubmittedSlots(initialTask)) return

  let upstreamImages
  try {
    upstreamImages = await Promise.all((initialTask.referenceImages || []).map((source) => driveReferenceForUpstream(env, source)))
  } catch (error) {
    const task = await getTask(env, taskId)
    if (!task) return
    let refunded = 0
    for (const slot of task.slots) {
      if (slot.status !== 'running' || slot.upstreamId) continue
      Object.assign(slot, { status: 'failed', error: error.message || '读取参考图失败' })
      refunded += 1
    }
    if (refunded) {
      task.refundedCount = Number(task.refundedCount || 0) + refunded
      await refundTaskCredits(env, task, refunded)
    }
    settle(task)
    await putTask(env, task)
    return
  }

  const taskModel = initialTask.model || 'gpt-image-2-vip'
  const taskResolution = initialTask.resolution || '2k'
  const payload = {
    model: taskModel,
    prompt: initialTask.prompt,
    images: upstreamImages,
    aspectRatio: initialTask.generationSize || generationSize(taskModel, taskResolution, initialTask.resolvedAspectRatio || '1:1'),
  }
  // Submit all image slots at once.  This is deliberately unbounded at four:
  // the product limit is four cards, and serial submission was the reason a
  // waterfall looked like it could generate only one task at a time.
  const submissions = await Promise.all(initialTask.slots.map(async (slot) => {
    if (slot.status !== 'running' || slot.upstreamId) return null
    try {
      const result = await upstream(env, '/v1/api/generate', { ...payload, replyType: 'async' })
      if (!result.id) throw new Error(result.error || '上游未返回任务编号')
      return { index: slot.index, upstreamId: result.id }
    } catch (error) {
      // Never turn a temporary upstream overload into a long synchronous
      // request.  Keeping the slot pending lets the regular background retry
      // submit it later without making the browser report a false failure.
      if ([502, 503, 504].includes(Number(error?.status))) return { index: slot.index, retryable: true }
      return { index: slot.index, error: error.message || '生成失败' }
    }
  }))

  const latest = await getTask(env, taskId)
  if (!latest || latest.status !== 'running') return
  let changed = false
  let failedCount = 0
  const pendingAssetSyncs = []
  for (const submission of submissions.filter(Boolean)) {
    const slot = latest.slots?.[submission.index]
    if (!slot || slot.status !== 'running' || slot.upstreamId) continue
    if (submission.upstreamId) {
      slot.upstreamId = submission.upstreamId
    } else if (submission.retryable) {
      // Release the submission lock so the next background refresh retries it.
      latest.submissionStartedAt = null
      changed = true
      continue
    } else if (submission.url) {
      Object.assign(slot, { status: 'succeeded', url: submission.url, completedAt: time(), delivery: submission.delivery, driveSyncPending: true, driveSyncStartedAt: time() })
      pendingAssetSyncs.push({ index: slot.index, url: submission.url })
    } else {
      Object.assign(slot, { status: 'failed', error: submission.error })
      failedCount += 1
    }
    changed = true
  }
  if (!changed) return
  if (failedCount) {
    latest.refundedCount = Number(latest.refundedCount || 0) + failedCount
    await refundTaskCredits(env, latest, failedCount)
  }
  settle(latest)
  await putTask(env, latest)
  // This function already runs under the original request's waitUntil.  The
  // result card has been saved above; Drive upload can continue afterwards.
  await Promise.allSettled(pendingAssetSyncs.map((sync) => persistWaterfallResult(env, latest.id, sync.index, sync.url)))
}

async function createTask(request, env, user, ctx) {
  const { prompt, images = [], aspectRatio = 'auto', count = 2, model, resolution, clientRequestId } = await request.json()
  const imageCount = Number(count)
  if (!prompt || typeof prompt !== 'string') throw new Error('提示词不能为空')
  if (!Array.isArray(images) || images.length > 9) throw new Error('参考图最多 9 张')
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 4) throw new Error('生成数量必须为 1 至 4 张')
  const settings = imageModelSettings(model, resolution)

  const validatedImages = images.map(validateReference)
  const firstReference = validatedImages[0] ? await driveReferenceForUpstream(env, validatedImages[0]) : ''
  const id = crypto.randomUUID()
  const resolvedAspectRatio = aspectRatio === 'auto' ? automaticImageRatio(firstReference, prompt) : SIZES[aspectRatio] ? aspectRatio : '1:1'
  const referenceImages = await Promise.all(validatedImages.map((source, index) => {
    const driveFileId = driveReferenceFileId(source)
    return driveFileId ? driveImageUrl(driveFileId) : persistGoogleDriveImage(env, source, `waterfall-reference-${id}-${index + 1}`, 'uploads')
  }))
  const chargedUser = await spendCredits(env, user, imageCount)
  const task = {
    id, userEmail: chargedUser.email, prompt: prompt.trim().slice(0, 30_000), aspectRatio, resolvedAspectRatio, model: settings.model, resolution: settings.resolution, generationSize: generationSize(settings.model, settings.resolution, resolvedAspectRatio),
    count: imageCount, referenceCount: images.length, referenceImages, status: 'running', clientRequestId: typeof clientRequestId === 'string' ? clientRequestId.slice(0, 96) : null,
    createdAt: time(), updatedAt: time(), completedAt: null, chargedCredits: imageCount, refundedCredits: 0, refundedCount: 0,
    slots: Array.from({ length: imageCount }, (_, index) => ({ index, status: 'running', url: null, error: null, upstreamId: null })),
  }
  task.submissionStartedAt = time()
  await putTask(env, task)
  // A task is durable before the browser is answered. Upstream submission is
  // background work: it must not make a user wait for, or falsely fail on, a
  // slow generation provider.
  ctx.waitUntil(submitPendingWaterfallSlots(env, task.id).catch((error) => console.error('瀑布流任务提交失败，将自动重试', task.id, error)))
  return { task, user: publicUser((await env.XIAODIE_TASKS.get(`${AUTH_USER_PREFIX}${chargedUser.email}`, 'json')) || chargedUser) }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname } = url
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) })
    try {
      if (pathname === '/api/health' && request.method === 'GET') return reply({ ok: true, apiConfigured: Boolean(env.GRSAI_API_KEY) }, request, env)
      if (pathname === '/api/please-day/avatar-downloads' && ['GET', 'POST'].includes(request.method)) return reply(await avatarDownloadCount(request, env), request, env)
      if (pathname === '/api/google-drive/connect' && request.method === 'GET') return await beginGoogleDriveConnect(request, env)
      if (pathname === '/api/google-drive/callback' && request.method === 'GET') return await finishGoogleDriveConnect(request, env)
      const driveImageMatch = pathname.match(/^\/api\/google-drive\/images\/([A-Za-z0-9_-]{10,200})$/)
      if (driveImageMatch && ['GET', 'HEAD'].includes(request.method)) return await googleDriveImageResponse(request, env, driveImageMatch[1])
      const driveVideoMatch = pathname.match(/^\/api\/google-drive\/videos\/([A-Za-z0-9_-]{10,200})$/)
      if (driveVideoMatch && ['GET', 'HEAD'].includes(request.method)) return await googleDriveVideoResponse(request, env, driveVideoMatch[1])
      if (pathname === '/api/auth/register/code' && request.method === 'POST') return reply(await requestCode(request, env), request, env)
      if (pathname === '/api/auth/register/verify' && request.method === 'POST') return reply(await verifyCode(request, env), request, env)
      if (pathname === '/api/auth/register' && request.method === 'POST') return reply(await register(request, env), request, env, 201)
      if (pathname === '/api/auth/login' && request.method === 'POST') return reply(await login(request, env), request, env)
      if (pathname === '/api/auth/me' && request.method === 'GET') {
        const auth = await requireAuth(request, env)
        return reply({ user: publicUser(auth.user), expiresAt: auth.session.expiresAt }, request, env)
      }
      if (pathname === '/api/auth/password' && request.method === 'POST') return reply(await changePassword(request, env), request, env)
      if (pathname === '/api/auth/logout' && request.method === 'POST') {
        const token = bearer(request)
        if (token) await env.XIAODIE_TASKS.delete(`${AUTH_SESSION_PREFIX}${await sha256(token)}`)
        return reply({ ok: true }, request, env)
      }
      const videoAssetMatch = pathname.match(/^\/api\/video\/assets\/([a-f0-9-]{36})(?:\.(?:jpg|png|webp))?$/i)
      if (videoAssetMatch && ['GET', 'HEAD'].includes(request.method)) return await videoReferenceResponse(request, env, videoAssetMatch[1])
      const protectedRoute = ['/api/image', '/api/text', '/api/waterfall/tasks', '/api/video/references', '/api/video/tasks', '/api/google-drive/uploads', '/api/google-drive/reconnect'].includes(pathname) || /^\/api\/(?:waterfall|video)\/tasks\/[^/]+$/.test(pathname)
      const auth = protectedRoute ? await requireAuth(request, env) : null
      if (pathname === '/api/batch-image' && request.method === 'GET') return await batchImage(request, env)
      if (pathname === '/api/batch-spreadsheet' && request.method === 'GET') return reply(await batchSpreadsheet(request, env), request, env)
      if (pathname === '/api/image' && request.method === 'POST') return reply(await generateImage(request, env, auth.user), request, env)
      if (pathname === '/api/text' && request.method === 'POST') return reply(await generateText(request, env), request, env)
      if (pathname === '/api/google-drive/reconnect' && request.method === 'POST') {
        if (auth.user.email !== 'zhangwj159@onewo.com') throw new HttpError('仅管理员可重新连接共享网盘', 403)
        return reply({ url: await googleDriveAuthorizeUrl(env) }, request, env)
      }
      if (pathname === '/api/google-drive/uploads' && request.method === 'POST') return reply(await saveUploadedImage(request, env), request, env, 201)
      if (pathname === '/api/video/references' && request.method === 'POST') return reply(await saveVideoReference(request, env), request, env, 201)
      if (pathname === '/api/video/tasks' && request.method === 'POST') return reply(await createVideoTask(request, env, auth.user), request, env, 202)
      const videoTaskMatch = pathname.match(/^\/api\/video\/tasks\/([^/]+)$/)
      if (videoTaskMatch && request.method === 'GET') return reply(await getVideoTask(request, env, auth.user, decodeURIComponent(videoTaskMatch[1])), request, env)
      if (pathname === '/api/waterfall/tasks' && request.method === 'POST') return reply(await createTask(request, env, auth.user, ctx), request, env, 202)
      if (pathname === '/api/waterfall/tasks' && request.method === 'GET') {
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
        // The initial waterfall view is always a useful full batch.  This
        // also prevents an old cached client from asking for only six records.
        const limit = Math.min(MAX_TASKS, Math.max(20, Number(url.searchParams.get('limit')) || 20))
        let tasks = (await listTasks(env)).filter((task) => task.userEmail === auth.user.email)
        tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        const total = tasks.length
        // Do not let an old, slow task hold up the current view.  The client
        // asks for the newest visible tasks first; only those are submitted /
        // refreshed on this request.
        let visibleTasks = tasks.slice(offset, offset + limit)
        // Loading history must remain read-fast.  Submission is guaranteed
        // during task creation; any legacy recovery stays in the background
        // and never holds the visible list hostage.
        await Promise.all(visibleTasks
          .filter((task) => hasUnsubmittedSlots(task) && submissionCanResume(task))
          .map((task) => queuePendingWaterfallSubmission(env, task.id, ctx)))
        // Keep Drive archival in the background.  It must not delay a result
        // card that the upstream generator has already completed.
        for (const task of visibleTasks) for (const slot of task.slots || []) {
          if (slot.status === 'succeeded' && slot.driveSyncPending && slot.url) ctx.waitUntil(queuePendingWaterfallAssetSync(env, task.id, slot.index, ctx))
        }
        // History must be returned immediately.  Polling an upstream generator
        // can be slow; do it after this response instead of holding every
        // historical card behind one running task.
        for (const task of visibleTasks) {
          if (task.status === 'running') ctx.waitUntil(refreshTask(env, task, ctx))
        }
        const latestUser = await env.XIAODIE_TASKS.get(`${AUTH_USER_PREFIX}${auth.user.email}`, 'json')
        return reply({ tasks: visibleTasks, total, hasMore: offset + limit < total, user: publicUser(latestUser || auth.user) }, request, env)
      }
      const match = pathname.match(/^\/api\/waterfall\/tasks\/([^/]+)$/)
      if (match && request.method === 'DELETE') {
        const task = await getTask(env, decodeURIComponent(match[1]))
        if (!task) return failure('任务不存在', request, env, 404)
        if (task.status === 'running') {
          const unfinished = task.slots.filter((slot) => slot.status === 'running').length
          task.status = 'cancelled'; task.completedAt = time(); task.refundedCount += unfinished
          task.slots = task.slots.map((slot) => slot.status === 'running' ? { ...slot, status: 'cancelled', error: '任务已停止' } : slot)
          await refundTaskCredits(env, task, unfinished)
          await putTask(env, task)
        }
        const latestUser = await env.XIAODIE_TASKS.get(`${AUTH_USER_PREFIX}${auth.user.email}`, 'json')
        return reply({ task, user: publicUser(latestUser || auth.user) }, request, env)
      }
      return failure('接口不存在', request, env, 404)
    } catch (error) {
      return failure(error.message || '服务暂时不可用', request, env, error.status || 500)
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      deleteExpiredGoogleDriveImages(env),
      listTasks(env),
    ]).catch((error) => console.error('清理过期数据失败', error)))
  },
}
