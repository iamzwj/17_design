import { readWorkspaceStorage, writeWorkspaceStorage } from './workspaceStorage.js'
import { useEffect, useRef, useState } from 'react'
import { extractPresentation, presentationPreview } from './htmlPresentation.js'
import { createConversationImageTask, getAuthToken, waitForConversationImageTask } from './api.js'
import { knowledgeRequest } from './knowledgeApi.js'
import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_QUALITY, DEFAULT_IMAGE_RESOLUTION } from './imageModels.js'

const running = new Map()
function read(key) { try { return JSON.parse(readWorkspaceStorage(key)) || [] } catch { return [] } }
export function useActivityImages(conversationId, enabled) {
  const key = `dgen-activity-images:${getAuthToken().slice(-12)}:${conversationId}`
  const [records, setRecords] = useState(() => read(key))
  function write(transform) { const next = transform(read(key)); writeWorkspaceStorage(key, JSON.stringify(next)); window.dispatchEvent(new Event('dgen-activity-images')) }
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
          const result = await createConversationImageTask({ prompt: record.prompt, clientRequestId: record.submissionId || record.id, images: [], model: DEFAULT_IMAGE_MODEL, resolution: DEFAULT_IMAGE_RESOLUTION, quality: DEFAULT_IMAGE_QUALITY, aspectRatio: '3:4', knowledge: { brandId: identity?.id || marketing?.id, activityContext: record.context, ...(identity ? { enforceBrandColors: true } : {}) } })
          taskId = result.task.id
          write(rows => rows.map(r => r.id === record.id ? { ...r, taskId, status: 'running' } : r))
        }
        const result = await waitForConversationImageTask(taskId)
        write(rows => rows.map(r => r.id === record.id ? { ...r, taskId, status: 'succeeded', urls: result.urls } : r))
      } catch (error) { const message = /品牌颜色规范尚未发布/.test(error.message) ? `${error.message} 请在知识库中发布该品牌的标准色后重试。` : error.message; write(rows => rows.map(r => r.id === record.id ? { ...r, status: 'failed', error: message, retryable: Boolean(error.terminal && r.taskId) } : r)) }
    })().finally(() => running.delete(runtimeKey))
    running.set(runtimeKey, operation)
    return operation
  }
  useEffect(() => {
    const sync = () => setRecords(read(key))
    window.addEventListener('dgen-activity-images', sync)
    if (enabled) for (const record of read(key).filter(r => ['submitting', 'running'].includes(r.status))) {
      if (!record.taskId && !running.has(`${key}:${record.id}`)) { write(rows => rows.map(r => r.id === record.id ? { ...r, status: 'failed', retryable: false, error: '提交结果暂时无法确认，请先查看生成记录，避免重复扣费。' } : r)); continue }
      void execute(record)
    }
    return () => window.removeEventListener('dgen-activity-images', sync)
    // The durable key owns this runtime; switching modules resumes the same server task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return { records, retry: async (id) => { const previous = read(key).find(r => r.id === id); if (!previous?.retryable) return; const next = { ...previous, taskId: null, submissionId: crypto.randomUUID(), status: 'submitting', error: '', retryable: false }; write(rows => rows.map(r => r.id === id ? next : r)); await execute(next) }, create: async (prompt, context, recordId) => { const existing = recordId && read(key).find(r => r.id === recordId); if (existing) { if (['submitting', 'running'].includes(existing.status)) await execute(existing); return }; const record = { id: recordId || crypto.randomUUID(), prompt, context: { ...context }, status: 'submitting', createdAt: Date.now() }; write(rows => [...rows, record]); await execute(record) } }
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

export function ActivityImageResults({ records, onRetry }) {
  if (!records.length) return null
  return <div className="activity-image-results">{records.map(r => <article key={r.id}><header><b>{r.context.pageTitle || '活动图片'}</b><span>{r.context.identity || '按需求创作'} · {r.context.scope || '未指定属地'}</span></header>{['running', 'submitting'].includes(r.status) ? <p role="status">正在生成图片，切换模块后可回来查看…</p> : r.status === 'failed' ? <div><p role="alert">{r.error}</p>{r.retryable && onRetry && <button type="button" onClick={() => onRetry(r.id)}>重新生成（消耗积分）</button>}</div> : r.urls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={r.prompt}/></a>)}</article>)}</div>
}

export function activityContentPages(content) {
  const text = String(content || '')
  const candidates = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1])
  candidates.push(text.trim())
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate)
      const pages = Array.isArray(value.pages) ? value.pages.filter(p => typeof p.title === 'string' && p.title.trim() && typeof p.prompt === 'string' && p.prompt.trim()).slice(0, 6) : []
      if (pages.length) return pages
    } catch { /* Try the next complete JSON block. */ }
  }
  return []
}
export function activityVisibleText(content) {
  let text = String(content || '')
  if (extractPresentation(text)) text = text.replace(/```html\s*[\s\S]*?```/i, '')
  if (activityContentPages(text).length) text = text.replace(/```json\s*[\s\S]*?```/gi, '')
  return text.trim()
}

export function ActivityHtmlResult({ content }) {
  const frame = useRef(null)
  const html = extractPresentation(content)
  if (!html) return null
  const preview = presentationPreview(html)
  function download() { const url = URL.createObjectURL(new Blob([preview], { type: 'text/html;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = '演示稿.html'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  return <section className="activity-html-result"><header><b>HTML 演示稿</b><div><button type="button" onClick={() => frame.current?.requestFullscreen?.()}>全屏播放</button><button type="button" onClick={download}>下载演示稿</button></div></header><iframe ref={frame} sandbox="allow-scripts" allowFullScreen referrerPolicy="no-referrer" title="HTML 演示稿预览" srcDoc={preview}/></section>
}
