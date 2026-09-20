import { useEffect, useState } from 'react'
import { createFestivalPosterTask, downloadGeneratedImage, generateFestivalPosterImages, getFestivalPosterTask, listFestivalPosterTasks } from './api.js'
import { Icon } from './icons.jsx'
import ImagePreview from './ImagePreview.jsx'
import ToolPageHeader from './ToolPageHeader.jsx'
import './festivalPoster.css'

const FESTIVAL_DRAFT_KEY = 'diefa-festival-poster-draft-v1'
const FESTIVAL_STYLE_KEY = 'diefa-festival-poster-style-v1'
const DEFAULT_FESTIVAL_STYLE = 'color-ink'
const FESTIVAL_STYLES = [
  { value: '3d-cartoon', label: '3D卡通风格' },
  { value: 'photorealistic', label: '写实风格' },
  { value: DEFAULT_FESTIVAL_STYLE, label: '彩色水墨风' },
  { value: 'paper-cut', label: '剪纸风格' },
]
const taskListeners = new Set()
const taskPollers = new Map()
let taskStore = { festival: localStorage.getItem(FESTIVAL_DRAFT_KEY) || '国庆', style: localStorage.getItem(FESTIVAL_STYLE_KEY) || DEFAULT_FESTIVAL_STYLE, tasks: [], loadingHistory: false, creating: false, error: '', loaded: false }

function festivalStyleLabel(style) {
  return FESTIVAL_STYLES.find((item) => item.value === style)?.label || '彩色水墨风'
}

function emit(update) {
  taskStore = { ...taskStore, ...update }
  taskListeners.forEach((listener) => listener(taskStore))
}

function subscribe(listener) {
  taskListeners.add(listener); listener(taskStore)
  return () => taskListeners.delete(listener)
}

function putTask(task) {
  emit({ tasks: [task, ...taskStore.tasks.filter((item) => item.id !== task.id)].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) })
}

function friendlyError(error) {
  const message = String(error?.message || error || '')
  return /timeout|timed out|aborted/i.test(message) ? 'GRS AI 本次响应超时，请重新生成。' : message || '生成失败，请稍后重试'
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function pollTask(id) {
  if (taskPollers.has(id)) return taskPollers.get(id)
  const request = (async () => {
    while (true) {
      const { task } = await getFestivalPosterTask(id)
      putTask(task)
      if (task.status !== 'running') return task
      await wait(3_000)
    }
  })().catch((error) => {
    const current = taskStore.tasks.find((task) => task.id === id)
    if (current) putTask({ ...current, status: 'failed', phase: 'failed', error: friendlyError(error) })
    throw error
  }).finally(() => taskPollers.delete(id))
  taskPollers.set(id, request)
  return request
}

async function loadHistory() {
  if (taskStore.loadingHistory) return
  emit({ loadingHistory: true, error: '' })
  try {
    const { tasks } = await listFestivalPosterTasks()
    emit({ tasks: tasks || [], loaded: true })
    for (const task of tasks || []) if (task.status === 'running') pollTask(task.id).catch(() => {})
  } catch (error) {
    emit({ error: error.status === 401 ? '' : friendlyError(error), loaded: true }); throw error
  } finally { emit({ loadingHistory: false }) }
}

async function createTask(festival, style = DEFAULT_FESTIVAL_STYLE) {
  if (taskStore.creating) return
  emit({ creating: true, error: '' })
  try {
    const { task } = await createFestivalPosterTask({ festival, style })
    putTask(task); pollTask(task.id).catch(() => {})
  } finally { emit({ creating: false }) }
}

async function startImages(task, plans) {
  const response = await generateFestivalPosterImages(task.id, plans)
  putTask(response.task); pollTask(task.id).catch(() => {})
  return response
}

function statusLabel(task) {
  if (task.status === 'succeeded') return '已完成'
  if (task.status === 'planned') return '准备生图'
  if (task.status === 'failed') return '生成失败'
  return task.phase === 'generating' ? '正在生图' : '正在生成提示词'
}

export default function FestivalPosterStudio({ onUserUpdate, onRequireLogin }) {
  const [store, setStore] = useState(taskStore)
  const [preview, setPreview] = useState(null)

  useEffect(() => subscribe(setStore), [])
  useEffect(() => { if (!taskStore.loaded) loadHistory().catch(() => {}) }, [])

  function changeFestival(value) { localStorage.setItem(FESTIVAL_DRAFT_KEY, value); emit({ festival: value }) }
  function changeStyle(value) { localStorage.setItem(FESTIVAL_STYLE_KEY, value); emit({ style: value }) }

  async function submitFestival() {
    const festival = store.festival.trim()
    if (!festival || store.creating) return
    try { await createTask(festival, store.style) }
    catch (error) { if (error.status === 401) onRequireLogin?.(); else emit({ error: friendlyError(error) }) }
  }

  async function generateImages(task) {
    if (!Array.isArray(task.plans) || task.plans.length !== 2 || task.plans.some((plan) => !plan.prompt.trim())) return
    try {
      const { user } = await startImages(task, task.plans)
      if (user) onUserUpdate?.(user)
    } catch (error) {
      if (error.status === 401) onRequireLogin?.()
      else putTask({ ...task, status: 'failed', error: friendlyError(error) })
    }
  }

  return <section className="workspace festival-poster-workspace"><div className="festival-poster-page">
    <ToolPageHeader eyebrow="CONTENT CREATION" title="朴邻节日节气海报"/>
    <div className="festival-waterfall-composer"><label htmlFor="festival-name">新建节日节气海报</label><div className="festival-input-row horizontal"><input id="festival-name" value={store.festival} onChange={(event) => changeFestival(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) submitFestival() }} placeholder="输入节日或节气，例如国庆、重阳、冬至" maxLength={24}/><select aria-label="海报风格" value={store.style} onChange={(event) => changeStyle(event.target.value)}>{FESTIVAL_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}</select><button type="button" onClick={submitFestival} disabled={!store.festival.trim() || store.creating}>{store.creating ? '生成中…' : '生成'}<Icon name="spark" size={17}/></button></div>{store.error && <div className="festival-error">{store.error}</div>}</div>
    <div className="festival-task-stream">
      {store.loadingHistory && store.tasks.length === 0 ? <div className="festival-empty glass-strong"><i className="festival-loader"/><b>正在加载历史任务</b></div> : store.tasks.length === 0 ? <div className="festival-empty glass-strong"><Icon name="image" size={28}/><b>还没有节日节气海报任务</b><span>输入节日或节气后可以连续创建多组任务。</span></div> : store.tasks.map((task) => {
        const plans = Array.isArray(task.plans) ? task.plans : []
        const posters = task.result?.posters || []
        return <article className={`festival-task-card status-${task.status}`} key={task.id}>
          <header><div className="festival-task-leading"><span className="festival-status-dot"/><div><div><b>{task.festival}</b><em>{statusLabel(task)}</em></div><small>{new Date(task.createdAt).toLocaleString('zh-CN')}<span>{festivalStyleLabel(task.style)}</span><span>{task.promptModel || (task.status === 'running' ? '高质量方案模型' : 'gpt-5.5')}</span><span>Image 2.5 Sunburst / 2.5</span>{task.promptModelFallback && <span>已自动切换备用模型</span>}</small></div></div><div className="festival-task-actions">{task.status === 'succeeded' && <button type="button" onClick={() => createTask(task.festival, task.style || DEFAULT_FESTIVAL_STYLE)}>重新生成</button>}{task.status === 'failed' && plans.length === 2 && <button type="button" onClick={() => generateImages(task)}>重新生成</button>}{task.status === 'failed' && plans.length !== 2 && <button type="button" onClick={() => createTask(task.festival, task.style || DEFAULT_FESTIVAL_STYLE)}>重新生成</button>}</div></header>
          {task.status === 'running' && <div className="festival-task-running"><i className="festival-loader"/><span>{task.message || '后台任务处理中'}</span></div>}
          {task.status === 'failed' && <div className="festival-error task-error">{task.error || '生成失败，请重试'}</div>}
          {posters.length > 0 && <div className="festival-task-images">{posters.map((poster, index) => <figure key={poster.url}><button type="button" onClick={() => setPreview({ url: poster.url, urls: posters.map((item) => item.url), prompt: poster.prompt })}><img src={poster.url} alt={`${task.festival}方案${index + 1}`}/></button><figcaption><div><b>{poster.title || `方案 ${index + 1}`}</b><small>{poster.scene || '邻里服务场景'}</small></div><button type="button" onClick={() => downloadGeneratedImage(poster.url, `${task.festival}-方案${index + 1}`)}><Icon name="download" size={15}/>下载</button></figcaption></figure>)}</div>}
        </article>
      })}
    </div>
  </div>{preview && <ImagePreview url={preview.url} urls={preview.urls} prompt={preview.prompt} onClose={() => setPreview(null)}/>}</section>
}
