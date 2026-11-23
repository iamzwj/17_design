import {maleUniformAccessory} from './pulinUniformRules.js';
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createConversationImageTask, downloadGeneratedImage, fileToDataUrl, waitForConversationImageTask } from './api.js'
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
const initial = { portrait: '', gender: '', framing: 'full', cards: {}, wardrobeHistory: [], selectedWardrobe: [], mode: 'single', people: [], selected: '', title: '业绩战报', subtitle: '', data: '', report: '', region: '', performance: '', team: '', perPerson: '', inventory: '', rentals: '', newHomes: '' }
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
  const wasRunning = (current.reportStatus === 'running' || Object.values(current.cards || {}).some(card => card.status === 'running'))
  const isRunning = (next.reportStatus === 'running' || Object.values(next.cards || {}).some(card => card.status === 'running'))
  if (wasRunning !== isRunning) window.dispatchEvent(new CustomEvent('pulin-report-status', { detail: { id: id.slice('pulin-report:'.length), status: isRunning ? 'running' : 'idle' } }))
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
    if (state.reportStatus === 'running') {
      if (state.reportTaskId) void finishTeamReport(state.reportTaskId, id)
      else update({ reportStatus: 'error', reportError: '提交状态未确认，请先检查生成记录再重试。' }, id)
    }
    for (const [season, card] of Object.entries(state.cards)) {
      if (card.status === 'running' && card.taskId) void finish(season, card.taskId, id)
      else if (card.status === 'running') update(current => ({ ...current, cards: { ...current.cards, [season]: { status: 'error', error: '任务提交状态未确认，请检查生成记录后重试。' } } }))
    }
  })()
  await loadPromise
  loadPromise = null
}
export async function resumePulinReportTasks(taskId) {
  const owner = key(taskId)
  const draft = taskStates.get(owner) || await readDraft(owner).catch(() => null)
  if (!draft) return
  taskStates.set(owner, draft)
  if (draft.reportStatus === 'running' && draft.reportTaskId) void finishTeamReport(draft.reportTaskId, owner)
  const cards = Object.entries(draft.cards || {})
  for (const [season, card] of cards) {
    if (card.status === 'running' && card.taskId) void finish(season, card.taskId, owner)
    else if (card.status === 'running') update(current => ({ ...current, cards: { ...current.cards, [season]: { status: 'error', error: '任务提交状态未确认，请检查生成记录后重试。' } } }), owner)
  }
  const current = taskStates.get(owner)
  window.dispatchEvent(new CustomEvent('pulin-report-status', { detail: { id: taskId, status: (current.reportStatus === 'running' || Object.values(current.cards || {}).some(card => card.status === 'running')) ? 'running' : 'idle' } }))
}
async function finish(id, taskId, owner) {
  if (active.has(taskId)) return
  active.add(taskId)
  try {
    const result = await waitForConversationImageTask(taskId)
    const url = (taskStates.get(owner)?.cards[id]?.cropToFraming)
      ? await cropPortraitPhoto(result.urls[0], id.endsWith('-half'))
      : result.urls[0]
    update(current => ({ ...current, wardrobeHistory: [...wardrobePhotos(current), {id:url,url,seasonId:id,batchId:current.wardrobeBatchId || 'legacy'}], cards: { ...current.cards, [id]: { status: 'done', url, uniformVersion: 3, gender: current.cards[id]?.gender || current.gender } } }), owner)
  } catch (error) {
    update(current => ({ ...current, cards: { ...current.cards, [id]: { ...current.cards[id], status: 'error', error: error.message } } }), owner)
  } finally { active.delete(taskId) }
}
async function generate(season, owner = loadedKey) {
  const draft = taskStates.get(owner) || state
  const reference = draft.portrait
  if (!reference || !['female', 'male'].includes(draft.gender) || draft.cards[season.id]?.status === 'running') return
  update(current => ({ ...current, cards: { ...current.cards, [season.id]: { status: 'running', cropToFraming: true, gender: draft.gender } } }), owner)
  try {
    const images = [await compressReference(reference)]
    const female = draft.gender === 'female'
    if (female) {
      const collarResponse = await fetch('/pulin-collar-reference.png')
      if (!collarResponse.ok) throw new Error('着装参考图加载失败，请重试')
      images.push(await fileToDataUrl(await collarResponse.blob()))
    }
    const accessory = female
      ? '使用女款制服。领口只佩戴第二张参考图中的金棕色领花：两片交叠向下的尖角，顶部圆形扣饰。禁止长领带和横向蝴蝶结。'
      : maleUniformAccessory(season.id)
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
async function compressReference(source, maxEdge = 1600) {
  const image = await loadImage(source)
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('无法处理人物参考图，请重新选择照片')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  try {
    return canvas.toDataURL('image/jpeg', 0.86)
  } catch {
    throw new Error('无法处理人物参考图，请重新选择照片')
  }
}
async function teamIdentityReference(source, index) {
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = 1400; canvas.height = 1600
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1400, 1600)
  const scale = Math.min(850 / image.width, 1450 / image.height)
  ctx.drawImage(image, (850-image.width*scale)/2, 110, image.width*scale, image.height*scale)
  // Portrait uploads are centered: retain the complete source and add a larger
  // upper-body detail, so full-length references do not reduce faces to pixels.
  const cropWidth = Math.min(image.width, image.height * .65)
  const cropHeight = Math.min(image.height, cropWidth * 1.3)
  ctx.drawImage(image, (image.width-cropWidth)/2, 0, cropWidth, cropHeight, 870, 110, 510, 663)
  ctx.fillStyle = '#111'; ctx.font = 'bold 38px sans-serif'
  ctx.fillText(`人物 ${index + 1} / 同一人的原图与上半身细节`, 35, 65)
  return canvas.toDataURL('image/jpeg', .95)
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
  if (draft.reportStatus === 'running') return
  const chosen = wardrobePhotos(draft).filter(photo => (draft.selectedWardrobe || []).includes(photo.id)).map(photo=>photo.url)
  const sources = draft.mode === 'single' ? (chosen.length ? chosen.slice(0,1) : draft.people.slice(0,1)) : [...chosen, ...draft.people].slice(0,10)
  if (!sources.length) throw new Error('请先选择人物形象照')
  if (draft.mode === 'multiple' && sources.length > 8) throw new Error('团队战报最多支持 8 张人物参考照，请减少形象照后重试')
  if (draft.mode === 'single' && (!draft.title.trim() || !draft.data.trim())) throw new Error('请填写战报标题和数据')
  if (draft.mode === 'multiple' && (!draft.region?.trim() || !draft.performance?.trim())) throw new Error('请填写片区和累计业绩')
  update({ reportStatus: 'running', reportError: '', report: '', reportDraft: { ...draft, portrait: '', people: [], cards: {}, wardrobeHistory: [], report: '', teamCutout: draft.mode === 'multiple' } }, owner)
  if (draft.mode === 'multiple' || draft.people.length) {
    try {
      const background = await fetch(draft.mode === 'multiple' ? '/pulin-team-background.jpg' : '/pulin-report-background.png').then(r => r.blob()).then(fileToDataUrl)
      const compressedSources = await Promise.all(sources.map((source,index) => draft.mode === 'multiple' ? teamIdentityReference(source,index) : compressReference(source)))
      const collarResponse = await fetch('/pulin-collar-reference.png')
      if (!collarResponse.ok) throw new Error('领花规范参考图加载失败，请重试')
      const collarReference = await fileToDataUrl(await collarResponse.blob())
      const teamPrompt = `只生成一组真人摄影风格团队人物抠图。参考图共有 ${compressedSources.length} 张，每张参考板编号对应一个不同的人；同一板中的原图和放大细节是同一个人，不能算成两个人。人物按编号从后排左至右、再前排左至右排列，面部必须严格对应同编号原图，不得平均五官、套用同一张脸或以相似人物替代。画面必须恰好出现 ${compressedSources.length} 人，每人仅出现一次，禁止新增人物或复制人物。逐一保持每人的五官、年龄、肤色、发型与身份特征，不要美化或替换面貌。穿深色正式西装、白色衬衫。最后一张是领花规范参考图，不是人物，不计入人数。女性领口必须使用该参考图的金棕色领花：顶部圆形扣饰、两片交叠向下的尖角，尺寸适中、对称贴合领口，禁止长领带、横向蝴蝶结、丝巾和任意飘带。保留各人物参考照的性别与配饰类型，不按长短发判断性别。男性使用行政领带，外套扣好，领带下半段和尖端必须被前襟遮住。部分站立、部分坐在简洁的黑色椅子上，人物完整，从头到鞋无遮挡，构图紧凑，边缘留白。背景必须是纯色 #00ff00 绿色，无渐变、无阴影、无舞台、无文字、无装饰，不能穿绿色。`
      const result = await createConversationImageTask({
        prompt: draft.mode === 'single'
          ? '参考第二张人物照片生成同一人的春秋着装全身形象，保持面貌身份，白色衬衫和深色合身西装，领口配饰严格沿用人物参考照，女性领花必须参照最后一张领花规范图的顶部圆扣和两片交叠下垂尖角，禁止长领带、横向蝴蝶结或丝巾，不按头发长短判断性别。背景简洁，不添加文字。'
          : teamPrompt,
        images: draft.mode === 'single' ? [background, ...compressedSources, collarReference] : [...compressedSources, collarReference],
        model: 'gpt-image-2.5', resolution: draft.mode === 'multiple' ? '2k' : '1k', quality: 'high',
        aspectRatio: draft.mode === 'single' ? '9:16' : '1:1', knowledge: {},
        ...(draft.mode === 'multiple' ? { removeBackground: true, backgroundColor: '#00ff00' } : {}),
      })
      update({ reportTaskId: result.task.id }, owner)
      await finishTeamReport(result.task.id, owner)
    } catch (error) { update({ reportStatus: 'error', reportError: error.message }, owner); throw error }
    return
  }
  try { await renderSingleReport(sources[0], draft, owner) }
  catch (error) { update({ reportStatus: 'error', reportError: error.message }, owner); throw error }
}
async function renderSingleReport(source, draft, owner) {
  const sources = [source]
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
  update(current => ({ ...current, report: canvas.toDataURL('image/png'), reportStatus: 'done', reportTaskId: null }), owner)
}
async function finishTeamReport(taskId, owner) {
  const runtimeKey = `report:${taskId}`
  if (active.has(runtimeKey)) return
  active.add(runtimeKey)
  try {
    const output = await waitForConversationImageTask(taskId)
    const draft = taskStates.get(owner)?.reportDraft
    if (!draft) throw new Error('无法恢复战报数据，请重新生成')
    if (draft.mode === 'single') await renderSingleReport(output.urls[0], draft, owner)
    else await renderTeamReport(output.urls[0], draft, owner)

  } catch (error) { update({ reportStatus: 'error', reportError: error.message, reportTaskId: null }, owner) }
  finally { active.delete(runtimeKey) }
}
async function renderTeamReport(url, draft, owner) {
  const [image, background] = await Promise.all([loadImage(url), loadImage('/pulin-team-background.jpg')])
  const canvas = document.createElement('canvas')
  canvas.width = 826; canvas.height = 1903
  const ctx = canvas.getContext('2d')
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height)
  if (draft.teamCutout) {
    const scratch = document.createElement('canvas')
    scratch.width = image.naturalWidth
    scratch.height = image.naturalHeight
    const scan = scratch.getContext('2d', { willReadFrequently: true })
    scan.drawImage(image, 0, 0)
    const pixels = scan.getImageData(0, 0, scratch.width, scratch.height).data
    let left = scratch.width, right = -1, top = scratch.height, bottom = -1
    for (let y = 0; y < scratch.height; y++) {
      for (let x = 0; x < scratch.width; x++) {
        if (pixels[(y * scratch.width + x) * 4 + 3] < 32) continue
        left = Math.min(left, x); right = Math.max(right, x)
        top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
    }
    if (right < left || left === 0 && top === 0 && right === scratch.width - 1 && bottom === scratch.height - 1) {
      throw new Error('人物背景未能去除，请重新生成')
    }
    const sourceWidth = right - left + 1
    const sourceHeight = bottom - top + 1
    const scale = Math.min(760 / sourceWidth, 610 / sourceHeight)
    const width = sourceWidth * scale, height = sourceHeight * scale
    ctx.drawImage(image, left, top, sourceWidth, sourceHeight, (826 - width) / 2, 960 - height, width, height)
  } else {
    // Existing in-flight tasks use the previous full-poster generation format.
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height)
    const width = image.width * scale, height = image.height * scale
    ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
    const headerHeight = 335, boundary = 985
    ctx.drawImage(background, 0, 0, background.width, background.height * headerHeight / canvas.height, 0, 0, canvas.width, headerHeight)
    const sourceY = background.height * boundary / canvas.height
    ctx.drawImage(background, 0, sourceY, background.width, background.height - sourceY, 0, boundary, canvas.width, canvas.height - boundary)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#f2c893'
  ctx.font = 'bold 42px sans-serif'
  ctx.fillText(draft.region, 413, 1050, 650)
  ctx.strokeStyle = '#d6a76f'
  ctx.beginPath()
  ctx.moveTo(28, 1031); ctx.lineTo(100, 1031)
  ctx.moveTo(726, 1031); ctx.lineTo(798, 1031)
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = '36px sans-serif'
  ctx.fillText('全年累计业绩突破', 413, 1157, 740)
  const rawPerformance = String(draft.performance || '').trim()
  const compact = rawPerformance.replace(/,/g, '')
  const performance = /^\d+(?:\.\d+)?$/.test(compact)
    ? compact.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : rawPerformance
  const headlineGold = ctx.createLinearGradient(0, 1200, 0, 1325)
  headlineGold.addColorStop(0, '#fff2d4')
  headlineGold.addColorStop(0.55, '#e9b778')
  headlineGold.addColorStop(1, '#fff1d2')
  ctx.fillStyle = headlineGold
  ctx.font = 'bold 106px sans-serif'
  ctx.fillText(performance + ' 元', 413, 1315, 700)
  ctx.fillStyle = '#f5d0a2'
  ctx.font = '30px sans-serif'
  ctx.fillText('团队效率成绩单', 413, 1415, 700)
  ctx.strokeStyle = '#9d764c'
  ctx.beginPath()
  ctx.moveTo(90, 1404); ctx.lineTo(260, 1404)
  ctx.moveTo(566, 1404); ctx.lineTo(736, 1404)
  ctx.stroke()
  ctx.font = 'bold 30px sans-serif'
  ctx.fillText(draft.team || '', 413, 1475, 740)
  const items = [['人均业绩', draft.perPerson], ['累计存量单量', draft.inventory], ['累计租赁单量', draft.rentals], ['累计新房单量', draft.newHomes]]
  items.forEach(([label, value], i) => {
    const x = 27 + i * 198
    ctx.strokeStyle = '#d6a76f'
    ctx.strokeRect(x, 1525, 180, 150)
    ctx.fillStyle = '#f5d0a2'
    ctx.font = '21px sans-serif'
    ctx.fillText(label, x + 90, 1570, 168)
    ctx.font = 'bold 31px sans-serif'
    ctx.fillText(value || '—', x + 90, 1644, 168)
  })
  update({report: canvas.toDataURL('image/png'), reportStatus:'done', reportTaskId:null, reportReview:''}, owner)
}
export default function PulinReport({ user, onLogin, taskId, onSave }) {
  const [view, setView] = useState(state)
  const [ready, setReady] = useState(false)
  const [picker, setPicker] = useState(false)
  const [activeTab, setActiveTab] = useState('report')
  const [sourcePicker, setSourcePicker] = useState(false)
  const reportFileRef = useRef(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('all')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [reportError, setReportError] = useState('')
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
    if (multiple && state.mode === 'multiple' && files.length > 8) { setError('一次最多上传 8 张人物照片'); return }
    if (files.some(file => !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024)) { setError('请选择 10MB 以内的图片'); return }
    try {
      const urls = await Promise.all(files.map(fileToDataUrl))
      update(current => multiple ? { ...current, people: urls, ...(current.mode === 'single' || urls.length + (current.selectedWardrobe || []).length > 8 ? { selectedWardrobe: [] } : {}) } : { ...current, portrait: urls[0], wardrobeHistory: wardrobePhotos(current), wardrobeBatchId: crypto.randomUUID(), cards: {}, selected: '' }, owner)
      setError('')
      onSave({ id: taskId, type: 'pulin-report', title: '朴邻战报制作', messages: [], activate: true })
    } catch { setError('图片读取失败，请重试') }
  }
  function registerDraft() { onSave({ id: taskId, type: 'pulin-report', title: '朴邻战报制作', messages: [], activate: true }) }
  if (!user) return <section className="pulin-report"><h1>朴邻战报制作</h1><p>登录后即可生成着装照和战报。</p><button onClick={onLogin}>登录</button></section>
  if (!ready) return <section className="pulin-report" role="status">正在读取战报草稿…</section>
  const anyGenerating = allSeasons.some(season => view.cards[season.id]?.status === 'running')
  const visibleSeasons = view.framing === 'half' ? halfSeasons : seasons
  const generating = visibleSeasons.some(season => view.cards[season.id]?.status === 'running')
  const pendingSeasons = visibleSeasons.filter(season => view.cards[season.id]?.uniformVersion !== 3 || (view.cards[season.id]?.gender && view.cards[season.id].gender !== view.gender))
  const canGenerate = Boolean(view.portrait && view.gender)
  const selectedPhotos = wardrobePhotos(view).filter(photo => photo.url && (view.selectedWardrobe || []).includes(photo.id))
  const history = wardrobePhotos(view).filter(photo => photo.url).filter(photo => historyFilter === 'all' || (photo.seasonId?.endsWith('-half') ? 'half' : 'full') === historyFilter)
  return <section className="pulin-report">
    <header className="pr-intro"><h1>朴邻战报制作</h1><p>生成标准着装照，或直接制作个人及团队战报。</p><div className="pr-tabs" role="tablist" aria-label="战报工具"><button type="button" role="tab" aria-selected={activeTab === "portrait"} onClick={() => setActiveTab("portrait")}>生成着装照</button><button type="button" role="tab" aria-selected={activeTab === "report"} onClick={() => setActiveTab("report")}>制作战报</button></div></header>
    {(error || view.storageError) && <p role="alert" className="pr-error">{error || view.storageError}</p>}
    <div className="pr-section" hidden={activeTab !== "portrait"}><button type="button" className="pr-history-trigger" onClick={() => setHistoryOpen(true)}>历史记录</button><span className="pr-step-number">着装照</span><h2>生成人物着装照</h2><p>上传清晰的正面形象照，生成三季真人着装。</p>
      <div className="pr-portrait-row">
        {view.portrait
          ? <button type="button" className="pr-upload pr-portrait-upload" aria-label="预览已上传的形象照" onClick={() => setPreview({ url: view.portrait, title: '人物形象照' })}><img src={view.portrait} alt="已上传的形象照"/></button>
          : <label {...imageDropProps} className="pr-upload pr-portrait-upload"><span aria-hidden="true">＋</span><input type="file" accept="image/*" aria-label="上传人物形象照" disabled={anyGenerating} onChange={e => upload(e, false)}/></label>}
        <div className="pr-portrait-info">
          <strong>{view.portrait ? '形象照已上传' : '上传人物形象照'}</strong>
          <small>建议使用正面、光线均匀的清晰照片，单张不超过 10MB</small>
          <label {...imageDropProps} className="pr-file-button">{view.portrait ? '更换形象照' : '选择形象照'}<input type="file" accept="image/*" disabled={anyGenerating} onChange={e => upload(e, false)}/></label>
        </div>
        <div className="pr-portrait-actions">
          {view.portrait && !view.gender && <span className="pr-gender-hint">请选择男款或女款着装</span>}
          <fieldset className="pr-segments" aria-label="性别" disabled={anyGenerating}>
            <label><input type="radio" name="pulin-uniform-gender" checked={view.gender === 'male'} onChange={() => { setError(''); update(current=>({...current,gender:'male'})) }}/>男</label>
            <label><input type="radio" name="pulin-uniform-gender" checked={view.gender === 'female'} onChange={() => { setError(''); update(current=>({...current,gender:'female'})) }}/>女</label>
          </fieldset>
          <fieldset className="pr-segments" aria-label="照片构图">
            <label><input type="radio" name="pulin-uniform-framing" checked={view.framing === 'full'} onChange={() => update({ framing: 'full' })}/>全身</label>
            <label><input type="radio" name="pulin-uniform-framing" checked={view.framing === 'half'} onChange={() => update({ framing: 'half' })}/>半身</label>
          </fieldset>
          {pendingSeasons.length > 0 && <button className="pr-generate-all" disabled={generating} onClick={() => { if (!view.portrait) { setError('请先上传人物形象照'); return } if (!view.gender) { setError('请选择男款或女款着装后生成'); return } setError(''); pendingSeasons.forEach(season => void generate(season)) }}>{generating ? '生成中…' : visibleSeasons.some(season => view.cards[season.id]?.url) ? '生成所选款式' : '生成'}</button>}
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
    <div className="pr-section pr-report-section" hidden={activeTab !== "report"}><div className="pr-report-layout"><div className="pr-report-form"><div className="pr-mode"><button aria-pressed={view.mode === 'single'} onClick={() => update({ ...state, mode: 'single', selectedWardrobe: (state.selectedWardrobe || []).slice(0,1), people: (state.selectedWardrobe || []).length ? [] : (state.people || []).slice(0,1) })}>单人战报</button><button aria-pressed={view.mode === 'multiple'} onClick={() => update({ ...state, mode: 'multiple' })}>多人战报</button></div>
      <button type="button" className="pr-upload pr-team-upload" onClick={() => setSourcePicker(true)}><span className="pr-team-upload-icon" aria-hidden="true">＋</span><span className="pr-team-upload-copy"><strong>上传人物形象照</strong><small>{view.mode === 'single' ? '选择 1 张照片' : '最多 8 人，支持多选'}</small></span></button><input ref={reportFileRef} type="file" accept="image/*" multiple={view.mode === 'multiple'} hidden onChange={e => upload(e, true)}/>
      <div className="pr-people">{selectedPhotos.map(photo => <div className="pr-selected-person" key={photo.id}><img src={photo.url} alt={wardrobeName(photo)}/><button type="button" aria-label={`移除${wardrobeName(photo)}`} onClick={() => update(current => ({...current, selectedWardrobe: (current.selectedWardrobe || []).filter(id => id !== photo.id)}))}>×</button></div>)}{view.people.map((src, i) => <div className="pr-selected-person" key={`${i}-${src.slice(-24)}`}><img src={src} alt={`本地照片${i + 1}`}/><button type="button" aria-label={`移除本地照片${i + 1}`} onClick={() => update(current => ({...current, people: current.people.filter((_, index) => index !== i)}))}>×</button></div>)}</div><small className="pr-photo-help">再次上传会替换已上传的本地照片；超过总数时，已选着装照会自动清空。</small>
      {view.mode === 'multiple' && <div className="pr-team-fields">
        <div className="pr-team-primary"><div className="pr-team-heading"><h3>片区与累计业绩</h3></div><div className="pr-team-primary-grid">{[['region','片区','如西安朴邻-XA18西安一片区'],['performance','累计业绩（元）','如10,054,060']].map(([key,label,placeholder]) => <label key={key}>{label}<input value={view[key] || ''} placeholder={placeholder} onChange={e => { update({[key]:e.target.value}); registerDraft() }}/></label>)}</div></div>
        <div className="pr-team-score"><div className="pr-team-heading"><h3>团队效率成绩单</h3></div><label className="pr-team-composition">团队构成<input value={view.team || ''} placeholder="如22名资产管家+5名社区经理+1名片区总监" onChange={e => { update({team:e.target.value}); registerDraft() }}/></label><div className="pr-team-metrics">{[['perPerson','人均业绩','如4.1万元/月'],['inventory','累计存量单量','如179单'],['rentals','累计租赁单量','如502单'],['newHomes','累计新房单量','如41单']].map(([key,label,placeholder]) => <label key={key}>{label}<input value={view[key] || ''} placeholder={placeholder} onChange={e => { update({[key]:e.target.value}); registerDraft() }}/></label>)}</div></div>
      </div>}
      {view.mode === 'single' && <><label>战报标题<input maxLength={12} value={view.title} onChange={e => { update({ ...state, title: e.target.value }); registerDraft() }}/></label>
      <label>副标题<input maxLength={24} value={view.subtitle} onChange={e => { update({ ...state, subtitle: e.target.value }); registerDraft() }}/></label>
      <label>战报数据<textarea maxLength={180} rows={5} value={view.data} placeholder={'每行填写一项，例如：\n本月成交 36 单\n目标完成率 120%'} onChange={e => { update({ ...state, data: e.target.value }); registerDraft() }}/></label>
      </>}<div className="pr-report-submit"><button disabled={view.reportStatus === 'running'} onClick={() => { setReportError(''); makeReport().catch(e => setReportError(e.message)) }}>{view.reportStatus === 'running' ? '正在生成团队战报…' : '生成战报'}</button>{reportError && <p role="alert" className="pr-error">{reportError}</p>}</div>
      {view.reportError && <p role="alert">{view.reportError}</p>}
      </div><aside className="pr-report-preview">{view.reportStatus === 'running' ? <div className="pr-result-pending" role="status">正在生成战报…</div> : view.report && <div className="pr-result"><button type="button" className="pr-report-image" aria-label="预览生成的战报" onClick={() => setPreview({url:view.report,title:'朴邻战报'})}><img src={view.report} alt="生成的朴邻战报"/></button><div className="pr-result-actions"><a href={view.report} download="朴邻战报.png">下载战报</a><button type="button" onClick={() => { setReportError(''); makeReport().catch(e => setReportError(e.message)) }}>重新生成</button></div>{reportError && <p role="alert" className="pr-error">{reportError}</p>}</div>}</aside></div>
    </div>
    {historyOpen && <div className="pr-overlay" onClick={() => setHistoryOpen(false)}><div className="pr-modal pr-history-modal" role="dialog" aria-modal="true" aria-label="着装照历史记录" onClick={e => e.stopPropagation()}><header><h2>着装照历史记录</h2><button type="button" onClick={() => setHistoryOpen(false)}>关闭</button></header><div className="pr-history-filters" aria-label="筛选构图">{[['all','全部'],['half','半身'],['full','全身']].map(([value,label]) => <button key={value} type="button" aria-pressed={historyFilter === value} onClick={() => setHistoryFilter(value)}>{label}</button>)}</div><div className="pr-history-grid">{history.map(photo => <button key={photo.id} type="button" onClick={() => setPreview({url:photo.url,title:wardrobeName(photo)})}><img src={photo.url} alt={wardrobeName(photo)}/><span>{wardrobeName(photo)}</span></button>)}</div>{!history.length && <p>{wardrobePhotos(view).length ? '当前筛选没有照片，请切换“全部”查看' : '当前对话尚无已保存的着装照，生成完成后会自动出现在这里'}</p>}</div></div>}
    {preview && createPortal(<ImagePreview url={preview.url} prompt={preview.title} onClose={() => setPreview(null)}/>, document.body)}
    {sourcePicker && <div className="pr-overlay" onClick={() => setSourcePicker(false)}><div className="pr-modal pr-source-modal" role="dialog" aria-modal="true" aria-label="选择照片来源" onClick={e => e.stopPropagation()}><header><h2>选择照片来源</h2><button type="button" onClick={() => setSourcePicker(false)}>关闭</button></header><div className="pr-source-options"><button type="button" onClick={() => { setSourcePicker(false); reportFileRef.current?.click() }}>上传本地照片</button><button type="button" onClick={() => { setSourcePicker(false); setPicker(true) }}>选择已生成照片</button></div></div></div>}
    {picker && <div className="pr-overlay" onClick={() => setPicker(false)}><div className="pr-modal" role="dialog" aria-modal="true" aria-label="选择着装照" onClick={e => e.stopPropagation()}><header><h2>选择着装照</h2><button onClick={() => setPicker(false)}>完成</button></header><p>{view.mode === 'single' ? '单人模式：选择一张' : '多人模式：最多选择八张（含上传形象照）'}</p><div className="pr-cards">{wardrobePhotos(view).map(photo => <button key={photo.id} aria-pressed={(view.selectedWardrobe || []).includes(photo.id)} onClick={() => { update(current => { const chosen=(current.selectedWardrobe || []).filter(id => wardrobePhotos(current).some(photo => photo.id === id && photo.url)); const next=current.mode==='single' ? [photo.id] : chosen.includes(photo.id) ? chosen.filter(id=>id!==photo.id) : chosen.length + current.people.length < 8 ? [...chosen,photo.id] : chosen; return {...current,selected:'',selectedWardrobe:next,...(current.mode==='single'?{people:[]}:{})}; }); if(view.mode==='single')setPicker(false); }}><img src={photo.url} alt={wardrobeName(photo)}/><b>{(view.selectedWardrobe || []).includes(photo.id) ? '✓ ' : ''}{wardrobeName(photo)}</b></button>)}</div>{!wardrobePhotos(view).length && <p>当前对话还没有生成的人物着装照。</p>}</div></div>}
  </section>
}
