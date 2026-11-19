import { useEffect, useState } from 'react'
import { createConversationImageTask, downloadGeneratedImage, fileToDataUrl, getAuthToken, waitForConversationImageTask, waterfallReferenceForRequest } from './api.js'
import './pulinReport.css'

const seasons = [
  { id: 'summer', name: '夏季', clothes: '白色短袖衬衫，深色西裤，黑色皮鞋' },
  { id: 'spring', name: '春夏', clothes: '白色长袖衬衫，深色西裤，黑色皮鞋，深色合身西装外套' },
  { id: 'winter', name: '冬季', clothes: '白色长袖衬衫，深色西装和西裤，黑色皮鞋，外穿深色长款大衣' },
]
const initial = { portrait: '', cards: {}, mode: 'single', people: [], selected: '', title: '业绩战报', subtitle: '', data: '', report: '' }
const listeners = new Set()
let state = initial
let loadedKey = ''
let loadPromise
const active = new Set()
function key() { return 'pulin-report:' + getAuthToken().slice(-16) }
function database() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('dgen-pulin-report', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('drafts')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}
async function readDraft(id) {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly')
    const req = tx.objectStore('drafts').get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}
let writes = Promise.resolve()
function update(change) {
  state = typeof change === 'function' ? change(state) : { ...state, ...change }
  const snapshot = structuredClone(state)
  const id = loadedKey
  writes = writes.catch(() => {}).then(async () => {
    const db = await database()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      tx.objectStore('drafts').put(snapshot, id)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  }).catch(() => { state = { ...state, storageError: '本地保存失败，刷新后草稿可能丢失。' }; listeners.forEach(fn => fn(state)) })
  listeners.forEach(fn => fn(state))
}
async function initialize() {
  const id = key()
  if (loadedKey === id) return
  if (loadPromise) await loadPromise
  loadPromise = (async () => {
    state = { ...initial, ...(await readDraft(id).catch(() => null)) }
    loadedKey = id
    listeners.forEach(fn => fn(state))
    for (const [season, card] of Object.entries(state.cards)) {
      if (card.status === 'running' && card.taskId) void finish(season, card.taskId)
      else if (card.status === 'running') update(current => ({ ...current, cards: { ...current.cards, [season]: { status: 'error', error: '任务提交状态未确认，请检查生成记录后重试。' } } }))
    }
  })()
  await loadPromise
  loadPromise = null
}
async function finish(id, taskId) {
  const owner = key()
  if (active.has(taskId)) return
  active.add(taskId)
  try {
    const result = await waitForConversationImageTask(taskId)
    if (owner === loadedKey && owner === key()) update(current => ({ ...current, cards: { ...current.cards, [id]: { status: 'done', url: result.urls[0] } } }))
  } catch (error) {
    if (owner === loadedKey && owner === key()) update(current => ({ ...current, cards: { ...current.cards, [id]: { ...current.cards[id], status: 'error', error: error.message } } }))
  } finally { active.delete(taskId) }
}
async function generate(season) {
  const owner = key()
  const reference = state.portrait
  if (!reference || state.cards[season.id]?.status === 'running') return
  update(current => ({ ...current, cards: { ...current.cards, [season.id]: { status: 'running' } } }))
  try {
    const result = await createConversationImageTask({
      prompt: `把参考照片中的同一个人生成一张真人写实的职业全身肖像。严格保持原有五官、年龄、肤色和身份特征，不换脸，不卡通。根据照片人物的性别呈现朴邻职业着装：${season.clothes}。女性佩戴金色领结，男性佩戴金色行政领带；衣服整洁得体。正面站立，自然姿态，纯浅灰背景，完整头部到鞋子，不加任何文字或虚构标识。`,
      images: [waterfallReferenceForRequest(reference)], model: 'gpt-image-2.5', resolution: '1k', quality: 'high', aspectRatio: '3:4', knowledge: {},
    })
    const taskId = result.task.id
    if (owner !== loadedKey || owner !== key()) return
    update(current => ({ ...current, cards: { ...current.cards, [season.id]: { ...current.cards[season.id], status: 'running', taskId } } }))
    await finish(season.id, taskId)
  } catch (error) {
    if (owner === loadedKey && owner === key()) update(current => ({ ...current, cards: { ...current.cards, [season.id]: { ...current.cards[season.id], status: 'error', error: error.message } } }))
  }
}
function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败，请重新选择'))
    image.src = source
  })
}
async function makeReport() {
  const sources = state.mode === 'single' ? [state.cards[state.selected]?.url].filter(Boolean) : state.people
  if (!sources.length) throw new Error('请先选择人物图片')
  const lines = state.data.split('\n').filter(line => line.trim())
  if (!state.title.trim() || !lines.length) throw new Error('请填写战报标题和数据')
  if (lines.length > 6 || lines.some(line => line.length > 28)) throw new Error('战报数据最多 6 行，每行最多 28 个字')
  const images = await Promise.all(['/pulin-report-background.png', ...sources].map(loadImage))
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1440
  const ctx = canvas.getContext('2d')
  ctx.drawImage(images[0], 0, 0, 1080, 1440)
  ctx.fillStyle = '#bd4a17'
  ctx.font = 'bold 76px sans-serif'
  ctx.fillText(state.title.slice(0, 12), 76, 140, 920)
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText('朴邻', 930, 140)
  ctx.fillStyle = '#593e33'
  ctx.font = '30px sans-serif'
  ctx.fillText(state.subtitle.slice(0, 24), 80, 200)
  const portraits = images.slice(1)
  const columns = Math.min(portraits.length, 3)
  const rows = Math.ceil(portraits.length / columns)
  const width = Math.min(430, 900 / columns)
  const height = rows === 1 ? Math.min(620, width * 1.4) : 315
  const start = (1080 - width * columns) / 2
  portraits.forEach((image, i) => {
    const x = start + (i % columns) * width
    const y = 250 + Math.floor(i / columns) * (height + 12)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x + 8, y, width - 16, height, 24)
    ctx.clip()
    const scale = Math.max((width - 16) / image.width, height / image.height)
    ctx.drawImage(image, x + 8 + (width - 16 - image.width * scale) / 2, y + (height - image.height * scale) / 2, image.width * scale, image.height * scale)
    ctx.restore()
  })
  ctx.fillStyle = '#4e3027'
  ctx.font = 'bold 40px sans-serif'
  lines.forEach((line, i) => ctx.fillText(line, 100, 1000 + i * 58, 880))
  update({ ...state, report: canvas.toDataURL('image/png') })
}
export default function PulinReport({ user, onLogin }) {
  const [view, setView] = useState(state)
  const [ready, setReady] = useState(false)
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    listeners.add(setView)
    let mounted = true
    setReady(false)
    if (user) { setView(loadedKey === key() ? state : initial); void initialize().then(() => { if (mounted) { setView(state); setReady(true) } }) }
    return () => { mounted = false; listeners.delete(setView) }
  }, [user])
  async function upload(event, multiple) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    if (multiple && files.length > 6) { setError('多人战报最多支持 6 张照片'); return }
    if (files.some(file => !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024)) { setError('请选择 10MB 以内的图片'); return }
    try {
      const urls = await Promise.all(files.map(fileToDataUrl))
      update(multiple ? { ...state, people: urls } : { ...state, portrait: urls[0], cards: {}, selected: '' })
      setError('')
      if (!multiple) seasons.forEach(season => void generate(season))
    } catch { setError('图片读取失败，请重试') }
  }
  if (!user) return <section className="pulin-report"><h1>朴邻战报制作</h1><p>登录后即可生成着装照和战报。</p><button onClick={onLogin}>登录</button></section>
  if (!ready) return <section className="pulin-report" role="status">正在读取战报草稿…</section>
  return <section className="pulin-report">
    <header><h1>朴邻战报制作</h1><p>先生成真人着装照，再制作个人或团队战报。</p></header>
    {(error || view.storageError) && <p role="alert" className="pr-error">{error || view.storageError}</p>}
    <div className="pr-section"><h2>人物着装照</h2><p>上传一张清晰正面照片，系统将根据人物照片生成对应着装。</p>
      <label className="pr-upload">{view.portrait ? <img src={view.portrait} alt="已上传头像"/> : <span>上传人物头像</span>}<input type="file" accept="image/*" disabled={seasons.some(s => view.cards[s.id]?.status === 'running')} onChange={e => upload(e, false)}/></label>
      <button disabled={!view.portrait || seasons.some(s => view.cards[s.id]?.status === 'running')} onClick={() => seasons.forEach(s => void generate(s))}>生成三季着装</button>
      <div className="pr-cards">{seasons.map(s => { const c = view.cards[s.id]; return <article key={s.id}><h3>{s.name}着装</h3><div className="pr-image">{c?.url ? <img src={c.url} alt={s.name + '真人着装'}/> : <span>{c?.status === 'running' ? '正在生成…' : '等待生成'}</span>}</div>{c?.error && <p role="alert">{c.error}</p>}<div><button disabled={!view.portrait || c?.status === 'running'} onClick={() => void generate(s)}>{c?.url ? '重新生成' : '单独生成'}</button>{c?.url && <button onClick={() => downloadGeneratedImage(c.url, '朴邻' + s.name + '着装')}>下载</button>}</div></article> })}</div>
    </div>
    <div className="pr-section"><h2>制作战报</h2><div className="pr-mode"><button aria-pressed={view.mode === 'single'} onClick={() => update({ ...state, mode: 'single' })}>单人</button><button aria-pressed={view.mode === 'multiple'} onClick={() => update({ ...state, mode: 'multiple' })}>多人</button></div>
      {view.mode === 'single' ? <><button onClick={() => setPicker(true)}>选择着装照</button>{view.selected && <p>已选择{seasons.find(s => s.id === view.selected)?.name}着装</p>}</> : <label className="pr-upload"><span>上传多人照片（最多 6 张）</span><input type="file" accept="image/*" multiple onChange={e => upload(e, true)}/></label>}
      {view.mode === 'multiple' && <div className="pr-people">{view.people.map((src, i) => <img key={i} src={src} alt={`人物${i + 1}`}/>)}</div>}
      <label>战报标题<input maxLength={12} value={view.title} onChange={e => update({ ...state, title: e.target.value })}/></label>
      <label>副标题<input maxLength={24} value={view.subtitle} onChange={e => update({ ...state, subtitle: e.target.value })}/></label>
      <label>战报数据<textarea maxLength={180} rows={5} value={view.data} placeholder={'每行填写一项，例如：\n本月成交 36 单\n目标完成率 120%'} onChange={e => update({ ...state, data: e.target.value })}/></label>
      <button onClick={() => makeReport().catch(e => setError(e.message))}>生成战报</button>
      {view.report && <div className="pr-result"><img src={view.report} alt="生成的朴邻战报"/><a href={view.report} download="朴邻战报.png">下载战报</a></div>}
    </div>
    {picker && <div className="pr-overlay" onClick={() => setPicker(false)}><div className="pr-modal" role="dialog" aria-modal="true" aria-label="选择着装照" onClick={e => e.stopPropagation()}><header><h2>选择着装照</h2><button onClick={() => setPicker(false)}>关闭</button></header><div className="pr-cards">{seasons.map(s => <button key={s.id} disabled={!view.cards[s.id]?.url} onClick={() => { update({ ...state, selected: s.id }); setPicker(false) }}>{view.cards[s.id]?.url ? <img src={view.cards[s.id].url} alt=""/> : <span>尚未生成</span>}<b>{s.name}</b></button>)}</div></div></div>}
  </section>
}
