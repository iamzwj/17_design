import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import express from 'express'
import { LANGUAGE_MODELS } from '../server/languageModels.js'
import Database from 'better-sqlite3'
import { installKnowledge } from '../server/knowledge/index.js'

const root = process.env.DIEFA_DATA_DIR || path.resolve('data')
const file = path.join(root, 'knowledge', 'knowledge.sqlite')
const read = new Database(file, { readonly: true })
try {
  for (let attempt = 0; ; attempt++) {
    const docs = read.prepare("SELECT json FROM documents WHERE id LIKE 'marketing-source-%'").all().map(r => JSON.parse(r.json)).filter(d => !d.deletedAt)
    const versions = read.prepare('SELECT json FROM versions').all().map(r => JSON.parse(r.json))
    const failed = docs.map(d => versions.find(v => v.id === d.latestVersionId)).filter(v => v?.status === 'failed')
    if (failed.length) throw new Error(`营销资料入库失败：${failed.map(v => v.error).join('; ')}`)
    if (docs.length === 14 && docs.every(d => d.publishedVersionId)) { console.log('Marketing knowledge: 14 text-layer documents published with source page references.'); break }
    if (attempt >= 90) throw new Error(`营销资料仍未就绪：${docs.filter(d => d.publishedVersionId).length}/14`)
    await new Promise(r => setTimeout(r, 2000))
  }
} finally { read.close() }

if (process.env.ACTIVITY_LIVE_VERIFY !== '1') process.exit(0)
const validationDir = path.join(root, 'marketing-validation')
const validationKey = createHash('sha256').update(fs.readFileSync(new URL('../server/knowledge/marketing.js', import.meta.url))).update(fs.readFileSync(new URL('../server/knowledge/imports/department-marketing.enc', import.meta.url))).digest('hex')
const marker = path.join(validationDir, 'verified.sha256')
if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === validationKey) { console.log('Activity live validation already passed for this import and retrieval revision.'); process.exit(0) }
const users = JSON.parse(fs.readFileSync(path.join(root, 'auth.json'), 'utf8')).users
const user = users.find(u => u.email?.toLowerCase() === 'zhangwj159@onewo.com')
if (!user) throw new Error('未找到营销知识库管理员')
const kb = installKnowledge(express(), { dataDir: root, requireAuth: () => {}, requireAdmin: () => {}, listUsers: () => users, backgroundProcessing: false })
const out = path.join(root, 'marketing-validation'); fs.mkdirSync(out, { recursive: true, mode: 0o700 })
try {
  for (const [name, query, identity, scope] of [
    ['wuhan-crossyear', '为武汉幸福社制定下一轮跨年营销方案，参考去年同期方案。用600字说明历史参考、地域化建议和主要执行架构，不虚构当地已有资源。', '', '武汉幸福社'],
    ['yanxuan-campaign', '制定研选家的跨年营销方案，调用研选家现行规范和去年同期营销方案，区分品牌要求与历史经验。用600字给出关键执行安排。', '研选家', '本部'],
  ]) {
    const context = await kb.prepare(user, { messages: [{ role: 'user', content: query }], activityContext: { enabled: true, identity, scope, format: 'strategy' } }, 'text')
    if (!context.sources.some(r => /年终福利节/.test(r.title))) throw new Error(`${name}: 未引用去年同期年终方案`)
    if (context.sources.some(r => /春节营销/.test(r.title))) throw new Error(`${name}: 错把春节方案当跨年主参考`)
    let result, usedModel
    for (const model of LANGUAGE_MODELS) {
      try {
        const response = await fetch(`${(process.env.GRSAI_BASE_URL || 'https://grsaiapi.com').replace(/\/$/, '')}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GRSAI_API_KEY}` }, body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: `当前日期为${new Intl.DateTimeFormat('sv', { timeZone: 'Asia/Shanghai' }).format(new Date())}。\n${context.prompt}` }, { role: 'user', content: query }] }), signal: AbortSignal.timeout(90000) })
        if (!response.ok) throw new Error(`生成接口返回 ${response.status}`)
        const data = await response.json()
        const content = data.choices?.[0]?.message?.content
        if (typeof content !== 'string' || content.trim().length < 150) throw new Error('真实模型未返回完整策略内容')
        result = content; usedModel = data.model || model; break
      } catch (error) { if (model === LANGUAGE_MODELS.at(-1)) throw error }
    }
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ query, model: usedModel, traceId: context.id, sources: context.sources, content: result }, null, 2), { mode: 0o600 })
    kb.finish(context.id, { status: 'succeeded', model: usedModel, validation: true })
    console.log(`${name}: real model response verified (${result.length} characters); evidence trace saved privately.`)
  }
  fs.writeFileSync(marker, validationKey, { mode: 0o600 })
} finally { await kb.close() }
