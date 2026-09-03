import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import tls from 'node:tls'

const EMAIL_PATTERN = /^[^\s@]+@onewo\.com$/i
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,64}$/
const CODE_TTL = 10 * 60 * 1000
const SHORT_SESSION_TTL = 12 * 60 * 60 * 1000
const REMEMBER_SESSION_TTL = 30 * 24 * 60 * 60 * 1000
const DEFAULT_CREDITS = 50
const REGISTRATION_WHITELIST = new Set([
  'zhoumt10@onewo.com', 'chenjl76@onewo.com', 'cheny453@onewo.com',
  'helg03@onewo.com', 'huangjq59@onewo.com', 'ligy70@onewo.com',
  'yem15@onewo.com', 'zhangwj159@onewo.com', 'zhouz76@onewo.com', 'wangnf@onewo.com',
])

function normalizeEmail(value) { return String(value || '').trim().toLowerCase() }
function currentCreditDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function tokenHash(value) { return createHash('sha256').update(value).digest('hex') }
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
function passwordMatches(password, stored) {
  const [salt, expectedHex] = String(stored || '').split(':')
  if (!salt || !expectedHex) return false
  const actual = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHex, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
function bearer(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

export function installAuth(app, { dataDir }) {
  const storeFile = path.join(dataDir, 'auth.json')
  fs.mkdirSync(dataDir, { recursive: true })
  let store = { users: [], codes: [], sessions: [] }
  try { store = { ...store, ...JSON.parse(fs.readFileSync(storeFile, 'utf8')) } } catch { /* first run */ }

  function save() { fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), { mode: 0o600 }) }
  let migratedCredits = false
  for (const user of store.users) {
    if (!Number.isInteger(user.credits) || user.credits < 0 || user.creditsUpdatedOn !== currentCreditDay()) {
      user.credits = DEFAULT_CREDITS
      user.creditsUpdatedOn = currentCreditDay()
      migratedCredits = true
    }
  }
  if (migratedCredits) save()
  function cleanup() {
    const now = Date.now()
    store.codes = store.codes.filter((item) => item.expiresAt > now)
    store.sessions = store.sessions.filter((item) => item.expiresAt > now)
  }
  function refreshDailyCredits(user) {
    const today = currentCreditDay()
    if (user.creditsUpdatedOn === today) return false
    user.credits = DEFAULT_CREDITS
    user.creditsUpdatedOn = today
    return true
  }
  function sessionFor(req) {
    cleanup()
    const hash = tokenHash(bearer(req))
    const session = store.sessions.find((item) => item.tokenHash === hash)
    if (!session) return null
    const user = store.users.find((item) => item.id === session.userId)
    if (user && refreshDailyCredits(user)) save()
    return user ? { session, user } : null
  }
  function publicUser(user) { return { id: user.id, email: user.email, credits: user.credits, createdAt: user.createdAt } }
  function ensureWhitelisted(email) {
    if (!REGISTRATION_WHITELIST.has(email)) {
      const error = new Error('没有权限，请联系管理人员')
      error.status = 403
      throw error
    }
  }
  function spendCredits(userId, amount) {
    const user = store.users.find((item) => item.id === userId)
    if (!user) {
      const error = new Error('登录已过期，请重新登录')
      error.status = 401
      throw error
    }
    refreshDailyCredits(user)
    if (user.credits < amount) {
      const error = new Error('积分不足，无法生成图片')
      error.status = 402
      throw error
    }
    user.credits -= amount
    save()
    return publicUser(user)
  }
  function refundCredits(userId, amount) {
    const user = store.users.find((item) => item.id === userId)
    if (!user) return null
    refreshDailyCredits(user)
    if (amount) {
      user.credits = Math.min(DEFAULT_CREDITS, user.credits + amount)
      save()
    }
    return publicUser(user)
  }
  function issueSession(user, remember) {
    refreshDailyCredits(user)
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + (remember ? REMEMBER_SESSION_TTL : SHORT_SESSION_TTL)
    store.sessions.push({ tokenHash: tokenHash(token), userId: user.id, expiresAt })
    save()
    return { token, expiresAt, user: publicUser(user) }
  }
  async function sendCode(email, code) {
    const host = process.env.SMTP_HOST
    const username = process.env.SMTP_USERNAME
    const password = process.env.SMTP_PASSWORD
    if (!host || !username || !password) return false
    const socket = tls.connect({ host, port: Number(process.env.SMTP_PORT || 465), servername: host, rejectUnauthorized: true })
    socket.setTimeout(20_000)
    let buffer = ''
    const waiting = []
    function drainResponses() {
      while (waiting.length) {
        const lines = buffer.split('\r\n')
        if (lines.length < 2) break
        let end = -1
        for (let index = 0; index < lines.length - 1; index += 1) if (/^\d{3} /.test(lines[index])) { end = index; break }
        if (end < 0) break
        const response = lines.slice(0, end + 1).join('\r\n')
        buffer = lines.slice(end + 1).join('\r\n')
        waiting.shift()(response)
      }
    }
    socket.on('data', (chunk) => { buffer += chunk.toString('utf8'); drainResponses() })
    const read = () => new Promise((resolve, reject) => {
      waiting.push(resolve)
      drainResponses()
      const fail = (error) => { socket.destroy(); reject(error) }
      socket.once('error', fail)
      socket.once('timeout', () => fail(new Error('SMTP 连接超时')))
    })
    const command = async (value, expected) => {
      if (value) socket.write(`${value}\r\n`)
      const response = await read()
      if (!expected.some((code) => response.startsWith(String(code)))) throw new Error(`邮件服务器拒绝请求 (${response.slice(0, 3)})`)
    }
    try {
      await command('', [220])
      await command(`EHLO ${process.env.SMTP_HELO || 'onewo.com'}`, [250])
      await command('AUTH LOGIN', [334])
      await command(Buffer.from(username).toString('base64'), [334])
      await command(Buffer.from(password).toString('base64'), [235])
      await command(`MAIL FROM:<${username}>`, [250])
      await command(`RCPT TO:<${email}>`, [250, 251])
      await command('DATA', [354])
      const subject = `=?UTF-8?B?${Buffer.from('小蝶注册验证码').toString('base64')}?=`
      const html = `<div style="font-family:sans-serif;color:#1a2e1f"><h2>欢迎使用小蝶</h2><p>你的注册验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 10 分钟内有效。如非本人操作，请忽略此邮件。</p></div>`
      socket.write(`From: 小蝶 <${username}>\r\nTo: <${email}>\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html.replace(/\r?\n\./g, '\r\n..')}\r\n.\r\n`)
      const delivered = await read()
      if (!delivered.startsWith('250')) throw new Error('邮件服务器未接受验证码邮件')
      await command('QUIT', [221])
      return true
    } finally { socket.end() }
  }

  app.post('/api/auth/register/code', async (req, res, next) => {
    try {
      cleanup()
      const email = normalizeEmail(req.body.email)
      if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: '仅支持 @onewo.com 企业邮箱' })
      try { ensureWhitelisted(email) } catch (error) { return res.status(error.status || 403).json({ error: error.message }) }
      if (store.users.some((item) => item.email === email)) return res.status(409).json({ error: '该邮箱已注册，请直接登录' })
      const recent = store.codes.find((item) => item.email === email && item.sentAt > Date.now() - 60_000)
      if (recent) return res.status(429).json({ error: '请 60 秒后再获取验证码' })
      const code = String(Math.floor(100000 + Math.random() * 900000))
      store.codes = store.codes.filter((item) => item.email !== email)
      store.codes.push({ email, codeHash: tokenHash(code), attempts: 0, sentAt: Date.now(), expiresAt: Date.now() + CODE_TTL })
      save()
      const sent = await sendCode(email, code)
      res.json({ ok: true, ...(sent ? {} : { devCode: code }) })
    } catch (error) { next(error) }
  })

  function verifyCode(email, code) {
    cleanup()
    const record = store.codes.find((item) => item.email === email)
    if (!record || record.expiresAt <= Date.now()) return { error: '验证码已过期，请重新获取' }
    if (record.attempts >= 5) return { error: '验证码错误次数过多，请重新获取', status: 429 }
    if (record.codeHash !== tokenHash(code)) {
      record.attempts += 1
      save()
      return { error: '验证码不正确' }
    }
    return { record }
  }

  app.post('/api/auth/register/verify', (req, res) => {
    const email = normalizeEmail(req.body.email)
    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: '仅支持 @onewo.com 企业邮箱' })
    try { ensureWhitelisted(email) } catch (error) { return res.status(error.status || 403).json({ error: error.message }) }
    const result = verifyCode(email, String(req.body.code || '').trim())
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    res.json({ ok: true })
  })

  app.post('/api/auth/register', (req, res) => {
    cleanup()
    const email = normalizeEmail(req.body.email)
    const code = String(req.body.code || '').trim()
    const password = String(req.body.password || '')
    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: '仅支持 @onewo.com 企业邮箱' })
    try { ensureWhitelisted(email) } catch (error) { return res.status(error.status || 403).json({ error: error.message }) }
    if (!PASSWORD_PATTERN.test(password)) return res.status(400).json({ error: '密码须为 8–64 位，且同时包含字母和数字' })
    if (store.users.some((item) => item.email === email)) return res.status(409).json({ error: '该邮箱已注册，请直接登录' })
    const verification = verifyCode(email, code)
    if (verification.error) return res.status(verification.status || 400).json({ error: verification.error })
    const user = { id: randomBytes(16).toString('hex'), email, passwordHash: passwordHash(password), credits: DEFAULT_CREDITS, creditsUpdatedOn: currentCreditDay(), createdAt: new Date().toISOString() }
    store.users.push(user)
    store.codes = store.codes.filter((item) => item.email !== email)
    save()
    res.status(201).json(issueSession(user, Boolean(req.body.remember)))
  })

  app.post('/api/auth/login', (req, res) => {
    const email = normalizeEmail(req.body.email)
    const user = store.users.find((item) => item.email === email)
    if (!user || !passwordMatches(String(req.body.password || ''), user.passwordHash)) return res.status(401).json({ error: '邮箱或密码不正确' })
    res.json(issueSession(user, Boolean(req.body.remember)))
  })

  app.get('/api/auth/me', (req, res) => {
    const auth = sessionFor(req)
    if (!auth) return res.status(401).json({ error: '登录已过期，请重新登录' })
    res.json({ user: publicUser(auth.user), expiresAt: auth.session.expiresAt })
  })

  app.post('/api/auth/password', (req, res) => {
    const auth = sessionFor(req)
    if (!auth) return res.status(401).json({ error: '登录已过期，请重新登录' })
    const currentPassword = String(req.body.currentPassword || '')
    const newPassword = String(req.body.newPassword || '')
    if (!passwordMatches(currentPassword, auth.user.passwordHash)) return res.status(400).json({ error: '当前密码不正确' })
    if (!PASSWORD_PATTERN.test(newPassword)) return res.status(400).json({ error: '新密码须为 8–64 位，且同时包含字母和数字' })
    if (currentPassword === newPassword) return res.status(400).json({ error: '新密码不能与当前密码相同' })
    auth.user.passwordHash = passwordHash(newPassword)
    store.sessions = store.sessions.filter((item) => item.userId !== auth.user.id || item.tokenHash === auth.session.tokenHash)
    save()
    res.json({ ok: true })
  })

  app.post('/api/auth/logout', (req, res) => {
    const hash = tokenHash(bearer(req))
    store.sessions = store.sessions.filter((item) => item.tokenHash !== hash)
    save()
    res.json({ ok: true })
  })

  function requireAuth(req, res, next) {
    const auth = sessionFor(req)
    if (!auth) return res.status(401).json({ error: '请先登录' })
    req.user = publicUser(auth.user)
    next()
  }

  return { requireAuth, spendCredits, refundCredits }
}
