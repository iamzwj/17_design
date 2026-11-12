import { useEffect, useState } from 'react'
import { createConversationImageTask, getAuthToken, waitForConversationImageTask } from './api.js'
import { knowledgeRequest } from './knowledgeApi.js'
import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_QUALITY, DEFAULT_IMAGE_RESOLUTION } from './imageModels.js'

const running = new Map()
function read(key) { try { return JSON.parse(localStorage.getItem(key)) || [] } catch { return [] } }
export function useActivityImages(conversationId, enabled) {
  const key = `dgen-activity-images:${getAuthToken().slice(-12)}:${conversationId}`
  const [records, setRecords] = useState(() => read(key))
  function write(transform) { const next = transform(read(key)); localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event('dgen-activity-images')) }
  async function execute(record) {
    const runtimeKey = `${key}:${record.id}`
    if (running.has(runtimeKey)) return running.get(runtimeKey)
    const operation = (async () => {
      try {
        let taskId = record.taskId
        if (!taskId) {
          const boot = await knowledgeRequest('/bootstrap')
          const identity = boot.brands.find(b => b.name === record.context.identity)
          const marketing = boot.brands.find(b => b.name === '营销活动')
          const result = await createConversationImageTask({ prompt: record.prompt, clientRequestId: record.id, images: [], model: DEFAULT_IMAGE_MODEL, resolution: DEFAULT_IMAGE_RESOLUTION, quality: DEFAULT_IMAGE_QUALITY, aspectRatio: '3:4', knowledge: { brandId: identity?.id || marketing?.id, activityContext: record.context, ...(identity ? { enforceBrandColors: true } : {}) } })
          taskId = result.task.id
          write(rows => rows.map(r => r.id === record.id ? { ...r, taskId, status: 'running' } : r))
        }
        const result = await waitForConversationImageTask(taskId)
        write(rows => rows.map(r => r.id === record.id ? { ...r, taskId, status: 'succeeded', urls: result.urls } : r))
      } catch (error) { write(rows => rows.map(r => r.id === record.id ? { ...r, status: 'failed', error: error.message } : r)) }
    })().finally(() => running.delete(runtimeKey))
    running.set(runtimeKey, operation)
    return operation
  }
  useEffect(() => {
    const sync = () => setRecords(read(key))
    window.addEventListener('dgen-activity-images', sync)
    if (enabled) for (const record of read(key).filter(r => ['submitting', 'running'].includes(r.status))) void execute(record)
    return () => window.removeEventListener('dgen-activity-images', sync)
    // The durable key owns this runtime; switching modules resumes the same server task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return { records, create: async (prompt, context, recordId) => { const existing = recordId && read(key).find(r => r.id === recordId); if (existing) { if (['submitting', 'running'].includes(existing.status)) await execute(existing); return }; const record = { id: recordId || crypto.randomUUID(), prompt, context: { ...context }, status: 'submitting', createdAt: Date.now() }; write(rows => [...rows, record]); await execute(record) } }
}

export function groupActivityImages(messages, records) {
  const byMessage = new Map()
  const unmatched = []
  for (const record of records) {
    let index = messages.findIndex(message =>
      message.activityImageId === record.id ||
      (message.role === 'assistant' && message.taskId && record.id.startsWith(`${message.taskId}-page-`)),
    )
    if (index === -1 && !record.context.pageTitle) {
      // Old image messages did not store a task ID. Match their prompt once
      // in submission order so repeated prompts each get their own result.
      index = messages.findIndex((message, position) => message.role === 'user' &&
        !message.activityImageId && !byMessage.has(position) &&
        (record.prompt === message.content || record.prompt.startsWith(`${message.content}\n\n当前对话方案参考：`)),
      )
    }
    if (index === -1) unmatched.push(record)
    else byMessage.set(index, [...(byMessage.get(index) || []), record])
  }
  return { byMessage, unmatched }
}

export function ActivityImageResults({ records }) {
  if (!records.length) return null
  return <div className="activity-image-results">{records.map(r => <article key={r.id}><header><b>{r.context.pageTitle || '活动图片'}</b><span>{r.context.identity || '按需求创作'} · {r.context.scope || '未指定属地'}</span></header>{['running', 'submitting'].includes(r.status) ? <p role="status">正在生成图片，切换模块后可回来查看…</p> : r.status === 'failed' ? <p role="alert">{r.error}</p> : r.urls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={r.prompt}/></a>)}</article>)}</div>
}

export function activityContentPages(content) {
  try {
    const value = JSON.parse(String(content || '').match(/```json\s*([\s\S]*?)```/i)?.[1] || '{}')
    return Array.isArray(value.pages) ? value.pages.filter(p => typeof p.title === 'string' && typeof p.prompt === 'string').slice(0, 6) : []
  } catch { return [] }
}
export function activityVisibleText(content) {
  let text = String(content || '').replace(/```html\s*[\s\S]*?```/gi, '')
  if (activityContentPages(text).length) text = text.replace(/```json\s*[\s\S]*?```/gi, '')
  return text.trim()
}

export function ActivityHtmlResult({ content }) {
  const html = String(content || '').match(/```html\s*([\s\S]*?)```/i)?.[1]
  if (!html) return null
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">'
  const preview = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + csp) : csp + html
  function download() { const url = URL.createObjectURL(new Blob([preview], { type: 'text/html;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = '活动方案演示稿.html'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  return <section className="activity-html-result"><header><b>HTML 演示稿</b><button type="button" onClick={download}>下载演示稿</button></header><iframe sandbox="allow-scripts" referrerPolicy="no-referrer" title="活动方案演示稿" srcDoc={preview}/></section>
}
