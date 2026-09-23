import { useEffect, useState } from 'react'
import { downloadGeneratedImage, generateImage } from './api.js'
import { Icon } from './icons.jsx'
import ImagePreview from './ImagePreview.jsx'
import ToolPageHeader from './ToolPageHeader.jsx'
import './pulinTitle.css'

const STORE_KEY = 'diefa-pulin-title-studio-v1'
const DEFAULT_DRAFT = { title: '邻里欢聚', subtitle: '', layout: 'stacked', hands: true, transparentOutput: true, backgroundColor: '#ff00ff' }
const listeners = new Set()
const pendingRequests = new Map()
const referenceImageCache = new Map()

function referencePaths({ layout, hands, subtitle }) {
  const suffix = hands ? 'hands' : 'no-hands'
  if (layout === 'horizontal') {
    const paths = [`/pulin-title/horizontal-${suffix}.png`]
    if (subtitle) paths.push(`/pulin-title/stacked-subtitle-${suffix}.png`)
    return paths
  }
  return [subtitle ? `/pulin-title/stacked-subtitle-${suffix}.png` : `/pulin-title/stacked-${suffix}.png`]
}

function imageToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('标题参考图读取失败，请稍后重试'))
    reader.readAsDataURL(blob)
  })
}

async function titleReferenceImages(task) {
  return Promise.all(referencePaths(task).map((path) => {
    if (!referenceImageCache.has(path)) {
      referenceImageCache.set(path, fetch(path).then(async (response) => {
        if (!response.ok) throw new Error('标题参考图加载失败，请稍后重试')
        return imageToDataUrl(await response.blob())
      }))
    }
    return referenceImageCache.get(path)
  }))
}

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    const tasks = Array.isArray(saved.tasks) ? saved.tasks.map((task) => task.status === 'running' ? { ...task, status: 'failed', error: '页面已刷新，请重新生成' } : task).slice(0, 20) : []
    return { draft: { ...DEFAULT_DRAFT, ...(saved.draft || {}) }, tasks, creating: false, error: '' }
  } catch { return { draft: DEFAULT_DRAFT, tasks: [], creating: false, error: '' } }
}

let titleStore = loadStore()

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ draft: titleStore.draft, tasks: titleStore.tasks })) } catch { /* Keep the live tool usable if local storage is full. */ }
}

function emit(update) {
  titleStore = { ...titleStore, ...update }
  persist()
  listeners.forEach((listener) => listener(titleStore))
}

function subscribe(listener) {
  listeners.add(listener)
  listener(titleStore)
  return () => listeners.delete(listener)
}

function putTask(task) {
  emit({ tasks: [task, ...titleStore.tasks.filter((item) => item.id !== task.id)].slice(0, 20) })
}

function titlePrompt({ title, subtitle, layout, hands, transparentOutput, backgroundColor }, scheme = 1) {
  const longTitleRule = title.length > 12 ? '标题字数较多：在不省略、不改字的前提下，自动缩小字号并适度收紧字距，确保所有文字完整、清晰。' : ''
  const lineDirection = layout === 'horizontal'
    ? '横向一行排版，主标题从左至右完整呈现，不换行，画面比例16:9。'
    : '上下两行排版，将主标题自然拆分为上下两行，画面比例4:3。'
  const handDecoration = hands
    ? '保留参考图中的黄色、绿色笑脸拍手图标，并保持其位置、比例、材质和表情。'
    : '不要出现拍手、手掌、人物或其他顶部图标。'
  const subtitleRule = subtitle
    ? `在主标题下方增加一条金色丝带副标题，丝带上清晰准确地写“${subtitle}”。`
    : '不要增加副标题、丝带文字或任何额外文案。'
  const canvasRule = transparentOutput !== false
    ? `背景必须是整张画面完全纯色的 ${String(backgroundColor || '#ff00ff').toUpperCase()}，这是后续自动抠图专用底色；标题、底座、拍手和所有装饰绝不能使用该颜色。`
    : '深蓝色纯色或轻微渐变背景（皇家蓝到藏蓝），背景干净，没有其他场景。'
  return `已提供朴里节标题的原始参考图。这些参考图是唯一权威的视觉和版式来源：请在同一套设计上替换文字，不要自行发明新的标题造型、背景框、图标、配色或装饰方式。不要复用参考图里的示例文字。

制作一张用于活动海报的中文3D标题视觉。${canvasRule}

必须准确呈现的主标题是：“${title}”。${lineDirection}${longTitleRule}
${subtitleRule}
${handDecoration}

严格保留参考图里的圆润厚实中文字体、象牙白与明黄分字配色、深钴蓝多层立体描边、不规则深蓝底座、金色丝带、黄色星星、蓝色几何碎片以及整体留白和层级。${scheme === 1 ? '这是方案一：优先贴近参考图的标准构图。' : '这是方案二：仍严格保留参考图的结构，只对文字的白黄分组、星片和飘带的细微位置做一套不同编排。'}文字清晰、端正、完整，不得改字、漏字、乱码或出现英文。整体高端、欢快、儿童友好但不幼稚，边缘完整，不要水印、Logo、说明文字或多余字符。`
}

function titleRatio(layout) { return layout === 'horizontal' ? '16:9' : '4:3' }

async function startGeneration(draft, onUserUpdate, onRequireLogin) {
  if (titleStore.creating) return
  const title = String(draft.title || '').trim().slice(0, 32)
  const subtitle = String(draft.subtitle || '').trim().slice(0, 24)
  if (!title) return emit({ error: '请填写主标题' })
  const task = {
    id: `pulin-title-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title, subtitle, layout: draft.layout, hands: Boolean(draft.hands), transparentOutput: draft.transparentOutput !== false, backgroundColor: draft.backgroundColor || '#ff00ff', status: 'running',
    createdAt: new Date().toISOString(), model: 'GPT Image 2.5 Sunburst', error: '', urls: [],
  }
  emit({ creating: true, error: '' })
  putTask(task)
  const request = (async () => {
    const ratio = titleRatio(task.layout)
    try {
      const images = await titleReferenceImages(task)
      const variants = await Promise.allSettled([1, 2].map(async (scheme) => {
        const prompt = titlePrompt(task, scheme)
        try {
          const result = await generateImage({ prompt, images, aspectRatio: ratio, model: 'gpt-image-2.5-sunburst', resolution: '2k', quality: 'high', removeBackground: task.transparentOutput, backgroundColor: task.backgroundColor })
          return { scheme, urls: result.urls || [], model: 'GPT Image 2.5 Sunburst', fallbackUsed: false, user: result.user }
        } catch {
          const result = await generateImage({ prompt, images, aspectRatio: ratio, model: 'gpt-image-2.5', resolution: '1k', quality: 'high', removeBackground: task.transparentOutput, backgroundColor: task.backgroundColor })
          return { scheme, urls: result.urls || [], model: 'GPT Image 2.5', fallbackUsed: true, user: result.user }
        }
      }))
      const completed = variants.filter((item) => item.status === 'fulfilled').flatMap((item) => item.value.urls.map((url) => ({ url, scheme: item.value.scheme, model: item.value.model, fallbackUsed: item.value.fallbackUsed })))
      if (!completed.length) throw variants.find((item) => item.status === 'rejected')?.reason || new Error('两个标题方案都未生成成功')
      const updatedUser = variants.find((item) => item.status === 'fulfilled' && item.value.user)?.value.user
      if (updatedUser) onUserUpdate?.(updatedUser)
      putTask({ ...task, status: 'succeeded', urls: completed.map((item) => item.url), results: completed, model: completed.every((item) => item.fallbackUsed) ? 'GPT Image 2.5' : 'GPT Image 2.5 Sunburst', fallbackUsed: completed.some((item) => item.fallbackUsed), completedAt: new Date().toISOString() })
    } catch (error) {
      if (error.status === 401) onRequireLogin?.()
      putTask({ ...task, status: 'failed', error: error.message || '标题生成失败，请重试', completedAt: new Date().toISOString() })
    } finally {
      pendingRequests.delete(task.id)
      emit({ creating: false })
    }
  })()
  pendingRequests.set(task.id, request)
}

function taskStatus(task) {
  if (task.status === 'succeeded') return '已完成'
  if (task.status === 'failed') return '生成失败'
  return '正在生成'
}

export default function PulinTitleStudio({ onUserUpdate, onRequireLogin }) {
  const [store, setStore] = useState(titleStore)
  const [preview, setPreview] = useState(null)

  useEffect(() => subscribe(setStore), [])

  function updateDraft(update) { emit({ draft: { ...titleStore.draft, ...update }, error: '' }) }
  async function submit() {
    try { await startGeneration(store.draft, onUserUpdate, onRequireLogin) }
    catch (error) { if (error.status === 401) onRequireLogin?.(); else emit({ error: error.message || '标题生成失败，请重试' }) }
  }

  return <section className="workspace pulin-title-workspace"><div className="pulin-title-page">
    <ToolPageHeader eyebrow="MORE TOOLS" title="朴里节标题工具" description="输入文案，选择排版和拍手图标，生成可直接用于海报的深蓝标题视觉。"/>
    <div className="pulin-title-composer glass-strong">
      <div className="pulin-title-fields">
        <label><span>主标题</span><input value={store.draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="例如：邻里欢聚" maxLength="32"/></label>
        <label><span>副标题 <i>可留空</i></span><input value={store.draft.subtitle} onChange={(event) => updateDraft({ subtitle: event.target.value })} placeholder="例如：万科物业朴里节" maxLength="24"/></label>
      </div>
        <div className="pulin-title-options">
        <div><span>标题排版</span><div className="pulin-option-buttons" role="group" aria-label="标题排版"><button type="button" className={store.draft.layout === 'horizontal' ? 'active' : ''} onClick={() => updateDraft({ layout: 'horizontal' })}>一行字</button><button type="button" className={store.draft.layout === 'stacked' ? 'active' : ''} onClick={() => updateDraft({ layout: 'stacked' })}>两行字</button></div></div>
        <div><span>拍手图标</span><div className="pulin-option-buttons" role="group" aria-label="拍手图标"><button type="button" className={store.draft.hands ? 'active' : ''} onClick={() => updateDraft({ hands: true })}>有</button><button type="button" className={!store.draft.hands ? 'active' : ''} onClick={() => updateDraft({ hands: false })}>无</button></div></div>
        <div className="pulin-title-cutout"><span>输出格式</span><label><input type="checkbox" checked={store.draft.transparentOutput !== false} onChange={(event) => updateDraft({ transparentOutput: event.target.checked })}/>透明 PNG</label><input type="color" value={store.draft.backgroundColor || '#ff00ff'} onChange={(event) => updateDraft({ backgroundColor: event.target.value })} disabled={store.draft.transparentOutput === false} aria-label="自动抠图背景色" title="自动抠图背景色"/><small>建议洋红</small></div>
        <button className="pulin-title-generate" type="button" onClick={submit} disabled={!store.draft.title.trim() || store.creating}>{store.creating ? '正在生成…' : '生成标题'}<Icon name="spark" size={17}/></button>
      </div>
      {store.error && <div className="pulin-title-error">{store.error}</div>}
    </div>
    <div className="pulin-title-task-list">
      {store.tasks.length === 0 ? <div className="pulin-title-empty"><div><Icon name="spark" size={27}/></div><b>开始制作你的第一个标题</b><span>标题会使用 Sunburst 生成；服务不可用时自动改用 Image 2.5。</span></div> : store.tasks.map((task) => <article className={`pulin-title-task status-${task.status}`} key={task.id}>
        <header><div><b>{task.title}</b>{task.subtitle && <span>{task.subtitle}</span>}<small>{new Date(task.createdAt).toLocaleString('zh-CN')} · {task.layout === 'horizontal' ? '一行字' : '两行字'} · 拍手图标{task.hands ? '有' : '无'} · {task.transparentOutput !== false ? '透明 PNG' : '含背景'} · {task.model}</small></div><em>{taskStatus(task)}</em></header>
        {task.status === 'running' && <div className="pulin-title-running"><i/><span>正在生成标题视觉，切换页面后任务会保留。</span></div>}
        {task.status === 'failed' && <div className="pulin-title-error task-error">{task.error}<button type="button" onClick={() => { void startGeneration(task, onUserUpdate, onRequireLogin) }}>重新生成</button></div>}
        {task.urls?.length > 0 && <div className={`pulin-title-results ${task.layout}`}>
          {(task.results || task.urls.map((url, index) => ({ url, scheme: index + 1, model: task.fallbackUsed ? 'GPT Image 2.5' : 'GPT Image 2.5 Sunburst' }))).map((result, index) => <figure key={result.url}><button type="button" onClick={() => setPreview({ url: result.url, urls: task.urls, prompt: titlePrompt(task, result.scheme) })}><img src={result.url} alt={`${task.title} 标题方案 ${result.scheme || index + 1}`}/></button><figcaption><span>方案 {result.scheme || index + 1} · {result.model}</span><button type="button" onClick={() => downloadGeneratedImage(result.url, `${task.title}-朴里节标题-方案${result.scheme || index + 1}`)}><Icon name="download" size={15}/>下载</button></figcaption></figure>)}
        </div>}
      </article>)}
    </div>
  </div>{preview && <ImagePreview url={preview.url} urls={preview.urls} prompt={preview.prompt} onClose={() => setPreview(null)}/>}</section>
}
