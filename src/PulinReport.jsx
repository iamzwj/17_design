import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createConversationImageTask, downloadGeneratedImage, fileToDataUrl, waitForConversationImageTask, waterfallReferenceForRequest } from './api.js'
import { imageDropProps } from './imageDropUpload.js'
import ImagePreview from './ImagePreview.jsx'
import './pulinReport.css'

const seasons = [
  { id: 'summer', name: '夏季', clothes: '白色短袖衬衫，深色西裤，黑色皮鞋' },
  { id: 'spring', name: '春秋', clothes: '白色长袖衬衫，深色西裤，黑色皮鞋，深色合身西装外套' },
  { id: 'winter', name: '冬季', clothes: '白色长袖衬衫，深色西装和西裤，黑色皮鞋，外穿深色长款大衣' },
]
const halfSeasons = seasons.map(season => ({ ...season, id: `${season.id}-half`, half: true }))
const allSeasons = [...seasons, ...halfSeasons]
const initial = { portrait: '', gender: '', framing: 'full', cards: {}, wardrobeHistory: [], selectedWardrobe: [], mode: 'single', people: [], selected: '', title: '业绩战报', subtitle: '', data: '', report: '' }
function wardrobePhotos(draft) {
  const photos = [...(draft.wardrobeHistory || [])];
  for (const [seasonId, card] of Object.entries(draft.cards || {})) {
    if (card.url && !photos.some(photo => photo.url === card.url)) photos.push({id:card.url,url:card.url,seasonId});
  }
  return photos;
}
function wardrobeName(photo) {
  const season=allSeasons.find(item=>item.id===photo.seasonId);
  return season ? `${season.name}${season.half ? '半身' : '全身'}` : '人物着装照';
}
const listeners = new Set()
let state = initial
let loadedKey = ''
let loadPromise
const taskStates = new Map()
const active = new Set()
function key(taskId) { return 'pulin-report:' + taskId }
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
function update(change, id = loadedKey) {
  const current = taskStates.get(id) || (id === loadedKey ? state : initial)
  const next = typeof change === 'function' ? change(current) : { ...current, ...change }
  taskStates.set(id, next)
  if (id === loadedKey) state = next
  const snapshot = structuredClone(next)
  writes = writes.catch(() => {}).then(async () => {
    const db = await database()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      tx.objectStore('drafts').put(snapshot, id)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    })
  }).catch(() => { state = { ...state, storageError: '本地保存失败，刷新后草稿可能丢失。' }; listeners.forEach(fn => fn(state)) })
  if (id === loadedKey) listeners.forEach(fn => fn(state))
}
async function initialize(taskId) {
  const id = key(taskId)
  if (loadedKey === id) return
  if (loadPromise) await loadPromise
  loadPromise = (async () => {
    state = taskStates.get(id) || { ...initial, ...(await readDraft(id).catch(() => null)) }
    taskStates.set(id, state)
    loadedKey = id
    listeners.forEach(fn => fn(state))
    for (const [season, card] of Object.entries(state.cards)) {
      if (card.status === 'running' && card.taskId) void finish(season, card.taskId, id)
      else if (card.status === 'running') update(current => ({ ...current, cards: { ...current.cards, [season]: { status: 'error', error: '任务提交状态未确认，请检查生成记录后重试。' } } }))
    }
  })()
  await loadPromise
  loadPromise = null
}
async function finish(id, taskId, owner) {
  if (active.has(taskId)) return
  active.add(taskId)
  try {
    const result = await waitForConversationImageTask(taskId)
    const url = (taskStates.get(owner)?.cards[id]?.cropToFraming)
      ? await cropPortraitPhoto(result.urls[0], id.endsWith('-half'))
      : result.urls[0]
    update(current => ({ ...current, wardrobeHistory: [...wardrobePhotos(current), {id:url,url,seasonId:id}].filter((photo,index,list)=>list.findIndex(item=>item.url===photo.url)===index), cards: { ...current.cards, [id]: { status: 'done', url, uniformVersion: 3 } } }), owner)
  } catch (error) {
    update(current => ({ ...current, cards: { ...current.cards, [id]: { ...current.cards[id], status: 'error', error: error.message } } }), owner)
  } finally { active.delete(taskId) }
}
async function generate(season, owner = loadedKey) {
  const draft = taskStates.get(owner) || state
  const reference = draft.portrait
  if (!reference || !['female', 'male'].includes(draft.gender) || draft.cards[season.id]?.status === 'running') return
  update(current => ({ ...current, cards: { ...current.cards, [season.id]: { status: 'running', cropToFraming: true } } }), owner)
  try {
    const images = [waterfallReferenceForRequest(reference)]
    const female = draft.gender === 'female'
    if (female) {
      const collarResponse = await fetch('/pulin-collar-reference.png')
      if (!collarResponse.ok) throw new Error('着装参考图加载失败，请重试')
      images.push(await fileToDataUrl(await collarResponse.blob()))
    }
    const accessory = female
      ? '使用女款制服。领口只佩戴第二张参考图中的金棕色领花：两片交叠向下的尖角，顶部圆形扣饰。禁止长领带和横向蝴蝶结。'
      : '使用男款制服。领口只佩戴一条金色行政长领带，单条长形垂至腰部，禁止领花和蝴蝶结。'
    const framing = season.half
      ? '两寸竖版证件照构图，画面从胸部上沿到头顶以上，领口配饰完整可见，肩膀和面部居中，留少量头顶空间。'
      : '9:16 竖版全身构图，完整头部到鞋子，左右各留边，四肢和衣物远离画面边缘。'
    const result = await createConversationImageTask({
      prompt: `第一张参考图仅用于还原人物。生成同一个人的真人写实职业肖像，保持五官、年龄、肤色和身份特征，不换脸，不卡通。${season.name}着装：${season.clothes}。${accessory}正面站立，自然姿态，浅灰背景。${framing}不加文字。`,
      images, model: 'gpt-image-2.5', resolution: '1k', quality: 'high', aspectRatio: season.half ? '3:4' : '9:16', knowledge: {},
    })
    const taskId = result.task.id
    update(current => ({ ...current, cards: { ...current.cards, [season.id]: { ...current.cards[season.id], status: 'running', taskId } } }), owner)
    await finish(season.id, taskId, owner)
  } catch (error) {
    update(current => ({ ...current, cards: { ...current.cards, [season.id]: { ...current.cards[season.id], status: 'error', error: error.message } } }), owner)
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
async function cropPortraitPhoto(url, half) {
  const image = await loadImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = half ? 750 : 576
  canvas.height = half ? 1050 : 1024
  const ratio = canvas.width / canvas.height
  const width = Math.min(image.width, image.height * ratio)
  const height = width / ratio
  const x = (image.width - width) / 2
  const y = half ? 0 : (image.height - height) / 2
  canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.92)
}
async function makeReport() {
  const owner = loadedKey
  const draft = state
  const chosen = wardrobePhotos(draft).filter(photo => (draft.selectedWardrobe || []).includes(photo.id)).map(photo=>photo.url)
  const sources = draft.mode === 'single' ? (chosen.length ? chosen.slice(0,1) : [draft.cards[draft.selected]?.url].filter(Boolean)) : [...chosen, ...draft.people].slice(0,10)
  if (!sources.length) throw new Error('请先选择人物图片')
  const lines = draft.data.split('\n').filter(line => line.trim())
  if (!draft.title.trim() || !lines.length) throw new Error('请填写战报标题和数据')
  if (lines.length > 6 || lines.some(line => line.length > 28)) throw new Error('战报数据最多 6 行，每行最多 28 个字')
  const images = await Promise.all(['/pulin-report-background.png', ...sources].map(loadImage))
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1440
  const ctx = canvas.getContext('2d')
  ctx.drawImage(images[0], 0, 0, 1080, 1440)
  ctx.fillStyle = '#bd4a17'
  ctx.font = 'bold 76px sans-serif'
  ctx.fillText(draft.title.slice(0, 12), 76, 140, 920)
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText('朴邻', 930, 140)
  ctx.fillStyle = '#593e33'
  ctx.font = '30px sans-serif'
  ctx.fillText(draft.subtitle.slice(0, 24), 80, 200)
  const portraits = images.slice(1)
  const columns = Math.min(portraits.length, portraits.length > 6 ? 4 : 3)
  const rows = Math.ceil(portraits.length / columns)
  const width = Math.min(430, 900 / columns)
  const height = rows === 1 ? Math.min(620, width * 1.4) : Math.min(315, (700 - (rows - 1) * 12) / rows)
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
  update(current => ({ ...current, report: canvas.toDataURL('image/png') }), owner)
}
export default function PulinReport({ user, onLogin, taskId, onSave }) {
  const [view, setView] = useState(state)
  const [ready, setReady] = useState(false)
  const [picker, setPicker] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    listeners.add(setView)
    let mounted = true
    setReady(false)
    if (user) { setView(loadedKey === key(taskId) ? state : initial); void initialize(taskId).then(() => { if (mounted) { setView(state); setReady(true) } }) }
    return () => { mounted = false; listeners.delete(setView) }
  }, [user, taskId])
  async function upload(event, multiple) {
    const owner = loadedKey
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    if (multiple && files.length + (state.selectedWardrobe || []).length > 10) { setError('多人战报最多支持 10 张照片（含已选着装照）'); return }
    if (files.some(file => !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024)) { setError('请选择 10MB 以内的图片'); return }
    try {
      const urls = await Promise.all(files.map(fileToDataUrl))
      update(current => multiple ? { ...current, people: urls } : { ...current, portrait: urls[0], wardrobeHistory: wardrobePhotos(current), cards: {}, selected: '' }, owner)
      setError('')
      if (!multiple) onSave({ id: taskId, type: 'pulin-report', title: '朴邻战报制作', messages: [], activate: true })
    } catch { setError('图片读取失败，请重试') }
  }
  if (!user) return <section className="pulin-report"><h1>朴邻战报制作</h1><p>登录后即可生成着装照和战报。</p><button onClick={onLogin}>登录</button></section>
  if (!ready) return <section className="pulin-report" role="status">正在读取战报草稿…</section>
  const anyGenerating = allSeasons.some(season => view.cards[season.id]?.status === 'running')
  const visibleSeasons = view.framing === 'half' ? halfSeasons : seasons
  const generating = visibleSeasons.some(season => view.cards[season.id]?.status === 'running')
  const pendingSeasons = visibleSeasons.filter(season => view.cards[season.id]?.uniformVersion !== 3)
  const canGenerate = Boolean(view.portrait && view.gender)
  return <section className="pulin-report">
    <header className="pr-intro"><h1>朴邻战报制作</h1><p>上传头像生成标准着装，再制作个人或团队战报。</p><div className="pr-steps"><span><b>01</b> 生成着装照</span><i/><span><b>02</b> 制作战报</span></div></header>
    {(error || view.storageError) && <p role="alert" className="pr-error">{error || view.storageError}</p>}
    <div className="pr-section"><span className="pr-step-number">01 / 着装照</span><h2>生成人物着装照</h2><p>上传清晰的正面头像，生成三季真人着装。</p>
      <div className="pr-portrait-row">
        {view.portrait
          ? <button type="button" className="pr-upload pr-portrait-upload" aria-label="预览已上传的头像" onClick={() => setPreview({ url: view.portrait, title: '人物头像' })}><img src={view.portrait} alt="已上传的头像"/></button>
          : <label {...imageDropProps} className="pr-upload pr-portrait-upload"><span aria-hidden="true">＋</span><input type="file" accept="image/*" aria-label="上传人物头像" disabled={anyGenerating} onChange={e => upload(e, false)}/></label>}
        <div className="pr-portrait-info">
          <strong>{view.portrait ? '头像已上传' : '上传人物头像'}</strong>
          <small>建议使用正面、光线均匀的清晰照片，单张不超过 10MB</small>
          <label {...imageDropProps} className="pr-file-button">{view.portrait ? '更换头像' : '选择照片'}<input type="file" accept="image/*" disabled={anyGenerating} onChange={e => upload(e, false)}/></label>
        </div>
        <div className="pr-portrait-actions">
          <fieldset className="pr-segments" aria-label="性别" disabled={anyGenerating}>
            <label><input type="radio" name="pulin-uniform-gender" checked={view.gender === 'male'} onChange={() => update(current=>({...current,gender:'male',wardrobeHistory:wardrobePhotos(current),cards:{},selected:''}))}/>男</label>
            <label><input type="radio" name="pulin-uniform-gender" checked={view.gender === 'female'} onChange={() => update(current=>({...current,gender:'female',wardrobeHistory:wardrobePhotos(current),cards:{},selected:''}))}/>女</label>
          </fieldset>
          <fieldset className="pr-segments" aria-label="照片构图">
            <label><input type="radio" name="pulin-uniform-framing" checked={view.framing === 'full'} onChange={() => update({ framing: 'full' })}/>全身</label>
            <label><input type="radio" name="pulin-uniform-framing" checked={view.framing === 'half'} onChange={() => update({ framing: 'half' })}/>半身</label>
          </fieldset>
          {pendingSeasons.length > 0 && <button className="pr-generate-all" disabled={!canGenerate || generating} onClick={() => pendingSeasons.forEach(season => void generate(season))}>{generating ? '生成中…' : '生成'}</button>}
        </div>
      </div>
      <div className={`pr-cards pr-uniform-results${view.framing === 'half' ? ' pr-half-results' : ''}`}>{visibleSeasons.map(season => {
        const card = view.cards[season.id]
        const photo = card?.uniformVersion === 3 ? card.url : ''
        const title = '朴邻' + season.name + (season.half ? '半身' : '全身') + '着装'
        return <article key={season.id}>
          <h3>{season.name}着装</h3>
          <div className="pr-image">{photo
            ? <button type="button" className="pr-photo-preview" aria-label={'预览' + title} onClick={() => setPreview({ url: photo, title })}><img src={photo} alt={season.name + '真人着装'}/></button>
            : <span>{card?.status === 'running' ? '正在生成…' : card?.url ? '着装规范已更新，请重新生成' : card?.error ? '生成失败' : '待生成'}</span>}
          </div>
          {card?.error && <p role="alert">{card.error}</p>}
          <div className="pr-card-actions">
            {photo && <button onClick={() => void downloadGeneratedImage(photo, title)}>下载</button>}
            {(photo || card?.error) && <button disabled={!canGenerate || generating} onClick={() => void generate(season)}>{photo ? '重新生成' : '重试'}</button>}
          </div>
        </article>
      })}</div>
    </div>
    <div className="pr-section pr-report-section"><span className="pr-step-number">02 / 战报制作</span><h2>制作战报</h2><p>选择人物照片并填写业绩数据，生成可下载的战报。</p><div className="pr-mode"><button aria-pressed={view.mode === 'single'} onClick={() => update({ ...state, mode: 'single', selectedWardrobe: (state.selectedWardrobe || []).slice(0,1) })}>单人战报</button><button aria-pressed={view.mode === 'multiple'} onClick={() => update({ ...state, mode: 'multiple' })}>多人战报</button></div>
      <button onClick={() => setPicker(true)}>选择着装照</button><p>已选择 {(view.selectedWardrobe || []).length} 张</p>
      {view.mode !== 'single' && <label {...imageDropProps} className="pr-upload"><span>上传多人照片（最多 10 张）</span><input type="file" accept="image/*" multiple onChange={e => upload(e, true)}/></label>}
      {view.mode === 'multiple' && <div className="pr-people">{view.people.map((src, i) => <img key={i} src={src} alt={`人物${i + 1}`}/>)}</div>}
      <label>战报标题<input maxLength={12} value={view.title} onChange={e => update({ ...state, title: e.target.value })}/></label>
      <label>副标题<input maxLength={24} value={view.subtitle} onChange={e => update({ ...state, subtitle: e.target.value })}/></label>
      <label>战报数据<textarea maxLength={180} rows={5} value={view.data} placeholder={'每行填写一项，例如：\n本月成交 36 单\n目标完成率 120%'} onChange={e => update({ ...state, data: e.target.value })}/></label>
      <button onClick={() => makeReport().catch(e => setError(e.message))}>生成战报</button>
      {view.report && <div className="pr-result"><img src={view.report} alt="生成的朴邻战报"/><a href={view.report} download="朴邻战报.png">下载战报</a></div>}
    </div>
    {preview && createPortal(<ImagePreview url={preview.url} prompt={preview.title} onClose={() => setPreview(null)}/>, document.body)}
    {picker && <div className="pr-overlay" onClick={() => setPicker(false)}><div className="pr-modal" role="dialog" aria-modal="true" aria-label="选择着装照" onClick={e => e.stopPropagation()}><header><h2>选择着装照</h2><button onClick={() => setPicker(false)}>完成</button></header><p>{view.mode === 'single' ? '单人模式：选择一张' : '多人模式：最多选择十张（含上传照片）'}</p><div className="pr-cards">{wardrobePhotos(view).map(photo => <button key={photo.id} aria-pressed={(view.selectedWardrobe || []).includes(photo.id)} onClick={() => { update(current => { const chosen=current.selectedWardrobe || []; const next=current.mode==='single' ? [photo.id] : chosen.includes(photo.id) ? chosen.filter(id=>id!==photo.id) : chosen.length + current.people.length < 10 ? [...chosen,photo.id] : chosen; return {...current,selected:'',selectedWardrobe:next}; }); if(view.mode==='single')setPicker(false); }}><img src={photo.url} alt={wardrobeName(photo)}/><b>{(view.selectedWardrobe || []).includes(photo.id) ? '✓ ' : ''}{wardrobeName(photo)}</b></button>)}</div>{!wardrobePhotos(view).length && <p>当前对话还没有生成的人物着装照。</p>}</div></div>}
  </section>
}
