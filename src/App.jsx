import { canonicalImageModel } from '../shared/vibbitImageModels.js'
import AccentTheme from './AccentTheme.jsx'
import { userError } from './userErrors.js'
import ToolPageHeader from './ToolPageHeader.jsx'
import dgenWordmark from './dgen-wordmark.svg?raw'
import FilmStudio, { filmRequest } from './FilmStudio.jsx'
import { formatComplianceReport } from './complianceReport.js'
import ComplianceReport from './ComplianceReport.jsx'
import { runComplianceConversation } from './complianceConversation.js'
import { generatePersistentText, textTaskRuntime, waitForTextTask } from './textTasks.js'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cancelWaterfallTask, clearAuthToken, createConversationImageTask, createWaterfallTask, downloadGeneratedImage, fileToDataUrl, getAuthToken, getCurrentAccount, listWaterfallTasks, loginAccount, logoutAccount, reconnectGoogleDrive, requestLoginCode, saveAuthToken, uploadComplianceImage, uploadGoogleDriveImage, waitForConversationImageTask, waterfallReferenceForRequest } from './api.js'
import { buildComplianceSystemPrompt, COMPLIANCE_BRANDS } from './complianceRules.js'
import { Icon } from './icons.jsx'
import PleaseDayAvatarStudio from './PleaseDayAvatarStudio.jsx'
import AdminStudio from './AdminStudio.jsx'
import VideoStudio from './VideoStudio.jsx'
import GenerationWelcome from './GenerationWelcome.jsx'
import ImagePreview from './ImagePreview.jsx'
import FestivalPosterStudio from './FestivalPosterStudio.jsx'
import MaterialLibrary from './MaterialLibrary.jsx'
import KnowledgeStudio from './KnowledgeStudio.jsx'
import SkillLibrary from './SkillLibrary.jsx'
import DiscoverSkills from './DiscoverSkills.jsx'
import { resumeLocalSkillTask } from './externalSkillClient.js'
import GenerationSkillPicker from './GenerationSkillPicker.jsx'
import { selectGenerationSkill, useGenerationSkill } from './generationSkills.js'
import KnowledgeContext from './KnowledgeContext.jsx'
import ComposerSelect from './ComposerSelect.jsx'
import './complianceBrand.css'
import { retryWaterfallLogo } from './logoRepair.js'
import ImageSettings from './ImageSettings.jsx'
import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_QUALITY, DEFAULT_IMAGE_RESOLUTION, IMAGE_MODEL_OPTIONS, availableImageModel, imageQualityForModel, supportsImageRatio, supportsImageResolution, imageCreditCost, imageResolutionForModel } from './imageModels.js'
import { compressImageForUpload, isSupportedImageFile } from './imageUpload.js'

const MODULES = [
  { id: 'strategy', label: '活动策略', caption: '洞察与方案生成', icon: 'spark' },
  { id: 'image', label: '图像创作', caption: '灵感变成画面', icon: 'image' },
  { id: 'video', label: '视频生成', caption: '从脚本到成片', icon: 'video' },
  { id: 'compliance', label: '合规审核', caption: '内容风险预检', icon: 'shield' },
  { id: 'skills', label: 'Skill 库', caption: '把经验变成可复用的方法', icon: 'blocks' },
  { id: 'knowledge', label: '知识库', caption: '素材、品牌与营销知识', icon: 'library' },
  { id: 'more', label: '更多工具', caption: '头像与批量套图', icon: 'blocks' },
]

const KNOWLEDGE_SECTIONS = [
  { id: 'brand-knowledge', label: '团队品牌知识库' },
  { id: 'assets', label: '素材库' },
  { id: 'marketing-activities', label: '营销活动' },
]

const WORKSPACE_TITLES = {
  film: ['AI FILM STUDIO', '一键成片'],
  content: ['CONTENT CREATION', '朴邻节日节气海报'],
  skills: ['SKILL LIBRARY', '团队 Skill'],
  'discover-skills': ['SKILL LIBRARY', '发现 Skill'],
  'brand-knowledge': ['KNOWLEDGE BASE', '团队品牌知识库'],
  'marketing-activities': ['KNOWLEDGE BASE', '营销活动'],
  assets: ['ASSET LIBRARY', '素材库'],
  'brand-manual': ['KNOWLEDGE BASE', '品牌手册'],
  'marketing-strategy': ['KNOWLEDGE BASE', '营销策略'],
  admin: ['ADMINISTRATION', '后台管理'],
  archive: ['ARCHIVE', '已归档对话'],
}
const MORE_WORKSPACE_TITLES = {
  'please-day': ['PLEASE DAY', '朴里节头像框'],
  qr: ['BATCH COMPOSER', '批处理二维码'],
}

const RATIO_OPTIONS = [
  { value: '1:3', label: '1:3' },
  { value: '9:16', label: '9:16' },
  { value: '9:21', label: '9:21' },
  { value: '2:3', label: '2:3' },
  { value: '3:4', label: '3:4' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' },
  { value: '21:9', label: '21:9' },
  { value: '3:1', label: '3:1' },
]
const DEFAULT_IMAGE_ASPECT_RATIO = '9:16'

const MODULE_COPY = {
  strategy: {
    eyebrow: 'NEW CHAT',
    title: '有什么可以帮你的吗？',
    subtitle: '告诉我你的想法、任务或问题，我会帮你梳理并完成它。',
    placeholder: '告诉我你想做什么…',
    systemPrompt: '用清晰的中文回答。先直接给出核心结论，用 **粗体** 标出最重要的事实或数字。内容较多时使用简短小标题和列表分组；简单问题保持简洁。不要为了格式补充未经证实的信息。',
  },
  compliance: {
    eyebrow: 'COMPLIANCE REVIEW',
    title: '让每一份内容，都更安心地发布。',
    subtitle: '粘贴营销文案、活动规则或对外材料，快速识别潜在风险并获得修改建议。',
    placeholder: '粘贴需要审核的内容，并说明行业与投放渠道…',
    systemPrompt: '你是一名严谨的中文内容合规审核助手。请识别潜在的广告法、知识产权、隐私、平台规则和误导性表达风险。按风险等级列出原文、原因和可直接替换的修改建议。你提供的是风险预检，不替代执业律师意见。',
  },
}

const STORAGE_KEY = 'diefa-conversations-v1'
const THEME_KEY = 'diefa-display-mode-v1'
const THEME_SELECTION_ENABLED = document.documentElement.dataset.themeSelection === 'enabled'
const IMAGE_MODE_KEY = 'diefa-image-mode-v1'
const LOCAL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const WATERFALL_CACHE_PREFIX = 'diefa-waterfall-cache-v1:'
const WATERFALL_HISTORY_PAGE_SIZE = 8
const GENERATED_IMAGE_DRAG_TYPE = 'application/x-diefa-generated-image'
const COMPLIANCE_FILE_EXTENSIONS = /\.(txt|md|csv|json|html|xml|pdf|doc|docx|xlsx|xls|ppt|pptx)$/i
const MAX_COMPLIANCE_TEXT_LENGTH = 60_000
const FAILURE_MESSAGE_TTL_MS = 5 * 60 * 1000
const FAILED_TASK_STATUSES = new Set(['failed', 'timeout'])


const QrBatchStudio = lazy(() => import('./QrBatchStudio.jsx'))
const MoreTools = lazy(() => import('./MoreTools.jsx'))

function hasSupportedDrag(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []).map((type) => type.toLowerCase())
  const hasFileItem = Array.from(dataTransfer?.items || []).some((item) => item.kind === 'file')
  return hasFileItem || types.some((type) => type === 'files' || type.includes('file')) || types.includes(GENERATED_IMAGE_DRAG_TYPE)
}

function droppedFiles(dataTransfer) {
  const files = Array.from(dataTransfer?.files || [])
  if (files.length) return files
  return Array.from(dataTransfer?.items || []).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean)
}

function imageRatioOptions(model, resolution) {
  return RATIO_OPTIONS.filter((option) => supportsImageRatio(model, resolution, option.value))
}

function normalizedImageRatio(model, resolution, ratio) {
  return supportsImageRatio(model, resolution, ratio) ? ratio : DEFAULT_IMAGE_ASPECT_RATIO
}

function createOptimisticWaterfallTask({ prompt, images = [], aspectRatio = DEFAULT_IMAGE_ASPECT_RATIO, count = 2, model = DEFAULT_IMAGE_MODEL, resolution = DEFAULT_IMAGE_RESOLUTION, quality = DEFAULT_IMAGE_QUALITY, resolvedAspectRatio, clientRequestId, skillId }) {
  const now = new Date().toISOString()
  return {
    id: clientRequestId || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    prompt: prompt.trim(),
    skillId: skillId || '',
    aspectRatio,
    resolvedAspectRatio: resolvedAspectRatio || aspectRatio,
    model,
    resolution: imageResolutionForModel(model, resolution),
    quality: imageQualityForModel(model, quality),
    count,
    referenceCount: images.length,
    referenceImages: images,
    // The API accepts waterfall jobs asynchronously, so the task is generating as
    // soon as it appears in the UI.  Keeping a separate "submitting" status here
    // made regenerated tasks visibly stall at "正在提交" and could leave that stale
    // state in localStorage after a refresh.
    status: 'running',
    optimistic: true,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    slots: Array.from({ length: count }, (_, index) => ({ index, status: 'running', url: null, error: null })),
  }
}

function failedWaterfallTask(task, error) {
  const now = new Date().toISOString()
  const message = String(error || '请求未完成，请稍后重试')
  return {
    ...task,
    status: 'failed',
    error: message,
    optimistic: false,
    updatedAt: now,
    completedAt: now,
    slots: (task.slots || []).map((slot) => ({ ...slot, status: 'failed', phase: 'failed', error: message })),
  }
}

function loadWaterfallCache(storageKey) {
  try {
    const entry = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (!entry) return []
    if (!Array.isArray(entry) && !(Date.now() - entry.savedAt < LOCAL_CACHE_TTL_MS)) {
      localStorage.removeItem(storageKey)
      return []
    }
    const saved = Array.isArray(entry) ? entry : entry.tasks
    // Optimistic tasks exist only while their POST request is in flight.  Never
    // restore them after a reload: the server response/history is the source of
    // truth, and restoring them can otherwise create an orphaned loading card.
    return Array.isArray(saved)
      ? saved.filter((task) => !task?.optimistic && task?.status !== 'submitting')
      : []
  } catch { return [] }
}

function compactWaterfallCache(tasks) {
  // Never synchronously write full data-URL reference files, hundreds of old
  // tasks, or any optimistic card into localStorage.  Those writes run on the
  // main thread and were a major source of stutter while tasks were polling.
  return tasks
    .filter((task) => !task?.optimistic)
    .slice(-48)
    .map((task) => ({
      ...task,
      referenceImages: (task.referenceImages || []).filter((source) => !String(source || '').startsWith('data:')),
    }))
}

function plainText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function validTextMessages(value) {
  return Array.isArray(value)
    ? value.filter((message) => ['user', 'assistant', 'error'].includes(message?.role) && typeof message.content === 'string')
    : []
}

function complianceFileKind(file) {
  if (file.type.startsWith('image/')) return 'image'
  return COMPLIANCE_FILE_EXTENSIONS.test(file.name) || file.type.startsWith('text/') ? 'text' : ''
}

async function extractComplianceText(file) {
  const name = file.name.toLowerCase()
  if (file.type.startsWith('text/') || /\.(txt|md|csv|json|html|xml)$/i.test(name)) return (await file.text()).slice(0, MAX_COMPLIANCE_TEXT_LENGTH)
  if (/\.doc$/i.test(name)) throw new Error('暂不支持旧版 .doc，请在 Word 中另存为 .docx 后上传')
  if (/\.ppt$/i.test(name)) throw new Error('暂不支持旧版 .ppt，请在 PowerPoint 中另存为 .pptx 后上传')
  if (/\.docx$/i.test(name)) {
    const { default: mammoth } = await import('mammoth')
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return result.value.slice(0, MAX_COMPLIANCE_TEXT_LENGTH)
  }
  if (/\.pdf$/i.test(name)) {
    const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorkerUrl }] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')])
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const pages = []
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 30); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => item.str || '').join(' '))
    }
    await pdf.destroy()
    return pages.join('\n\n').slice(0, MAX_COMPLIANCE_TEXT_LENGTH)
  }
  if (/\.(xlsx|xls)$/i.test(name)) {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    return workbook.SheetNames.slice(0, 12).map((sheetName) => `--- 工作表：${sheetName} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]).slice(0, 12_000)}`).join('\n\n').slice(0, MAX_COMPLIANCE_TEXT_LENGTH)
  }
  if (/\.pptx$/i.test(name)) {
    const { default: JSZip } = await import('jszip')
    const archive = await JSZip.loadAsync(await file.arrayBuffer())
    const slides = Object.keys(archive.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
    const text = await Promise.all(slides.slice(0, 30).map(async (path, index) => {
      const xml = await archive.file(path)?.async('text')
      const document = new DOMParser().parseFromString(xml || '', 'application/xml')
      return `--- 幻灯片 ${index + 1} ---\n${[...document.getElementsByTagName('a:t')].map((node) => node.textContent || '').join(' ')}`
    }))
    return text.join('\n\n').slice(0, MAX_COMPLIANCE_TEXT_LENGTH)
  }
  throw new Error('暂不支持此文件格式')
}

function loadConversations(storageKey = STORAGE_KEY) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch { return [] }
}

function isFailureMessage(message) {
  return message?.role === 'error'
}

function failureDeadline(message) {
  const failedAt = new Date(message?.failedAt || '').getTime()
  return Number.isFinite(failedAt) ? failedAt + FAILURE_MESSAGE_TTL_MS : 0
}

function withoutFailureMessages(messages) {
  return (messages || []).filter((message) => !isFailureMessage(message))
}

function isFailedWaterfallTask(task) {
  return FAILED_TASK_STATUSES.has(task?.status)
}

function waterfallPixelSize(task) {
  return task?.actualGenerationSize || task?.generationSize || '尺寸未记录'
}

function imageModelLabel(model) {
  return IMAGE_MODEL_OPTIONS.find((item) => item.value === model)?.label || model || IMAGE_MODEL_OPTIONS.find((item) => item.value === DEFAULT_IMAGE_MODEL)?.label || DEFAULT_IMAGE_MODEL
}

function waterfallThumbnailUrl(value) {
  const url = String(value || '')
  // Use one canonical URL wherever a saved server image is rendered. A prior
  // 404 must not leave thumbnails working while the preview still opens the
  // browser's stale, unversioned URL.
  return url.startsWith('/api/waterfall/assets/') ? `${url}${url.includes('?') ? '&' : '?'}v=3` : url
}

function waterfallDisplayUrl(slot) {
  if (slot?.thumbnailUrl) return waterfallThumbnailUrl(slot.thumbnailUrl)
  const originalUrl = String(slot?.url || '')
  // Older tasks predate generated thumbnails. Ask the server for a cached,
  // on-demand thumbnail instead of pulling their 2K/4K source into the list.
  if (originalUrl.startsWith('/api/waterfall/assets/')) return waterfallThumbnailUrl(originalUrl.replace('/api/waterfall/assets/', '/api/waterfall/thumbnails/'))
  return waterfallThumbnailUrl(originalUrl)
}

function QuietReferenceImage({ src }) {
  const [loadedSource, setLoadedSource] = useState(null)
  return <img className={`quiet-reference-image${loadedSource === src ? ' is-ready' : ''}`} src={src} alt="" loading="lazy" decoding="async" onLoad={() => setLoadedSource(src)} onError={() => setLoadedSource(null)}/>
}

function WaterfallResultImage({ slot, prompt, urls, onPreview, onRetryLogo }) {
  const [imageState, setImageState] = useState('loading')
  const previewUrl = waterfallThumbnailUrl(slot.url)
  const thumbnailUrl = waterfallDisplayUrl(slot)
  if (imageState === 'failed') return <div className="waterfall-asset-unavailable" role="status"><b>加载失败</b></div>
  return <>
    <button type="button" disabled={imageState !== 'ready'} onClick={() => onPreview({ url: previewUrl, urls, prompt })}>
      <img className={imageState === 'loading' ? 'is-loading' : ''} src={thumbnailUrl} alt="" loading="lazy" decoding="async" draggable={imageState === 'ready'} onLoad={() => setImageState('ready')} onError={() => setImageState('failed')} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(GENERATED_IMAGE_DRAG_TYPE, previewUrl); event.dataTransfer.setData('text/uri-list', previewUrl) }}/>
    </button>
    {imageState === 'loading' && <div className="waterfall-asset-loading" role="status" aria-label="图片加载中"><i/><i/><i/></div>}
    {(slot.brandWarning || ['queued', 'running'].includes(slot.logoRepairStatus)) && <div className="waterfall-brand-warning" role="status" title={slot.brandWarning}><span>{['queued', 'running'].includes(slot.logoRepairStatus) ? '正在重新合成Logo…' : 'Logo尚未合成'}</span><button type="button" disabled={['queued', 'running'].includes(slot.logoRepairStatus)} onClick={onRetryLogo}>重试Logo</button></div>}
    {slot.logoApplied && !slot.brandWarning && !['queued', 'running'].includes(slot.logoRepairStatus) && imageState === 'ready' && <button className="waterfall-logo-recompose" type="button" onClick={onRetryLogo} title="使用保留的底图重新排放Logo，不重新生图">重排Logo</button>}
    {imageState === 'ready' && <button className="waterfall-download" type="button" onClick={() => void downloadGeneratedImage(previewUrl, prompt)} title="下载图片" aria-label="下载图片"><Icon name="download" size={15}/></button>}
  </>
}

function mergeFilmHistory(conversations, projects) {
  const records = new Map(conversations.map((conversation) => [conversation.id, conversation]))
  let changed = false
  for (const project of projects) {
    const id = `film:${project.id}`
    const existing = records.get(id)
    if (existing?.deleted) continue
    const title = project.named ? project.title : '一键成片 · 导演命名中'
    const archived = Boolean(project.archived ?? existing?.archived)
    if (existing?.filmTitle === title && Boolean(existing.archived) === archived) continue
    const createdAt = new Date(project.createdAt).toISOString()
    records.set(id, {
      id, type: 'film', projectId: project.id, messages: [], createdAt, updatedAt: createdAt,
      ...existing,
      title: existing && existing.title !== existing.filmTitle ? existing.title : title,
      filmTitle: title,
      archived,
    })
    changed = true
  }
  return changed ? [...records.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) : conversations
}

function safeConversation(conversation) {
  return {
    ...conversation,
    messages: (conversation.messages || []).map((message) => ({
      ...message,
      references: message.references?.filter((item) => item.src && !item.src.startsWith('data:') && !item.src.startsWith('blob:')),
      attachments: message.attachments?.map((item) => item.kind === 'image' ? { ...item, src: item.src && !item.src.startsWith('data:') && !item.src.startsWith('blob:') ? item.src : '' } : item),
    })),
  }
}

function conversationTitle(conversation) {
  if (conversation.title?.trim()) return conversation.title.trim()
  const firstUserMessage = conversation.messages?.find((message) => message.role === 'user')
  return firstUserMessage?.content?.trim().slice(0, 22) || '未命名对话'
}

function useConversationFocus() {
  return useRef(null)
}

function useOpenConversationLatest(conversationId) {
  const scrollRef = useRef(null)
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (conversationId && node) node.scrollTop = node.scrollHeight
  }, [conversationId])
  return scrollRef
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return minutes > 0 ? `${minutes} 分 ${String(remaining).padStart(2, '0')} 秒` : `${seconds} 秒`
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function MessageCopyButton({ content, label = false }) {
  const [copied, setCopied] = useState(false)

  async function copyMessage() {
    try {
      await copyToClipboard(content || '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch { /* Clipboard permission can be unavailable in embedded browsers. */ }
  }

  return <button className={`message-copy-button ${label ? 'with-label' : ''} ${copied ? 'is-copied' : ''}`} type="button" onClick={copyMessage} aria-label={copied ? '已复制全文' : '复制全文'} title={copied ? '已复制' : '复制全文'}>
    <Icon name={copied ? 'check' : 'copy'} size={14}/>{label && <span>{copied ? '已复制' : '复制全文'}</span>}
  </button>
}

function LiveElapsed({ startedAt }) {
  const [elapsed, setElapsed] = useState(() => startedAt ? Date.now() - new Date(startedAt).getTime() : 0)
  useEffect(() => {
    const update = () => setElapsed(startedAt ? Date.now() - new Date(startedAt).getTime() : 0)
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  return <span>已用时 {formatElapsed(elapsed)}</span>
}

function LiveTaskStatus({ startedAt, label = '思考中' }) {
  return <div className="task-elapsed live" role="status"><span className="task-thinking"><i/>{label}</span><LiveElapsed startedAt={startedAt}/></div>
}

function AnswerText({ content }) {
  const lines = String(content || '').replace(/\r/g, '').split('\n')

  function inline(value) {
    const clean = String(value).replace(/\s*\[\d+\]/g, '').trim()
    return clean.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.replace(/`([^`]+)`/g, '$1'))
  }

  return <div className="answer-plain">{lines.map((raw, index) => {
    const line = raw.trim()
    if (!line) return <div className="answer-gap" key={`gap-${index}`}/>
    const heading = line.match(/^#{1,4}\s+(.+)$/)
    if (heading) return <h3 key={index}>{inline(heading[1])}</h3>
    const bullet = line.match(/^(?:[-*•]|\d+[.、])\s+(.+)$/)
    if (bullet) return <p className="answer-bullet" key={index}><i>•</i><span>{inline(bullet[1])}</span></p>
    return <p key={index}>{inline(line)}</p>
  })}</div>
}

function TextSources({ sources }) {
  const [expanded, setExpanded] = useState(false)
  const items = (sources || []).filter((source) => source?.url)
  if (!items.length) return null
  const visibleItems = expanded ? items : items.slice(0, 2)
  return <div className="text-sources" aria-label="联网搜索来源">
    <span>搜索来源</span>
    {visibleItems.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>)}
    {items.length > 2 && <button type="button" className="text-sources-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : `展开其余 ${items.length - 2} 条`}</button>}
  </div>
}

function ConversationRow({ conversation, activeConversationId, onSelect, onPin, onArchive, onRename }) {
  const module = MODULES.find((item) => item.id === (conversation.type === 'film' ? 'video' : conversation.type))
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const title = conversationTitle(conversation)

  function startRename(event) {
    event.preventDefault()
    event.stopPropagation()
    setDraftTitle(conversation.title?.trim() || title)
    setEditing(true)
  }

  function finishRename() {
    const nextTitle = draftTitle.trim()
    if (nextTitle && nextTitle !== conversation.title?.trim()) onRename(conversation.id, nextTitle)
    setEditing(false)
  }

  return <div className={`history-row ${activeConversationId === conversation.id ? 'active' : ''}`}>
    <button className="history-open" onClick={(event) => { if (!editing && !event.target.closest('.history-title-editor')) onSelect(conversation) }}>
      <span className={`history-icon ${conversation.status === 'running' ? 'is-running' : ''} ${conversation.unreadComplete ? 'is-complete' : ''}`}>
        {conversation.status === 'running' ? <i className="history-spinner"/> : conversation.unreadComplete ? <span className="completion-lights"><i/></span> : <Icon name={module?.icon || 'spark'} size={15}/>} 
      </span>
      <span className="history-title">{editing
        ? <input className="history-title-editor" aria-label="对话标题" autoFocus value={draftTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setDraftTitle(event.target.value)} onBlur={finishRename} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } if (event.key === 'Escape') { event.preventDefault(); setEditing(false) } }}/>
        : <b title="双击改名" onDoubleClick={startRename}>{title}</b>
      }</span>
    </button>
    <div className="history-actions">
      <button title={conversation.pinned ? '取消置顶' : '置顶'} aria-label={conversation.pinned ? '取消置顶' : '置顶'} onClick={() => onPin(conversation.id)}><Icon name="pin" size={13}/></button>
      <button title="归档" aria-label="归档" onClick={() => onArchive(conversation.id)}><Icon name="database" size={13}/></button>
    </div>
  </div>
}

function BrandIcon({ alt = '' }) {
  return <span className="brand-icon-static" role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}/>
}

function Sidebar({ active, onChange, imageMode, onSelectImageMode, moreTool, onSelectMoreTool, conversations, activeConversationId, onSelectConversation, onPinConversation, onArchiveConversation, onRenameConversation, onOpenArchive, onOpenAdmin, theme, onThemeChange, open, onClose, user, onLogout, onLogin }) {
  const pinned = conversations.filter((conversation) => conversation.pinned)
  const regular = conversations.filter((conversation) => !conversation.pinned)
  const [accountExpanded, setAccountExpanded] = useState(false)
  const knowledgeActive = KNOWLEDGE_SECTIONS.some((item) => item.id === active)
  const [expandedMenu, setExpandedMenu] = useState(() => ['video', 'film'].includes(active) ? 'video' : knowledgeActive ? 'knowledge' : ['skills', 'discover-skills'].includes(active) ? 'skills' : active === 'content' ? 'content' : null)
  const toggleMenu = (menu) => setExpandedMenu((current) => current === menu ? null : menu)
  const accountCloseTimer = useRef(null)

  function keepAccountMenuOpen() {
    window.clearTimeout(accountCloseTimer.current)
  }

  function scheduleAccountMenuClose() {
    window.clearTimeout(accountCloseTimer.current)
    accountCloseTimer.current = window.setTimeout(() => setAccountExpanded(false), 520)
  }

  useEffect(() => () => window.clearTimeout(accountCloseTimer.current), [])

  return <>
    {open && <button className="sidebar-scrim" aria-label="关闭菜单" onClick={onClose} />}
    <aside className={`sidebar glass-strong ${open ? 'is-open' : ''}`}>
      <div className="brand">
        <span className="sidebar-wordmark" role="img" aria-label="D-Gen" dangerouslySetInnerHTML={{ __html: dgenWordmark.replace('<defs><style>.cls-1{fill:#05ffe7;}.cls-2{fill:#fff;}</style></defs>', '').replaceAll('class="cls-1"', 'fill="var(--dp-highlight)"').replaceAll('class="cls-2"', 'fill="var(--dp-ink)"') }}/>
        <span className="sidebar-brand-caption" aria-label="蝶发AI工作台">{[...'蝶发AI工作台'].map((character, index) => <span key={index} aria-hidden="true">{character}</span>)}</span>
      </div>
      <nav className="module-nav primary-tools">
        {MODULES.map((item) => item.id === 'image' ? <div className="more-tool-nav" key={item.id}>
          <button disabled={item.disabled} className={active === item.id ? 'active' : ''} aria-expanded={expandedMenu === 'image'} onClick={() => { if (item.disabled) return; toggleMenu('image'); onChange(item.id) }}><Icon name={item.icon} size={17}/><b>{item.label}</b><Icon name="chevron" size={14}/></button>
          {expandedMenu === 'image' && <div className="module-submenu" role="menu" aria-label="图像创作模式">
            <button type="button" role="menuitem" aria-current={active === 'image' && imageMode === 'dialogue' ? 'true' : undefined} className={active === 'image' && imageMode === 'dialogue' ? 'active' : ''} onClick={() => { onSelectImageMode('dialogue'); onClose() }}>对话模式</button>
            <button type="button" role="menuitem" aria-current={active === 'image' && imageMode === 'waterfall' ? 'true' : undefined} className={active === 'image' && imageMode === 'waterfall' ? 'active' : ''} onClick={() => { onSelectImageMode('waterfall'); onClose() }}>瀑布流模式</button>
          </div>}
        </div> : item.id === 'video' ? <div className="more-tool-nav" key={item.id}>
          <button disabled={item.disabled} className={['video', 'film'].includes(active) ? 'active' : ''} aria-expanded={expandedMenu === 'video'} onClick={() => { if (item.disabled) return; toggleMenu('video'); onChange(item.id) }}><Icon name={item.icon} size={17}/><b>{item.label}</b><Icon name="chevron" size={14}/></button>
          {expandedMenu === 'video' && <div className="module-submenu" role="menu" aria-label="视频生成模式">
            <button type="button" role="menuitem" aria-current={active === 'video' ? 'true' : undefined} className={active === 'video' ? 'active' : ''} onClick={() => { onChange('video'); onClose() }}>视频生成</button>
            <button type="button" role="menuitem" aria-current={active === 'film' ? 'true' : undefined} className={active === 'film' ? 'active' : ''} onClick={() => { onChange('film'); onClose() }}>一键成片</button>
          </div>}
        </div> : item.id === 'content' ? <div className="more-tool-nav" key={item.id}>
          <button disabled={item.disabled} className={active === item.id ? 'active' : ''} aria-expanded={expandedMenu === 'content'} onClick={() => { if (item.disabled) return; toggleMenu('content'); onChange(item.id) }}><Icon name={item.icon} size={17}/><b>{item.label}</b><Icon name="chevron" size={14}/></button>
          {expandedMenu === 'content' && <div className="module-submenu" role="menu" aria-label="内容创作工具列表">
            <button type="button" role="menuitem" aria-current="true" className="active" onClick={() => onClose()}>朴邻节日节气海报</button>
          </div>}
        </div> : item.id === 'skills' ? <div className="more-tool-nav" key={item.id}>
          <button className={['skills', 'discover-skills'].includes(active) ? 'active' : ''} aria-expanded={expandedMenu === 'skills'} aria-controls="skills-submenu" onClick={() => toggleMenu('skills')}><Icon name={item.icon} size={17}/><b>{item.label}</b><Icon name="chevron" size={14}/></button>
          {expandedMenu === 'skills' && <div id="skills-submenu" className="module-submenu" role="menu" aria-label="Skill 库目录">
            {[['skills', '团队 Skill'], ['discover-skills', '发现 Skill']].map(([id, label]) => <button key={id} type="button" role="menuitem" aria-current={active === id ? 'page' : undefined} className={active === id ? 'active' : ''} onClick={() => { onChange(id); onClose() }}>{label}</button>)}
          </div>}
        </div> : item.id === 'knowledge' ? <div className="more-tool-nav" key={item.id}>
          <button className={knowledgeActive ? 'active' : ''} aria-expanded={expandedMenu === 'knowledge'} aria-controls="knowledge-submenu" onClick={() => toggleMenu('knowledge')}><Icon name={item.icon} size={17}/><b>{item.label}</b><Icon name="chevron" size={14}/></button>
          {expandedMenu === 'knowledge' && <div id="knowledge-submenu" className="module-submenu" role="menu" aria-label="知识库目录">
            {KNOWLEDGE_SECTIONS.map((section) => <button key={section.id} type="button" role="menuitem" aria-current={active === section.id ? 'page' : undefined} className={active === section.id ? 'active' : ''} onClick={() => { onChange(section.id); onClose() }}>{section.label}</button>)}
          </div>}
        </div> : item.id === 'more' ? <div className="more-tool-nav" key={item.id}>
          <button disabled={item.disabled} className={active === item.id ? 'active' : ''} aria-expanded={expandedMenu === 'more'} onClick={() => { if (item.disabled) return; toggleMenu('more'); onChange(item.id) }}><Icon name={item.icon} size={17}/><b>{item.label}</b><Icon name="chevron" size={14}/></button>
          {expandedMenu === 'more' && <div className="module-submenu" role="menu" aria-label="更多工具列表">
            <button type="button" role="menuitem" aria-current={active === 'more' && moreTool === 'please-day' ? 'true' : undefined} className={active === 'more' && moreTool === 'please-day' ? 'active' : ''} onClick={() => { onSelectMoreTool('please-day'); onClose() }}>朴里节头像框</button>
            <button type="button" role="menuitem" aria-current={active === 'more' && moreTool === 'qr' ? 'true' : undefined} className={active === 'more' && moreTool === 'qr' ? 'active' : ''} onClick={() => { onSelectMoreTool('qr'); onClose() }}>批处理二维码</button>
          </div>}
        </div> : <button key={item.id} disabled={item.disabled} className={active === item.id ? 'active' : ''} onClick={() => { if (item.disabled) return; onChange(item.id); onClose() }}><Icon name={item.icon} size={17}/><b>{item.label}</b></button>)}
      </nav>
      <div className="nav-label nav-label-secondary history-heading"><span>置顶</span></div>
      <div className="conversation-history pinned-history">
        {pinned.length === 0 ? <div className="history-empty compact"><Icon name="pin" size={15}/><span>暂无置顶对话</span></div> : pinned.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} activeConversationId={activeConversationId} onSelect={(item) => { onSelectConversation(item); onClose() }} onPin={onPinConversation} onArchive={onArchiveConversation} onRename={onRenameConversation}/>)}
      </div>
      <div className="nav-label history-heading conversation-heading"><span>对话记录</span></div>
      <div className="conversation-history">
        {regular.length === 0 ? <div className="history-empty"><Icon name="history" size={18}/><span>还没有历史对话</span></div> : regular.slice(0, 20).map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} activeConversationId={activeConversationId} onSelect={(item) => { onSelectConversation(item); onClose() }} onPin={onPinConversation} onArchive={onArchiveConversation} onRename={onRenameConversation}/>)}
      </div>
      <div className="sidebar-bottom" onMouseEnter={keepAccountMenuOpen} onMouseLeave={scheduleAccountMenuClose}>
        {user && accountExpanded && <div className="account-dropdown" onMouseEnter={keepAccountMenuOpen}>
          <div className="account-menu-email"><Icon name="mail" size={15}/><span>{user.email}</span></div>
          <div className="account-credit-summary"><Icon name="spark" size={16}/><span>当前积分</span><b>{user.credits ?? 50}</b></div>
          <button onClick={() => { onOpenArchive(); setAccountExpanded(false); onClose() }}><Icon name="database" size={16}/><span>已归档对话</span><Icon name="chevron" size={14}/></button>
          {user.email.toLowerCase() === 'zhangwj159@onewo.com' && <button onClick={() => { onOpenAdmin(); setAccountExpanded(false); onClose() }}><Icon name="gear" size={16}/><span>后台管理</span><Icon name="chevron" size={14}/></button>}
          <AccentTheme/>
          {THEME_SELECTION_ENABLED && <div className="theme-menu-row">
            <span className="theme-menu-label"><Icon name="sun" size={16}/><span>显示模式</span></span>
            <div className="theme-mode-options" role="group" aria-label="显示模式">
              <button type="button" aria-pressed={theme === 'light'} className={theme === 'light' ? 'active' : ''} onClick={() => onThemeChange('light')}>LIGHT</button>
              <button type="button" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'active' : ''} onClick={() => onThemeChange('dark')}>DARK</button>
            </div>
          </div>}
          <button className="account-logout" onClick={onLogout}><Icon name="logout" size={16}/><span>退出登录</span><Icon name="chevron" size={14}/></button>
        </div>}
        {user ? <button className="account" onMouseEnter={keepAccountMenuOpen} onClick={() => { keepAccountMenuOpen(); setAccountExpanded((value) => !value) }}><span>{user.email.slice(0, 2).toUpperCase()}</span><b>{user.email.split('@')[0]}<small>积分 {user.credits ?? 50}</small></b></button> : <button className="guest-account" onClick={onLogin}><Icon name="lock" size={16}/><span>登录以使用 AI 功能</span></button>}
      </div>
    </aside>
  </>
}

const EMAIL_LOCAL_PATTERN = /^[^\s@]+$/
function AuthScreen({ onAuthenticated, onClose }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function updateEmailLocal(value) {
    setEmail(value.trim().toLowerCase().replace(/@onewo\.com$/i, ''))
    setCode('')
    setError('')
    setNotice('')
  }

  async function run(action) {
    if (loading) return
    setError('')
    setNotice('')
    if (!EMAIL_LOCAL_PATTERN.test(email)) { setError('请输入企业邮箱账号'); return }
    setLoading(true)
    try { await action(email + '@onewo.com') }
    catch (requestError) { setError(userError(requestError.message)) }
    finally { setLoading(false) }
  }

  async function submit(event) {
    event.preventDefault()
    await run(async normalizedEmail => {
      if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位验证码')
      const result = await loginAccount({ email: normalizedEmail, code, remember })
      saveAuthToken(result.token, remember)
      onAuthenticated(result.user)
    })
  }

  return <div className="modal-scrim auth-modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="auth-card auth-modal-card glass-strong" role="dialog" aria-modal="true" aria-label="邮箱验证码登录">
    <button className="modal-close" onClick={onClose} aria-label="关闭"><Icon name="x"/></button>
  <div className="auth-brand"><span className="brand-avatar"><BrandIcon alt="D-Gen"/></span><div><b>D-Gen</b><small>蝶发 AI 创作工作台</small></div></div>
    <form className="auth-form" onSubmit={submit}>
      <label><span>企业邮箱</span><div className="email-local-field"><Icon name="mail" size={17}/><input type="text" inputMode="email" autoComplete="username" value={email} onChange={(e) => updateEmailLocal(e.target.value)} placeholder="邮箱账号" disabled={loading}/><b>@onewo.com</b></div></label>
      <div className="auth-code-field"><label htmlFor="auth-login-code">邮箱验证码</label><div><Icon name="shield" size={17}/><input id="auth-login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="6 位验证码" disabled={loading}/>
      <button type="button" className="auth-send-code" disabled={loading} onClick={() => run(async normalizedEmail => {
        await requestLoginCode(normalizedEmail)
        setNotice('验证码已发送，请查收邮件')
      })}>发送验证码</button></div></div>
      <label className="remember-check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}/><span>记住登录状态，30 天内免登录</span></label>
      {notice && <div className="auth-notice" role="status">{notice}</div>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="auth-submit" disabled={loading}>{loading ? '请稍候…' : '登录'}</button>
    </form>
  </section></div>
}

function ArchiveWorkspace({ archived, onRestore, onDelete, onDeleteAll }) {
  function deleteOne(id) {
    if (window.confirm('确定永久删除这条已归档对话吗？此操作无法撤销。')) onDelete(id)
  }

  function deleteAll() {
    if (archived.length > 0 && window.confirm(`确定永久删除全部 ${archived.length} 条已归档对话吗？此操作无法撤销。`)) onDeleteAll()
  }

  return <section className="workspace archive-workspace">
    <div className="archive-panel glass-strong">
      <div className="archive-panel-header"><div><span>ARCHIVE</span><h1>已归档对话</h1></div>{archived.length > 0 && <button className="delete-all" onClick={deleteAll}><Icon name="trash" size={16}/>全部删除</button>}</div>
      <div className="archive-view">
        <div className="archive-list">
          {archived.length === 0 ? <div className="archive-empty"><Icon name="database" size={25}/><b>暂无已归档对话</b><small>归档后的对话会显示在这里</small></div> : archived.map((conversation) => {
            const module = MODULES.find((item) => item.id === (conversation.type === 'film' ? 'video' : conversation.type))
            return <div className="archive-row" key={conversation.id}>
              <span className="archive-row-icon"><Icon name={module?.icon || 'spark'} size={16}/></span>
              <span><b>{conversationTitle(conversation)}</b></span>
              <div>
                <button title="恢复" aria-label="恢复" onClick={() => onRestore(conversation.id)}><Icon name="restore" size={15}/>恢复</button>
                <button className="delete" title="删除" aria-label="删除" onClick={() => deleteOne(conversation.id)}><Icon name="trash" size={15}/>删除</button>
              </div>
            </div>
          })}
        </div>
      </div>
    </div>
  </section>
}

function Topbar({ onMenu }) {
  return <header className="topbar">
    <button className="mobile-menu" onClick={onMenu}><Icon name="menu"/></button>
  </header>
}

function ImageStudio({ conversation, onSave, imageMode, waterfallStorageKey, onUserUpdate, onRequireLogin }) {
  const skillState = useGenerationSkill('image')
  const conversationId = useRef(conversation?.id || crypto.randomUUID())
  const lastGeneratedImage = [...(conversation?.messages || [])].reverse().find((message) => message.role === 'assistant' && message.urls?.length)?.urls?.[0] || null
  const restoredEditImage = conversation && Object.hasOwn(conversation, 'editImage') ? conversation.editImage : lastGeneratedImage
  const [messages, setMessages] = useState(conversation?.messages || [])
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState(conversation?.ratio || DEFAULT_IMAGE_ASPECT_RATIO)
  const [model, setModel] = useState(() => availableImageModel(conversation?.imageModel))
  const [resolution, setResolution] = useState(() => imageResolutionForModel(conversation?.imageModel || DEFAULT_IMAGE_MODEL, conversation?.imageResolution || DEFAULT_IMAGE_RESOLUTION))
  const [quality, setQuality] = useState(() => imageQualityForModel(conversation?.imageModel || DEFAULT_IMAGE_MODEL, conversation?.imageQuality || DEFAULT_IMAGE_QUALITY))
  const [references, setReferences] = useState([])
  const [editImage, setEditImage] = useState(restoredEditImage)
  const [previewImage, setPreviewImage] = useState(null)
  const [loading, setLoading] = useState(conversation?.status === 'running')
  const [runningStartedAt, setRunningStartedAt] = useState(conversation?.runningStartedAt || null)
  const activeRequestRef = useRef(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const focusRef = useConversationFocus()
  const conversationScrollRef = useOpenConversationLatest(conversation?.id)
  const followLatestResult = useRef(false)

  function scrollToLatestResult() {
    followLatestResult.current = true
  }

  useLayoutEffect(() => {
    if (!followLatestResult.current || !conversationScrollRef.current) return
    conversationScrollRef.current.scrollTop = conversationScrollRef.current.scrollHeight
    followLatestResult.current = false
  }, [messages])

  useEffect(() => {
    if (!conversation || conversation.id !== conversationId.current) return
    if (conversation.status === 'running' && !activeRequestRef.current) {
      if (conversation.imageTaskId) {
        activeRequestRef.current = true
        setMessages(conversation.messages || [])
        setLoading(true)
        setRunningStartedAt(conversation.runningStartedAt || null)
        void waitForConversationImageTask(conversation.imageTaskId).then((result) => {
          if (result.user) onUserUpdate(result.user)
          const urls = result.urls || []
          const nextEditImage = urls[0] || conversation.editImage || null
          const completedMessages = [...(conversation.messages || []), { role: 'assistant', urls, brandWarning: result.task?.slots?.find((s) => s.brandWarning)?.brandWarning, elapsedMs: Date.now() - new Date(conversation.runningStartedAt || Date.now()).getTime(), prompt: conversation.messages?.at(-1)?.content || '' }]
          setMessages(completedMessages)
          setEditImage(nextEditImage)
          onSave({ id: conversationId.current, type: 'image', messages: completedMessages, ratio: conversation.ratio || DEFAULT_IMAGE_ASPECT_RATIO, imageModel: conversation.imageModel || DEFAULT_IMAGE_MODEL, imageResolution: conversation.imageResolution || DEFAULT_IMAGE_RESOLUTION, imageQuality: imageQualityForModel(conversation.imageModel || DEFAULT_IMAGE_MODEL, conversation.imageQuality || DEFAULT_IMAGE_QUALITY), editImage: nextEditImage, status: 'idle', imageTaskId: null, runningStartedAt: null, unreadComplete: true })
        }).catch((err) => {
          const failedMessages = [...(conversation.messages || []), { role: 'error', content: userError(err.message), elapsedMs: Date.now() - new Date(conversation.runningStartedAt || Date.now()).getTime(), failedAt: new Date().toISOString() }]
          setMessages(failedMessages)
          setError(userError(err.message))
          onSave({ id: conversationId.current, type: 'image', messages: failedMessages, ratio: conversation.ratio || DEFAULT_IMAGE_ASPECT_RATIO, imageModel: conversation.imageModel || DEFAULT_IMAGE_MODEL, imageResolution: conversation.imageResolution || DEFAULT_IMAGE_RESOLUTION, imageQuality: imageQualityForModel(conversation.imageModel || DEFAULT_IMAGE_MODEL, conversation.imageQuality || DEFAULT_IMAGE_QUALITY), editImage: conversation.editImage || null, status: 'idle', imageTaskId: null, runningStartedAt: null, unreadComplete: false })
        }).finally(() => { activeRequestRef.current = false; setLoading(false); setRunningStartedAt(null) })
        return
      }
      const failedAt = new Date().toISOString()
      const interruptedMessages = [...(conversation.messages || []), { role: 'error', content: '上次生成请求已中断，请重新发起。', failedAt }]
      setMessages(interruptedMessages)
      setLoading(false)
      setRunningStartedAt(null)
      setError('上次生成请求已中断，请重新发起。')
      onSave({ id: conversationId.current, type: 'image', messages: interruptedMessages, ratio: conversation.ratio || DEFAULT_IMAGE_ASPECT_RATIO, imageModel: conversation.imageModel || DEFAULT_IMAGE_MODEL, imageResolution: conversation.imageResolution || DEFAULT_IMAGE_RESOLUTION, imageQuality: imageQualityForModel(conversation.imageModel || DEFAULT_IMAGE_MODEL, conversation.imageQuality || DEFAULT_IMAGE_QUALITY), editImage: conversation.editImage || null, status: 'idle', runningStartedAt: null, unreadComplete: false })
      return
    }
    setMessages(conversation.messages || [])
    setLoading(conversation.status === 'running')
    setRunningStartedAt(conversation.runningStartedAt || null)
    const nextModel = availableImageModel(conversation.imageModel)
    setModel(nextModel)
    setResolution(imageResolutionForModel(nextModel, conversation.imageResolution))
    setQuality(imageQualityForModel(nextModel, conversation.imageQuality || DEFAULT_IMAGE_QUALITY))
    if (Object.hasOwn(conversation, 'editImage')) setEditImage(conversation.editImage)
  }, [conversation])

  useEffect(() => {
    const failedMessages = messages.filter(isFailureMessage)
    if (!failedMessages.length) return undefined
    const cleanUp = () => {
      const nextMessages = withoutFailureMessages(messages)
      if (nextMessages.length === messages.length) return
      setMessages(nextMessages)
      onSave({ id: conversationId.current, type: 'image', messages: nextMessages, ratio, imageModel: model, imageResolution: resolution, imageQuality: quality, editImage, status: 'idle', runningStartedAt: null, unreadComplete: false })
    }
    const nextDeadline = Math.min(...failedMessages.map(failureDeadline))
    if (!nextDeadline || nextDeadline <= Date.now()) { cleanUp(); return undefined }
    const timer = window.setTimeout(cleanUp, nextDeadline - Date.now())
    return () => window.clearTimeout(timer)
  }, [editImage, messages, model, onSave, quality, ratio, resolution])

  async function appendFiles(fileList) {
    const referenceLimit = (editImage ? 3 : 4) - (skillState.selected?.referenceCount || 0)
    const files = Array.from(fileList || []).slice(0, referenceLimit - references.length)
    const valid = files.filter(isSupportedImageFile)
    if (files.length && !valid.length) {
      setError('没有识别到可上传的图片，请使用 PNG、JPG、WebP 等格式')
      return
    }
    try {
      const encoded = await Promise.all(valid.map(async (file) => {
        const prepared = await compressImageForUpload(file)
        const source = await fileToDataUrl(prepared)
        return { name: prepared.name, src: source, backupSrc: source }
      }))
      setReferences((current) => [...current, ...encoded].slice(0, referenceLimit))
      if (encoded.length) setError('')
      void Promise.allSettled(encoded.map(async (reference) => ({ source: reference.src, url: (await uploadGoogleDriveImage({ source: reference.src, name: reference.name })).url }))).then((results) => {
        const replacements = new Map(results.filter((result) => result.status === 'fulfilled').map((result) => [result.value.source, result.value.url]))
        if (replacements.size) setReferences((current) => current.map((reference) => replacements.has(reference.src) ? { ...reference, src: replacements.get(reference.src) } : reference))
      })
    } catch (error) { setError(userError(error.message) || '图片读取失败') }
  }

  async function addFiles(event) {
    await appendFiles(event.target.files)
    event.target.value = ''
  }

  async function submit(customPrompt) {
    const text = (customPrompt || prompt).trim()
    if (!text || loading) return
    if (references.length + (editImage ? 1 : 0) + (skillState.selected?.referenceCount || 0) > 4) { setError('所选 Skill 需要一张参考图位置，请先减少上传参考图'); return }
    const selectedRatio = normalizedImageRatio(model, resolution, ratio)
    const selectedQuality = imageQualityForModel(model, quality)
    if (selectedRatio !== ratio) setRatio(selectedRatio)
    if (selectedQuality !== quality) setQuality(selectedQuality)
    const referenceSnapshot = references
    const editSnapshot = editImage
    const startedAt = new Date().toISOString()
    const userMessages = [...messages, { role: 'user', content: text, references: referenceSnapshot, editImage: editSnapshot }]
    activeRequestRef.current = true
    setMessages(userMessages)
    scrollToLatestResult()
    onSave({ id: conversationId.current, type: 'image', messages: userMessages, ratio: selectedRatio, imageModel: model, imageResolution: resolution, imageQuality: selectedQuality, editImage: editSnapshot, status: 'running', runningStartedAt: startedAt, unreadComplete: false, activate: true })
    setPrompt(''); setReferences([]); setLoading(true); setRunningStartedAt(startedAt); setError('')
    const creditCost = imageCreditCost(model)
    onUserUpdate((current) => current ? { ...current, credits: Math.max(0, (current.credits ?? 50) - creditCost) } : current)
    try {
      const requestPrompt = editSnapshot
        ? `请基于提供的第一张图片继续编辑。保持用户没有要求改变的主体、构图、风格、光影与细节，只执行这项修改：${text}`
        : text
      const created = await createConversationImageTask({
        prompt: requestPrompt, skillId: skillState.id,
        images: [...new Set([editSnapshot, ...referenceSnapshot.map((item) => item.src)].filter(Boolean))],
        aspectRatio: selectedRatio,
        model,
        resolution,
        quality: selectedQuality,
      })
      if (created.user) onUserUpdate(created.user)
      onSave({ id: conversationId.current, type: 'image', messages: userMessages, ratio: selectedRatio, imageModel: model, imageResolution: resolution, imageQuality: selectedQuality, editImage: editSnapshot, status: 'running', imageTaskId: created.task.id, runningStartedAt: startedAt, unreadComplete: false })
      const result = await waitForConversationImageTask(created.task.id)
      if (result.user) onUserUpdate(result.user)
      const nextEditImage = result.urls[0] || null
      const elapsedMs = Date.now() - new Date(startedAt).getTime()
      const completedMessages = [...userMessages, { role: 'assistant', urls: result.urls, brandWarning: result.task?.slots?.find((s) => s.brandWarning)?.brandWarning, elapsedMs, prompt: text }]
      setMessages(completedMessages)
      scrollToLatestResult()
      setEditImage(nextEditImage)
      onSave({ id: conversationId.current, type: 'image', messages: completedMessages, ratio: selectedRatio, imageModel: model, imageResolution: resolution, imageQuality: selectedQuality, editImage: nextEditImage, status: 'idle', imageTaskId: null, runningStartedAt: null, unreadComplete: true })
    } catch (err) {
      try {
        const { user: refreshedUser } = await getCurrentAccount()
        onUserUpdate(refreshedUser)
      } catch {
        onUserUpdate((current) => current ? { ...current, credits: (current.credits ?? 50) + creditCost } : current)
      }
      setError(userError(err.message))
      const failedMessages = [...userMessages, { role: 'error', content: userError(err.message), elapsedMs: Date.now() - new Date(startedAt).getTime(), failedAt: new Date().toISOString() }]
      setMessages(failedMessages)
      scrollToLatestResult()
      onSave({ id: conversationId.current, type: 'image', messages: failedMessages, ratio: selectedRatio, imageModel: model, imageResolution: resolution, imageQuality: selectedQuality, editImage: editSnapshot, status: 'idle', imageTaskId: null, runningStartedAt: null, unreadComplete: false })
    } finally { activeRequestRef.current = false; setLoading(false); setRunningStartedAt(null) }
  }

  const empty = messages.length === 0
  return <>
    {imageMode === 'waterfall' ? <WaterfallStudio skillState={skillState} storageKey={waterfallStorageKey} onUserUpdate={onUserUpdate} onRequireLogin={onRequireLogin}/> : <section className={`workspace with-image-mode ${empty ? 'empty' : ''}`}>
    <div className="conversation" ref={conversationScrollRef}>
      {empty ? <GenerationWelcome/> : <div className="message-list">
        {messages.map((message, index) => <ImageMessage key={index} message={message} focusRef={!loading && index === messages.length - 1 ? focusRef : null} onPreview={setPreviewImage}/>) }
        {loading && <div ref={focusRef}><LiveTaskStatus startedAt={runningStartedAt}/></div>}
        <div className="conversation-tail-space" aria-hidden="true"/>
      </div>}
    </div>
    <ImageComposer skillState={skillState} prompt={prompt} setPrompt={setPrompt} ratio={ratio} setRatio={setRatio} model={model} setModel={setModel} resolution={resolution} setResolution={setResolution} quality={quality} setQuality={setQuality} references={references} setReferences={setReferences} editImage={editImage} fileRef={fileRef} addFiles={addFiles} appendFiles={appendFiles} submit={submit} loading={loading} error={error} onPreview={setPreviewImage}/>
    {previewImage && <ImagePreview url={previewImage.url || previewImage} urls={previewImage.urls} prompt={previewImage.prompt} onClose={() => setPreviewImage(null)}/>} 
    </section>}
  </>
}

function WaterfallStudio({ skillState, storageKey, onUserUpdate, onRequireLogin }) {
  const localSkillResumeAttempts = useRef(new Set())
  const dismissedFailureTaskIds = useRef(new Set())
  const sessionTaskIds = useRef(new Set())
  const isInitialTaskLoad = useRef(true)
  const [tasks, setTasks] = useState(() => loadWaterfallCache(storageKey).filter((task) => {
    if (!isFailedWaterfallTask(task)) return true
    dismissedFailureTaskIds.current.add(task.id)
    return false
  }))
  const [initialLoading, setInitialLoading] = useState(true)
  const [serverLoaded, setServerLoaded] = useState(false)
  const [total, setTotal] = useState(0)
  // Start with the latest history, then fetch earlier records in predictable
  // batches as the user scrolls upward.
  const [visibleLimit, setVisibleLimit] = useState(WATERFALL_HISTORY_PAGE_SIZE)
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState(DEFAULT_IMAGE_ASPECT_RATIO)
  const [model, setModel] = useState(DEFAULT_IMAGE_MODEL)
  const [resolution, setResolution] = useState(DEFAULT_IMAGE_RESOLUTION)
  const [quality, setQuality] = useState(DEFAULT_IMAGE_QUALITY)
  const [count, setCount] = useState(2)
  const [references, setReferences] = useState([])
  const selectedSkill = skillState.id
  const setSelectedSkill = skillState.select
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [previewImage, setPreviewImage] = useState(null)
  const [expandedReferenceTaskIds, setExpandedReferenceTaskIds] = useState(() => new Set())
  const [refreshToken, setRefreshToken] = useState(0)
  const fileRef = useRef(null)
  const promptRef = useRef(null)
  const dragDepth = useRef(0)
  const historyLoadingMore = useRef(false)
  const resultsRef = useRef(null)
  const historyHeight = useRef(0)
  const sessionReferenceImages = useRef(new Map())
  const tasksRef = useRef(tasks)
  const openAtLatest = useRef(true)
  const followLatestTask = useRef(false)
  const selectedSkillDefinition = skillState.selected
  const referenceLimit = 9 - (selectedSkillDefinition?.referenceCount || 0)

  useEffect(() => {
    tasksRef.current = tasks
    try {
      const next = compactWaterfallCache(tasks)
      const previous = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (JSON.stringify(previous?.tasks) !== JSON.stringify(next)) {
        localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), tasks: next }))
      }
    } catch { /* Keep in-memory history if local storage is unavailable. */ }
  }, [storageKey, tasks])

  useEffect(() => {
    if (!getAuthToken()) { setInitialLoading(false); return undefined }
    let active = true
    let timer
    const refresh = async () => {
      try {
        const result = await listWaterfallTasks(0, visibleLimit)
        if (!active) return
        if (result.user) onUserUpdate(result.user)
        const fetchedTasks = [...(result.tasks || [])].reverse().filter((task) => {
          const belongsToCurrentSession = sessionTaskIds.current.has(task.id) || sessionTaskIds.current.has(task.clientRequestId)
          if (belongsToCurrentSession) {
            sessionTaskIds.current.add(task.id)
            const retrySources = sessionReferenceImages.current.get(task.id) || sessionReferenceImages.current.get(task.clientRequestId)
            if (retrySources?.length) sessionReferenceImages.current.set(task.id, retrySources)
          }
          if (dismissedFailureTaskIds.current.has(task.id)) return false
          if (!isInitialTaskLoad.current || belongsToCurrentSession || !isFailedWaterfallTask(task)) return true
          dismissedFailureTaskIds.current.add(task.id)
          return false
        })
        for (const task of fetchedTasks) {
          if (task.slots?.some((slot) => slot.phase === 'needs-local-skill') && !localSkillResumeAttempts.current.has(task.id)) {
            localSkillResumeAttempts.current.add(task.id)
            void resumeLocalSkillTask(task).catch((error) => { if (active) setError(userError(error.message)) })
          }
        }
        setTasks((current) => {
          const currentById = new Map(current.map((task) => [task.id, task]))
          const freshestFetched = fetchedTasks.map((task) => {
            const local = currentById.get(task.id)
            if (local && (local.optimistic || local.status === 'running') && new Date(local.updatedAt || local.createdAt) > new Date(task.updatedAt || task.createdAt)) return local
            const fallbackReferences = task.referenceImages?.length ? task.referenceImages : local?.referenceImages?.length ? local.referenceImages : sessionReferenceImages.current.get(task.id)
            return fallbackReferences?.length ? { ...task, referenceImages: fallbackReferences } : task
          })
          const fetchedIds = new Set(freshestFetched.map((task) => task.id))
          const fetchedClientRequestIds = new Set(freshestFetched.map((task) => task.clientRequestId).filter(Boolean))
          // A task absent from the server is no longer running. Keeping it here
          // made expired records loop forever and made the Stop action return 404.
          const locallyActive = current.filter((task) => task.optimistic && !fetchedIds.has(task.id) && !fetchedClientRequestIds.has(task.id))
          const merged = [...freshestFetched, ...locallyActive].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          const unchanged = merged.length === current.length && merged.every((task, index) => {
            const previous = current[index]
            if (!previous || task.id !== previous.id || task.updatedAt !== previous.updatedAt || task.status !== previous.status) return false
            return task.slots?.length === previous.slots?.length && task.slots.every((slot, slotIndex) => {
              const oldSlot = previous.slots[slotIndex]
              return oldSlot && slot.status === oldSlot.status && slot.url === oldSlot.url && slot.error === oldSlot.error && slot.logoRepairStatus === oldSlot.logoRepairStatus && slot.logoApplied === oldSlot.logoApplied && slot.brandWarning === oldSlot.brandWarning && slot.thumbnailUrl === oldSlot.thumbnailUrl
            })
          })
          return unchanged ? current : merged
        })
        isInitialTaskLoad.current = false
        setTotal(result.total || 0)
        // A waterfall task is asynchronous, so the result endpoint is the
        // source of truth.  Check active work frequently so a completed
        // upstream image replaces its loading card without a noticeable wait.
        if (active && (result.tasks || []).some((task) => task.status === 'running' || task.slots?.some((s) => ['queued', 'running'].includes(s.logoRepairStatus)))) timer = window.setTimeout(refresh, 1_000)
      } catch (err) {
        if (!active) return
        // A transient network failure must not stop polling an in-flight Logo
        // repair and leave its button disabled until the module is reopened.
        console.warn('瀑布流历史刷新失败', err)
        timer = window.setTimeout(refresh, 3_000)
    } finally {
      historyLoadingMore.current = false
      if (active) {
        setInitialLoading(false)
        setServerLoaded(true)
      }
    }
    }
    refresh()
    return () => { active = false; window.clearTimeout(timer) }
  }, [onUserUpdate, refreshToken, storageKey, visibleLimit])

  useEffect(() => {
    const node = resultsRef.current
    if (!node) return
    if (!historyHeight.current) return
    node.scrollTop = node.scrollHeight - historyHeight.current
    historyHeight.current = 0
  }, [tasks.length])

  useLayoutEffect(() => {
    const shouldOpenAtLatest = openAtLatest.current && serverLoaded && tasks.length
    if ((!shouldOpenAtLatest && !followLatestTask.current) || !resultsRef.current) return
    resultsRef.current.scrollTop = resultsRef.current.scrollHeight
    if (shouldOpenAtLatest) openAtLatest.current = false
    followLatestTask.current = false
  }, [serverLoaded, tasks])


  useEffect(() => {
    const closeReferences = (event) => {
      if (event.target instanceof Element && !event.target.closest('.waterfall-reference-summary')) setExpandedReferenceTaskIds(new Set())
    }
    document.addEventListener('pointerdown', closeReferences)
    return () => document.removeEventListener('pointerdown', closeReferences)
  }, [])

  function scrollToLatestTask() {
    followLatestTask.current = true
  }

  function toggleTaskReferences(taskId) {
    setExpandedReferenceTaskIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  async function appendReferences(fileList) {
    const files = Array.from(fileList || []).slice(0, referenceLimit - references.length)
    const valid = files.filter(isSupportedImageFile)
    if (files.length && !valid.length) return setError('请选择 PNG、JPG、WebP 等图片文件')
    try {
      const encoded = await Promise.all(valid.map(async (file) => {
        const prepared = await compressImageForUpload(file)
        const source = await fileToDataUrl(prepared)
        return { name: prepared.name, src: source, backupSrc: source }
      }))
      setReferences((current) => [...current, ...encoded].slice(0, referenceLimit))
      if (encoded.length) setError('')
      void Promise.allSettled(encoded.map(async (reference) => ({ source: reference.src, url: (await uploadGoogleDriveImage({ source: reference.src, name: reference.name })).url }))).then((results) => {
        const replacements = new Map(results.filter((result) => result.status === 'fulfilled').map((result) => [result.value.source, result.value.url]))
        if (replacements.size) setReferences((current) => current.map((reference) => replacements.has(reference.src) ? { ...reference, src: replacements.get(reference.src) } : reference))
      })
    } catch (error) { setError(userError(error.message) || '图片读取失败') }
  }

  function appendGeneratedReference(source) {
    if (!source) return
    setReferences((current) => current.some((item) => item.src === source) ? current : [...current, { name: '已生成图片', src: source }].slice(0, referenceLimit))
    setError('')
  }

  async function submitTask() {
    if (!prompt.trim() || submitting) return
    if (!getAuthToken()) { onRequireLogin(); return }
    if (references.length > referenceLimit) { setError('已选 Skill 会占用 1 张参考图位置，请先移除一张参考图'); return }
    setSubmitting(true); setError(''); setInitialLoading(false)
    const referenceSnapshot = references.map((item) => item.src)
    const retryReferenceSnapshot = references.map((item) => item.backupSrc || item.src)
    const clientRequestId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const selectedRatio = normalizedImageRatio(model, resolution, ratio)
    if (selectedRatio !== ratio) setRatio(selectedRatio)
    const selectedQuality = imageQualityForModel(model, quality)
    if (selectedQuality !== quality) setQuality(selectedQuality)
    const request = { prompt: prompt.trim(), skillId: selectedSkill, images: referenceSnapshot, aspectRatio: selectedRatio, count, model, resolution, quality: selectedQuality, clientRequestId }
    const optimisticTask = createOptimisticWaterfallTask(request)
    sessionTaskIds.current.add(optimisticTask.id)
    if (retryReferenceSnapshot.length) sessionReferenceImages.current.set(optimisticTask.id, retryReferenceSnapshot)
    setTasks((current) => [...current, optimisticTask])
    scrollToLatestTask()
    setPrompt(''); setReferences([])
    try {
      const result = await createWaterfallTask(request)
      if (result.user) onUserUpdate(result.user)
      sessionTaskIds.current.add(result.task.id)
      if (retryReferenceSnapshot.length) sessionReferenceImages.current.set(result.task.id, retryReferenceSnapshot)
      const task = result.task.referenceImages?.length || !referenceSnapshot.length ? result.task : { ...result.task, referenceImages: referenceSnapshot }
      setTasks((current) => current.map((item) => item.id === optimisticTask.id ? task : item).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index))
      setTotal((current) => current + 1)
      setRefreshToken((current) => current + 1)
    } catch (err) {
      // The Worker may have durably created the task before a gateway closes
      // the response. Keep its local card and reconcile it by client ID on
      // the next history refresh instead of reporting a false request error.
      if ([502, 503, 504].includes(err.status)) {
        setRefreshToken((current) => current + 1)
        return
      }
      setTasks((current) => current.map((item) => item.id === optimisticTask.id ? failedWaterfallTask(item, userError(err.message)) : item))
    }
    finally { setSubmitting(false) }
  }

  async function stopTask(id) {
    try {
      const result = await cancelWaterfallTask(id)
      if (result.user) onUserUpdate(result.user)
      setTasks((current) => current.map((task) => task.id === id ? result.task : task))
    } catch (err) {
      if (err.status === 404) {
        dismissedFailureTaskIds.current.add(id)
        setTasks((current) => current.filter((task) => task.id !== id))
        setError('该任务已失效，已从列表移除。')
        return
      }
      setError(userError(err.message))
    }
  }

  function editTask(task) {
    setPrompt(task.prompt || '')
    setRatio(normalizedImageRatio(task.model || DEFAULT_IMAGE_MODEL, task.resolution || DEFAULT_IMAGE_RESOLUTION, task.resolvedAspectRatio || task.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO))
    const nextModel = availableImageModel(task.model)
    setModel(nextModel)
    setResolution(imageResolutionForModel(nextModel, task.resolution))
    setQuality(imageQualityForModel(nextModel, task.quality || DEFAULT_IMAGE_QUALITY))
    setCount(task.count || 2)
    setSelectedSkill(task.skillSnapshot?.id || task.skillId || '')
    const editableReferences = task.skillSnapshot?.referenceCount ? (task.referenceImages || []).slice(0, -task.skillSnapshot.referenceCount) : task.referenceImages || []
    setReferences(editableReferences.map((src, index) => ({ name: `参考图 ${index + 1}`, src })))
    setError('')
    window.requestAnimationFrame(() => promptRef.current?.focus())
  }

  function generateAgain(task) {
    if (task.model && !IMAGE_MODEL_OPTIONS.some((item) => item.value === canonicalImageModel(task.model))) { editTask(task); setError('原模型已移除，请选择可用模型后重新生成'); return }
    if (!getAuthToken()) { onRequireLogin(); return }
    const retrySources = sessionReferenceImages.current.get(task.id) || task.referenceImages || []
    const request = {
      prompt: task.prompt,
      skillId: task.skillSnapshot?.id || task.skillId || '', retryOf: /^[a-f0-9-]{36}$/i.test(task.id) ? task.id : undefined,
      knowledge: task.knowledgeSelection || null,
      images: retrySources.map(waterfallReferenceForRequest),
      aspectRatio: task.resolvedAspectRatio || task.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO,
      count: task.count || 2,
      model: availableImageModel(task.model),
      resolution: imageResolutionForModel(task.model || DEFAULT_IMAGE_MODEL, task.resolution || DEFAULT_IMAGE_RESOLUTION),
      quality: imageQualityForModel(task.model || DEFAULT_IMAGE_MODEL, task.quality || DEFAULT_IMAGE_QUALITY),
    }
    const optimisticTask = createOptimisticWaterfallTask({ ...request, resolvedAspectRatio: task.resolvedAspectRatio })
    sessionTaskIds.current.add(optimisticTask.id)
    if (retrySources.length) sessionReferenceImages.current.set(optimisticTask.id, retrySources)
    setError(''); setInitialLoading(false)
    setTasks((current) => [...current, optimisticTask])
    scrollToLatestTask()
    // Submitting is deliberately detached from this button.  The new task is
    // already visible and the user may immediately submit another one.
    void createWaterfallTask({ ...request, clientRequestId: optimisticTask.id }).then((result) => {
      if (result.user) onUserUpdate(result.user)
      sessionTaskIds.current.add(result.task.id)
      if (retrySources.length) sessionReferenceImages.current.set(result.task.id, retrySources)
      setTasks((current) => current.map((item) => item.id === optimisticTask.id ? result.task : item).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index))
      setTotal((current) => current + 1)
      setRefreshToken((current) => current + 1)
    }).catch((err) => {
      // A gateway timeout can occur after the Worker has already accepted the
      // task and started its upstream jobs.  Do not turn that into a false
      // red failure or remove the new card; the next task refresh resolves it
      // from the server's source of truth.
      if ([502, 503, 504].includes(err.status)) {
        setRefreshToken((current) => current + 1)
        return
      }
      setTasks((current) => current.map((item) => item.id === optimisticTask.id ? failedWaterfallTask(item, `再次生成失败：${userError(err.message) || '请求未完成，请稍后重试'}`) : item))
    })
  }

  function handleScroll(event) {
    const top = event.currentTarget.scrollTop
    if (top > 240 || visibleLimit >= total || historyLoadingMore.current) return
    historyLoadingMore.current = true
    historyHeight.current = event.currentTarget.scrollHeight
    setVisibleLimit((current) => Math.min(current + WATERFALL_HISTORY_PAGE_SIZE, total))
  }

  async function handleDrop(event) {
    event.preventDefault(); dragDepth.current = 0; setDraggingFiles(false)
    const generatedImage = event.dataTransfer?.getData(GENERATED_IMAGE_DRAG_TYPE)
    if (generatedImage) {
      appendGeneratedReference(generatedImage)
      return
    }
    await appendReferences(droppedFiles(event.dataTransfer))
  }

  return <section className="workspace waterfall-workspace">
    <div className="waterfall-results" ref={resultsRef} onScroll={handleScroll}>
      {initialLoading ? <div className="waterfall-initial-loading" aria-label="加载任务"><i/><i/><i/></div> : tasks.filter((task) => task.status === 'running' || task.status === 'cancelled' || isFailedWaterfallTask(task) || (task.slots || []).some((slot) => slot.status === 'succeeded')).length === 0 ? <div className="waterfall-empty"><b>开始你的第一组创作</b><span>一次生成多张图片，也可以连续提交多个任务。</span></div> : <div className="waterfall-task-list">
        {tasks.filter((task) => task.status === 'running' || task.status === 'cancelled' || isFailedWaterfallTask(task) || (task.slots || []).some((slot) => slot.status === 'succeeded')).map((task) => {
          const referenceImages = task.referenceImages || []
          const referencesExpanded = expandedReferenceTaskIds.has(task.id)
          const visibleSlots = (task.slots || []).filter((slot) => slot.status === 'running' || slot.status === 'succeeded')
          const referenceThumbnails = referenceImages.map(waterfallThumbnailUrl)
          return <article className="waterfall-task" key={task.id}>
          <header><div className="waterfall-task-leading">{referenceImages.length > 0 && <div className="waterfall-reference-summary"><button type="button" onClick={() => toggleTaskReferences(task.id)} aria-expanded={referencesExpanded} aria-label={`${referencesExpanded ? '收起' : '展开'}参考图`} title={`${referencesExpanded ? '收起' : '展开'}参考图`}><span className="waterfall-reference-stack" aria-hidden="true">{referenceThumbnails.slice(0, 3).map((url, index) => <QuietReferenceImage src={url} key={`${url}-${index}`}/>)}</span></button>{referencesExpanded && <div className="waterfall-reference-list">{referenceImages.map((url, index) => <button type="button" key={`${url}-${index}`} onClick={() => setPreviewImage({ url: referenceThumbnails[index], prompt: task.prompt })} aria-label={`预览参考图 ${index + 1}`}><QuietReferenceImage src={referenceThumbnails[index]}/></button>)}</div>}</div>}<div className="waterfall-task-info"><div className="waterfall-prompt-line"><b>{task.prompt}</b><button type="button" aria-label="复制提示词" title="复制提示词" onClick={() => navigator.clipboard.writeText(task.prompt)}><Icon name="copy" size={14}/></button></div><small>{task.skillSnapshot?.title && `${task.skillSnapshot.title} · `}{new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {imageModelLabel(task.model)} · {task.resolvedAspectRatio || task.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO} · {waterfallPixelSize(task)}</small></div></div>{task.status === 'running' ? !task.optimistic && <div className="waterfall-task-actions"><button type="button" onClick={() => editTask(task)}>编辑</button><button className="stop" type="button" onClick={() => stopTask(task.id)}>停止</button></div> : <div className="waterfall-task-actions">{isFailedWaterfallTask(task) && <span className="waterfall-task-status failed" title={task.error || task.slots?.find((slot) => slot.error)?.error || '生成失败'}>生图失败</span>}{task.status === 'cancelled' && <span className="waterfall-task-status cancelled">已取消任务</span>}<button type="button" onClick={() => editTask(task)}>重新编辑</button><button type="button" onClick={() => generateAgain(task)}>再次生成</button></div>}</header>
          {visibleSlots.length > 0 && <div className={`waterfall-grid count-${visibleSlots.length}`}>{visibleSlots.map((slot) => <div className={`waterfall-slot ${slot.status}`} style={{ aspectRatio: (task.resolvedAspectRatio || task.aspectRatio || DEFAULT_IMAGE_ASPECT_RATIO).replace(/[:x]/, ' / ') }} key={slot.index}>
            {slot.status === 'running' && slot.phase === 'needs-local-skill' && <div className="waterfall-brand-progress" role="status">等待本机 Skill 文件，请在发现 Skill → 已安装中重新下载</div>}{slot.status === 'running' && slot.phase === 'brand-logo' && <div className="waterfall-brand-progress" role="status">检查Logo并合成原图…</div>}{slot.status === 'succeeded' && slot.url ? <WaterfallResultImage slot={slot} prompt={task.prompt} urls={visibleSlots.filter((item) => item.status === 'succeeded' && item.url).map((item) => waterfallThumbnailUrl(item.url))} onPreview={setPreviewImage} onRetryLogo={async () => { try { await retryWaterfallLogo(task.id, slot.index); setRefreshToken((v) => v + 1) } catch (err) { setError(userError(err.message)) } }}/> : <div className="bubble-loader" aria-label="生成中"><i/><i/><i/></div>}
          </div>)}</div>}
        </article>})}
      </div>}
    </div>
    <div className="waterfall-composer-wrap">
      <div className={`composer waterfall-composer glass-strong ${draggingFiles ? 'is-dragging-files' : ''}`} onDragEnter={(event) => { if (hasSupportedDrag(event.dataTransfer)) { event.preventDefault(); dragDepth.current += 1; setDraggingFiles(true) } }} onDragOver={(event) => { if (hasSupportedDrag(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDraggingFiles(false) }} onDrop={handleDrop}>
        {draggingFiles && <div className="image-drop-zone" aria-hidden="true"><b>松开以上传参考图</b><small>最多 {referenceLimit} 张</small></div>}
        {references.length > 0 && <ReferenceStrip references={references} setReferences={setReferences} onPreview={setPreviewImage} thumbnail={waterfallThumbnailUrl}/>}
        {selectedSkillDefinition && <div className="waterfall-selected-skill"><Icon name="spark" size={14}/><b>{selectedSkillDefinition.title}</b><span>{selectedSkillDefinition.summary}</span><button type="button" onClick={() => setSelectedSkill('')} aria-label="移除已选 Skill"><Icon name="x" size={13}/></button></div>}
        <textarea ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitTask() } }} placeholder="描述这一组图片…" rows="2"/>
        <div className="composer-tools"><div className="tool-group">
          <button className="tool-button reference-add" type="button" onClick={() => fileRef.current?.click()} disabled={references.length >= referenceLimit}><Icon name="plus" size={18}/></button><input ref={fileRef} type="file" hidden multiple accept="image/*" onChange={async (event) => { await appendReferences(event.target.files); event.target.value = '' }}/>
          <ComposerSelect label="生图模型" value={model} options={IMAGE_MODEL_OPTIONS} onChange={(nextModel) => { const nextResolution = supportsImageResolution(nextModel) ? '2k' : '1k'; setModel(nextModel); setResolution(nextResolution); setQuality((current) => imageQualityForModel(nextModel, current)); setRatio((current) => normalizedImageRatio(nextModel, nextResolution, current)) }}/>
          <ImageSettings model={model} ratio={ratio} ratios={imageRatioOptions(model, resolution)} onRatio={setRatio} resolution={resolution} onResolution={(nextResolution) => { setResolution(nextResolution); setRatio((current) => normalizedImageRatio(model, nextResolution, current)) }} quality={quality} onQuality={setQuality} count={count} onCount={setCount}/>
          <GenerationSkillPicker target="image" state={skillState}/>
          <KnowledgeContext tool="image"/>
        </div><div className="generation-submit"><span className="generation-credit-cost">消耗 <b>{imageCreditCost(model, count)}</b> 分</span><button className="send-button" type="button" aria-label={submitting ? '提交中' : `生成，消耗 ${imageCreditCost(model, count)} 积分`} onClick={submitTask} disabled={!prompt.trim() || submitting}><Icon name="arrowUp" size={18}/></button></div></div>
      </div>
      {error && <small className="composer-note error">{error}{error.includes('Google Drive 授权已失效') && <button className="drive-reconnect" type="button" onClick={() => { void reconnectGoogleDrive().catch((err) => setError(userError(err.message) || '无法打开 Google Drive 授权页面')) }}>重新连接 Google Drive</button>}</small>}
    </div>
    {previewImage && <ImagePreview url={previewImage.url || previewImage} urls={previewImage.urls} prompt={previewImage.prompt} onClose={() => setPreviewImage(null)}/>} 
  </section>
}

function ImageMessage({ message, focusRef, onPreview }) {
  if (message.role === 'user') return <div ref={focusRef} className="user-message">
    {message.references?.length > 0 && <div className="message-refs">{message.references.map((item, index) => <button type="button" onClick={() => onPreview(item.src)} aria-label={`预览参考图 ${index + 1}`} key={index}><img src={item.src} alt="参考图"/></button>)}</div>}
    <div className="user-message-content">{message.content}</div>
    <MessageCopyButton content={message.content}/>
  </div>
  if (message.role === 'error') return <div ref={focusRef} className="error-message"><span><b>生成失败{message.elapsedMs != null ? ` · 耗时 ${formatElapsed(message.elapsedMs)}` : ''}</b>{message.content}</span></div>
  return <div ref={focusRef} className="assistant-turn has-copy-control">{message.elapsedMs != null && <div className="task-elapsed">耗时 {formatElapsed(message.elapsedMs)}</div>}
    <div className={`generated-grid ${message.urls.length === 1 ? 'single' : ''}`}>{message.urls.map((url, index) => <figure key={url}><button className="image-preview-trigger" onClick={() => onPreview({ url, urls: message.urls, prompt: message.prompt })} aria-label={`预览生成图片 ${index + 1}`}><img src={url} alt={`AI 生成结果 ${index + 1}`} loading="lazy" decoding="async" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(GENERATED_IMAGE_DRAG_TYPE, url); event.dataTransfer.setData('text/uri-list', url) }}/></button></figure>)}</div>
    {message.brandWarning && <div className="image-brand-warning" role="status">{message.brandWarning}</div>}
    <MessageCopyButton content={message.urls.join('\n')}/>
  </div>
}

function TextUserMessage({ message, messageRef, onPreview }) {
  const imageAttachments = (message.attachments || []).filter((file) => file.kind === 'image' && file.src)
  const textAttachments = (message.attachments || []).filter((file) => file.kind !== 'image')
  return <div ref={messageRef} className={['user-message', imageAttachments.length ? 'has-image-attachments' : ''].filter(Boolean).join(' ')}>
    {imageAttachments.length > 0 && <div className="message-refs">{imageAttachments.map((file, index) => <button type="button" onClick={() => onPreview(file.src)} aria-label={`预览上传图片 ${index + 1}`} key={file.name + index}><img src={file.src} alt={file.name}/></button>)}</div>}
    {textAttachments.length > 0 && <div className="text-attachment-list">{textAttachments.map((file, index) => <span key={file.name + index}><Icon name="book" size={14}/>{file.name}</span>)}</div>}
    <div className="user-message-content">{message.content}</div>
    <MessageCopyButton content={message.content}/>
  </div>
}

function ReferenceStrip({ references, setReferences, onPreview, thumbnail = (src) => src }) {
  const draggedIndex = useRef(null)
  const [draggingIndex, setDraggingIndex] = useState(null)
  const [targetIndex, setTargetIndex] = useState(null)

  function resetDrag() {
    draggedIndex.current = null
    setDraggingIndex(null)
    setTargetIndex(null)
  }

  function moveReference(from, to) {
    setReferences((current) => {
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  return <div className="reference-strip sortable-reference-strip" aria-label="参考图，拖动可调整顺序">
    {references.map((item, index) => <div key={item.name + index} className={`${draggingIndex === index ? 'is-sorting' : ''} ${targetIndex === index && draggingIndex !== index ? 'is-sort-target' : ''}`}
      draggable
      onDragStart={(event) => {
        event.stopPropagation()
        draggedIndex.current = index
        setDraggingIndex(index)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-dgen-reference-order', String(index))
      }}
      onDragEnter={(event) => {
        if (draggedIndex.current === null) return
        event.preventDefault()
        event.stopPropagation()
        setTargetIndex(index)
      }}
      onDragOver={(event) => {
        if (draggedIndex.current === null) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        if (draggedIndex.current === null) return
        event.preventDefault()
        event.stopPropagation()
        moveReference(draggedIndex.current, index)
        resetDrag()
      }}
      onDragEnd={resetDrag}>
      <button type="button" className="reference-preview" title={`参考图 ${index + 1} · 拖动排序，点击预览；Alt + 方向键移动`} onClick={() => onPreview(thumbnail(item.src))} aria-label={`预览参考图 ${index + 1}，可拖动排序`} onKeyDown={(event) => {
        if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
        event.preventDefault()
        const nextIndex = index + (event.key === 'ArrowLeft' ? -1 : 1)
        if (nextIndex < 0 || nextIndex >= references.length) return
        const strip = event.currentTarget.closest('.reference-strip')
        moveReference(index, nextIndex)
        strip?.querySelectorAll('.reference-preview')[nextIndex]?.focus()
      }}><QuietReferenceImage src={thumbnail(item.src)}/></button>
      <span className="reference-order" aria-hidden="true">{index + 1}</span>
      <button type="button" className="reference-remove" draggable={false} onDragStart={(event) => event.preventDefault()} onClick={() => setReferences((current) => current.filter((_, i) => i !== index))} aria-label={`移除参考图 ${index + 1}`}><Icon name="x" size={13}/></button>
    </div>)}
  </div>
}

function ImageComposer({ skillState, prompt, setPrompt, ratio, setRatio, model, setModel, resolution, setResolution, quality, setQuality, references, setReferences, editImage, fileRef, addFiles, appendFiles, submit, loading, error, onPreview }) {
  const [draggingFiles, setDraggingFiles] = useState(false)
  const dragDepth = useRef(0)

  function handleDragEnter(event) {
    if (!hasSupportedDrag(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current += 1
    setDraggingFiles(true)
  }

  function handleDragOver(event) {
    if (!hasSupportedDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(event) {
    if (!hasSupportedDrag(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDraggingFiles(false)
  }

  async function handleDrop(event) {
    event.preventDefault()
    dragDepth.current = 0
    setDraggingFiles(false)
    const generatedImage = event.dataTransfer?.getData(GENERATED_IMAGE_DRAG_TYPE)
    if (generatedImage) {
      const referenceLimit = (editImage ? 3 : 4) - (skillState.selected?.referenceCount || 0)
      setReferences((current) => current.some((item) => item.src === generatedImage) ? current : [...current, { name: '已生成图片', src: generatedImage }].slice(0, referenceLimit))
      return
    }
    await appendFiles(droppedFiles(event.dataTransfer))
  }

  return <div className="composer-wrap">
    <div className={`composer glass-strong ${draggingFiles ? 'is-dragging-files' : ''}`} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {draggingFiles && <div className="image-drop-zone" aria-hidden="true"><span><Icon name="plus" size={16}/></span><b>松开以上传图片</b><small>支持多张</small></div>}
        {references.length > 0 && <ReferenceStrip references={references} setReferences={setReferences} onPreview={onPreview}/>}
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} placeholder="描述你想生成的画面…" rows="2" />
      <div className="composer-tools">
        <div className="tool-group">
          <button className="tool-button reference-add" title="添加参考图" aria-label="添加参考图" onClick={() => fileRef.current?.click()} disabled={references.length >= (editImage ? 3 : 4) - (skillState.selected?.referenceCount || 0)}><Icon name="plus" size={18}/></button>
          <input ref={fileRef} type="file" hidden accept="image/*" multiple onChange={addFiles}/>
          <ComposerSelect label="生图模型" value={model} options={IMAGE_MODEL_OPTIONS} onChange={(nextModel) => { const nextResolution = supportsImageResolution(nextModel) ? '2k' : '1k'; setModel(nextModel); setResolution(nextResolution); setQuality((current) => imageQualityForModel(nextModel, current)); setRatio((current) => normalizedImageRatio(nextModel, nextResolution, current)) }}/>
          <ImageSettings model={model} ratio={ratio} ratios={imageRatioOptions(model, resolution)} onRatio={setRatio} resolution={resolution} onResolution={(nextResolution) => { setResolution(nextResolution); setRatio((current) => normalizedImageRatio(model, nextResolution, current)) }} quality={quality} onQuality={setQuality}/>
          <GenerationSkillPicker target="image" state={skillState}/><KnowledgeContext tool="image"/>
        </div>
        <div className="generation-submit"><span className="generation-credit-cost">消耗 <b>{imageCreditCost(model)}</b> 分</span><button className="send-button" aria-label={loading ? '生成中' : `生成，消耗 ${imageCreditCost(model)} 积分`} onClick={() => submit()} disabled={!prompt.trim() || loading}><Icon name="arrowUp" size={18}/></button></div>
      </div>
    </div>
    {error && <small className="composer-note error">{error}</small>}
  </div>
}

function TextStudio({ type, conversation, onSave }) {
  const copy = MODULE_COPY[type]
  const conversationId = useRef(conversation?.id || crypto.randomUUID())
  const [runtime] = useState(() => textTaskRuntime(conversationId.current, validTextMessages(conversation?.messages)))
  const [messages, setMessages] = useState(() => runtime.messages.current)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState([])
  const [attachmentError, setAttachmentError] = useState('')
  const [brand, setBrand] = useState(conversation?.brand === 'general' ? '' : conversation?.brand || '')
  const webSearch = type === 'strategy'
  const [draggingComplianceFiles, setDraggingComplianceFiles] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [runningRequests, setRunningRequests] = useState(() => [...runtime.active.entries()].map(([id, startedAt]) => ({ id, startedAt })))
  const messagesRef = runtime.messages
  const activeRequestsRef = useRef(runtime.active)
  const uploadingImageAttachmentsRef = useRef(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const complianceFileRef = useRef(null)
  const complianceDragDepth = useRef(0)
  const focusRef = useConversationFocus()
  const conversationScrollRef = useOpenConversationLatest(conversation?.id)
  const followLatestResult = useRef(false)

  function scrollToLatestResult() {
    followLatestResult.current = true
  }

  function updateMessages(nextMessages) {
    messagesRef.current = nextMessages
    setMessages(nextMessages)
  }

  function activeTaskSnapshot() {
    return [...activeRequestsRef.current.entries()].map(([id, startedAt]) => ({ id, startedAt }))
  }

  function startTask(id, startedAt) {
    activeRequestsRef.current.set(id, startedAt)
    setRunningRequests(activeTaskSnapshot())
  }

  function finishTask(id) {
    activeRequestsRef.current.delete(id)
    const nextTasks = activeTaskSnapshot()
    setRunningRequests(nextTasks)
    return nextTasks
  }

  function saveTaskState(nextMessages, { unreadComplete = false, activate = false } = {}) {
    const activeTasks = activeTaskSnapshot()
    onSave({
      id: conversationId.current,
      type,
      messages: nextMessages,
      brand,
      webSearch,
      status: activeTasks.length ? 'running' : 'idle',
      runningStartedAt: activeTasks[0]?.startedAt || null,
      textTasks: activeTasks,
      unreadComplete,
      activate,
    })
  }

  useLayoutEffect(() => {
    if (!followLatestResult.current || !conversationScrollRef.current) return
    conversationScrollRef.current.scrollTop = conversationScrollRef.current.scrollHeight
    followLatestResult.current = false
  }, [messages])

  useEffect(() => {
    if (!conversation || conversation.id !== conversationId.current) return
    if (conversation.status === 'running' && activeRequestsRef.current.size === 0 && conversation.textTasks?.length) {
      updateMessages(validTextMessages(conversation.messages))
      for (const task of conversation.textTasks) {
        startTask(task.id, task.startedAt)
        void waitForTextTask(type === 'compliance' ? 'compliance' : 'text', task.id).then((result) => {
          if (!messagesRef.current.some((message) => message.taskId === task.id)) {
            updateMessages([...messagesRef.current, { role: 'assistant', taskId: task.id, complianceBrand: conversation.brand, content: result.content, sources: result.sources || [], elapsedMs: Date.now() - new Date(task.startedAt).getTime() }])
          }
        }).catch((error) => {
          if (!messagesRef.current.some((message) => message.taskId === task.id)) updateMessages([...messagesRef.current, { role: 'error', taskId: task.id, content: userError(error.message), failedAt: new Date().toISOString() }])
        }).finally(() => {
          finishTask(task.id)
          saveTaskState(messagesRef.current, { unreadComplete: true })
        })
      }
      return
    }
    if (conversation.status === 'running' && activeRequestsRef.current.size === 0 && !conversation.textTasks?.length) {
      const legacyMessages = [...validTextMessages(conversation.messages), { role: 'error', content: '此旧任务未保存可恢复的任务编号，无法继续查询。请重新发送原消息。', failedAt: new Date().toISOString() }]
      updateMessages(legacyMessages)
      saveTaskState(legacyMessages)
      return
    }
    // While this browser is running requests, parent persistence updates can
    // arrive out of order. Keep the live message list as the source of truth.
    if (activeRequestsRef.current.size > 0) {
      setMessages(messagesRef.current)
      setRunningRequests(activeTaskSnapshot())
      if (conversation.brand) setBrand(conversation.brand === 'general' ? '' : conversation.brand)
      return
    }
    updateMessages(validTextMessages(conversation.messages))
    setRunningRequests([])
    if (conversation.brand) setBrand(conversation.brand === 'general' ? '' : conversation.brand)
  }, [conversation])

  useEffect(() => {
    const failedMessages = messages.filter(isFailureMessage)
    if (!failedMessages.length) return undefined
    const cleanUp = () => {
      const nextMessages = withoutFailureMessages(messages)
      if (nextMessages.length === messages.length) return
      updateMessages(nextMessages)
      saveTaskState(nextMessages)
    }
    const nextDeadline = Math.min(...failedMessages.map(failureDeadline))
    if (!nextDeadline || nextDeadline <= Date.now()) { cleanUp(); return undefined }
    const timer = window.setTimeout(cleanUp, nextDeadline - Date.now())
    return () => window.clearTimeout(timer)
  }, [brand, messages, onSave, type, webSearch])

  async function appendComplianceFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 4 - attachments.length)
    const invalid = files.find((file) => file.size > 12 * 1024 * 1024 || !complianceFileKind(file))
    if (invalid) { setAttachmentError(`${invalid.name} 不支持或超过 12MB`); return }
    try {
      const encoded = await Promise.all(files.map(async (file) => {
        if (file.type.startsWith('image/')) return { name: file.name, kind: 'image', mime: file.type, src: await fileToDataUrl(file) }
        const content = await extractComplianceText(file)
        if (!plainText(content)) throw new Error(`${file.name} 未提取到可审核的文字内容`)
        return { name: file.name, kind: 'text', mime: file.type || 'application/octet-stream', content }
      }))
      setAttachments((current) => [...current, ...encoded].slice(0, 4))
      setAttachmentError('')
    } catch (error) { setAttachmentError(userError(error.message) || '文件解析失败') }
  }

  async function addComplianceFiles(event) {
    await appendComplianceFiles(event.target.files)
    event.target.value = ''
  }

  function handleComplianceDragEnter(event) {
    if (type !== 'compliance' || !hasSupportedDrag(event.dataTransfer)) return
    event.preventDefault()
    complianceDragDepth.current += 1
    setDraggingComplianceFiles(true)
  }

  function handleComplianceDragOver(event) {
    if (type !== 'compliance' || !hasSupportedDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleComplianceDragLeave(event) {
    if (type !== 'compliance' || !hasSupportedDrag(event.dataTransfer)) return
    event.preventDefault()
    complianceDragDepth.current = Math.max(0, complianceDragDepth.current - 1)
    if (complianceDragDepth.current === 0) setDraggingComplianceFiles(false)
  }

  async function handleComplianceDrop(event) {
    if (type !== 'compliance') return
    event.preventDefault()
    complianceDragDepth.current = 0
    setDraggingComplianceFiles(false)
    const generatedImage = event.dataTransfer?.getData(GENERATED_IMAGE_DRAG_TYPE)
    if (generatedImage) {
      setAttachments((current) => current.some((item) => item.src === generatedImage) ? current : [...current, { name: '已生成图片', kind: 'image', mime: 'image/*', src: generatedImage }].slice(0, 4))
      return
    }
    await appendComplianceFiles(droppedFiles(event.dataTransfer))
  }

  async function submit(customInput) {
    if (type === 'compliance' && !COMPLIANCE_BRANDS.some((item) => item.value === brand)) {
      setAttachmentError('请先选择品牌，再发送审核')
      return
    }
    const submittedAttachments = attachments
    const submittedInput = customInput || input
    const content = submittedInput.trim() || (submittedAttachments.length ? '请审核我上传的文件。' : '')
    const needsImageUpload = submittedAttachments.some((file) => file.kind === 'image' && file.src?.startsWith('data:image/'))
    if (!content || (needsImageUpload && uploadingImageAttachmentsRef.current)) return
    const startedAt = new Date().toISOString()
    const requestId = crypto.randomUUID()
    startTask(requestId, startedAt)
    // Clear the composer at submission time so a second task can be composed
    // while this request uploads and is being reviewed.
    setInput(''); setAttachments([]); setAttachmentError('')
    if (needsImageUpload) {
      uploadingImageAttachmentsRef.current = true
      setUploadingImages(true)
    }
    if (type === 'compliance') {
      let uploadedAttachments
      try {
        uploadedAttachments = await Promise.all(submittedAttachments.map(async (file) => {
          if (file.kind !== 'image' || !file.src?.startsWith('data:image/')) return file
          const { url } = await uploadComplianceImage({ source: file.src, name: file.name })
          return { ...file, src: url }
        }))
      } catch (error) {
        setAttachmentError(userError(error.message) || '图片保存失败，请重试')
        setInput((current) => current || submittedInput)
        setAttachments((current) => current.length ? current : submittedAttachments)
      } finally {
        uploadingImageAttachmentsRef.current = false
        setUploadingImages(false)
        finishTask(requestId)
      }
      if (uploadedAttachments) await runComplianceConversation(
        { brand, content, attachments: uploadedAttachments, startedAt, requestId },
        { onSave, createRuntime: textTaskRuntime, generate: generatePersistentText, basePrompt: copy.systemPrompt },
      )
      return
    }
    let completed = false
    try {
      const submittedMessage = { role: 'user', content }
      const nextMessages = [...messagesRef.current, submittedMessage]
      updateMessages(nextMessages)
      scrollToLatestResult()
      saveTaskState(nextMessages, { activate: true })
      const requestMessages = nextMessages.filter((item) => item.role !== 'error').map((item) => {
        if (item.role !== 'user' || !item.attachments?.length) return { role: item.role, content: item.content }
        const textFiles = item.attachments.filter((file) => file.kind === 'text')
        // Keep prior answers as conversation context, but only send the
        // images attached to this submission. A stale historical thumbnail
        // must never prevent the current review from running.
        const imageFiles = item === submittedMessage ? item.attachments.filter((file) => file.kind === 'image' && file.src) : []
        const imageInstruction = imageFiles.length ? `\n\n当前消息附带 ${imageFiles.length} 张待审核图片。你必须直接查看图片中的文字、Logo、排版和可见内容并完成审核，不得要求用户再次提供图片或图片文字。` : ''
        const text = [item.content, imageInstruction, ...textFiles.map((file) => `\n\n--- 文件：${file.name} ---\n${file.content}`)].join('')
        return { role: 'user', content: [{ type: 'text', text }, ...imageFiles.map((file) => ({ type: 'image_url', image_url: { url: file.src, detail: 'high' } }))] }
      })
      const systemPrompt = type === 'compliance' ? buildComplianceSystemPrompt(brand, copy.systemPrompt) : copy.systemPrompt
      const result = await generatePersistentText(type === 'compliance' ? 'compliance' : 'text', requestId, { messages: requestMessages, systemPrompt, webSearch, searchQuery: content, ...(type === 'compliance' ? { complianceBrand: brand } : {}) })
      const completedMessages = messagesRef.current.some((message) => message.taskId === requestId) ? messagesRef.current : [...messagesRef.current, { role: 'assistant', taskId: requestId, content: result.content, sources: result.sources || [], elapsedMs: Date.now() - new Date(startedAt).getTime() }]
      updateMessages(completedMessages)
      scrollToLatestResult()
      completed = true
    } catch (err) {
      if (needsImageUpload) {
        setAttachmentError(userError(err.message) || '图片保存失败，请重试')
        setInput((current) => current || submittedInput)
        setAttachments((current) => current.length ? current : submittedAttachments)
      } else {
        const failedMessages = [...messagesRef.current, { role: 'error', content: userError(err.message), elapsedMs: Date.now() - new Date(startedAt).getTime(), failedAt: new Date().toISOString() }]
        updateMessages(failedMessages)
        scrollToLatestResult()
      }
    } finally {
      finishTask(requestId)
      saveTaskState(messagesRef.current, { unreadComplete: completed })
    }
  }

  return <section className={`workspace text-workspace ${messages.length === 0 ? 'empty' : ''}`} onDragEnter={handleComplianceDragEnter} onDragOver={handleComplianceDragOver} onDragLeave={handleComplianceDragLeave} onDrop={handleComplianceDrop}>
    <div className="conversation" ref={conversationScrollRef}>
      {messages.length === 0 && runningRequests.length === 0 ? <div className="welcome text-welcome">
        <div className={`text-orb ${type}`}><Icon name={type === 'strategy' ? 'spark' : 'shield'} size={38}/></div>
        <div className="eyebrow">{copy.eyebrow}</div><h1>{copy.title}</h1><p>{copy.subtitle}</p>
      </div> : <div className="message-list text-list">{messages.map((message, index) => {
        const messageRef = runningRequests.length === 0 && index === messages.length - 1 ? focusRef : null
        return message.role === 'user' ? <TextUserMessage message={message} messageRef={messageRef} onPreview={setPreviewImage} key={index}/> : message.role === 'error' ? <div ref={messageRef} className="error-message" key={index}><span><b>请求失败{message.elapsedMs != null ? ` · 耗时 ${formatElapsed(message.elapsedMs)}` : ''}</b>{message.content}</span></div> : <div ref={messageRef} className="assistant-turn text-answer has-copy-control" key={index}>{message.elapsedMs != null && <div className="task-elapsed">耗时 {formatElapsed(message.elapsedMs)}</div>}{type === 'compliance' ? <ComplianceReport content={message.content} brand={message.complianceBrand || conversation?.brand || brand}/> : <AnswerText content={message.content}/>}<TextSources sources={message.sources}/><MessageCopyButton content={type === 'compliance' ? formatComplianceReport(message.content) : message.content} label={type !== 'compliance'}/></div>
      })}
        {runningRequests.map((task, index) => <div ref={index === runningRequests.length - 1 ? focusRef : null} key={task.id}><LiveTaskStatus startedAt={task.startedAt} label={type === 'compliance' ? (uploadingImages ? '正在上传图片' : '正在审核图片与内容') : '思考中'}/></div>)}
        <div className="conversation-tail-space" aria-hidden="true"/>
      </div>}
    </div>
    <div className="composer-wrap text-composer-wrap"><div className={`composer glass-strong ${draggingComplianceFiles ? 'is-dragging-files' : ''}`}>
      {type === 'compliance' && draggingComplianceFiles && <div className="image-drop-zone" aria-hidden="true"><span><Icon name="plus" size={16}/></span><b>松开以上传图片</b><small>支持多张</small></div>}
      {type === 'compliance' && attachments.some((file) => file.kind === 'image' && file.src) && <div className="reference-strip">{attachments.filter((file) => file.kind === 'image' && file.src).map((file, index) => <div key={file.name + index}><button type="button" className="reference-preview" onClick={() => setPreviewImage(file.src)} aria-label={`预览上传图片 ${index + 1}`}><QuietReferenceImage src={file.src}/></button><button type="button" className="reference-remove" onClick={() => setAttachments((current) => current.filter((item) => item !== file))} aria-label={`移除图片 ${index + 1}`}><Icon name="x" size={13}/></button></div>)}</div>}
      {type === 'compliance' && attachments.some((file) => file.kind !== 'image') && <div className="compliance-file-strip">{attachments.filter((file) => file.kind !== 'image').map((file, index) => <span key={file.name + index}><Icon name="book" size={14}/><b>{file.name}</b><button type="button" onClick={() => setAttachments((current) => current.filter((item) => item !== file))} aria-label={`移除文件 ${index + 1}`}><Icon name="x" size={12}/></button></span>)}</div>}
      <textarea rows="3" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} placeholder={copy.placeholder}/><div className="composer-tools">
        {type === 'compliance' ? <div className="tool-group">
          <button className="tool-button reference-add" type="button" title="上传文件" aria-label="上传文件" onClick={() => complianceFileRef.current?.click()} disabled={attachments.length >= 4}><Icon name="plus" size={18}/></button>
          <input ref={complianceFileRef} type="file" hidden multiple accept="image/*,.txt,.md,.csv,.json,.html,.xml,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/*" onChange={addComplianceFiles}/>
          <ComposerSelect className="compliance-brand-select" label="选择审核品牌" placeholder="请选择审核品牌或项目" value={brand} options={COMPLIANCE_BRANDS} onChange={(value) => { setBrand(value); setAttachmentError('') }}/>
        </div> : <div className="text-tools"><span className="model-chip">Gemini 3.1 Pro</span><KnowledgeContext tool="text"/></div>}
        <button className={`send-button${type === 'compliance' ? ' compliance-start-button' : ''}`} aria-label={uploadingImages ? '正在上传图片' : type === 'compliance' ? '开始审核' : '发送'} onClick={() => submit()} disabled={uploadingImages || (!input.trim() && attachments.length === 0)}>{type === 'compliance' ? '开始审核' : <Icon name="arrowUp" size={18}/>}</button>
      </div></div>{attachmentError && <small className="composer-note error">{attachmentError}</small>}</div>
    {previewImage && <ImagePreview url={previewImage} onClose={() => setPreviewImage(null)}/>} 
  </section>
}

export default function App() {
  const localPreviewParams = new URLSearchParams(window.location.search)
  const directAvatarTool = localPreviewParams.get('tool') === 'avatar'
  const directCompliance = localPreviewParams.get('module') === 'compliance'
  const directContent = localPreviewParams.get('module') === 'content'
  const directSkills = ['skills', 'discover-skills'].includes(localPreviewParams.get('module')) ? localPreviewParams.get('module') : ''
  const directKnowledgeSection = KNOWLEDGE_SECTIONS.find((item) => item.id === localPreviewParams.get('module'))?.id
  const localBatchPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname) && localPreviewParams.get('preview') === 'batch'
  const localAvatarPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname) && localPreviewParams.get('preview') === 'avatar'
  const localPreviewTheme = localPreviewParams.get('theme')
  const [authState, setAuthState] = useState(() => getAuthToken() ? 'checking' : 'guest')
  const [user, setUser] = useState(null)
  const [loginPromptModule, setLoginPromptModule] = useState(null)
  const [active, setActive] = useState(() => localPreviewParams.get('module') === 'film' ? 'film' : directSkills ? directSkills : directKnowledgeSection ? directKnowledgeSection : directContent ? 'content' : directCompliance ? 'compliance' : directAvatarTool ? 'more' : 'image')
  useEffect(() => {
    const url = new URL(window.location.href)
    if (active !== 'film') url.searchParams.delete('filmProject')
    if (active === 'film' || KNOWLEDGE_SECTIONS.some((item) => item.id === active)) url.searchParams.set('module', active)
    else if (url.searchParams.get('module') === 'film' || KNOWLEDGE_SECTIONS.some((item) => item.id === url.searchParams.get('module'))) {
      for (const key of ['module', 'brand', 'document', 'version', 'material', 'filmProject']) url.searchParams.delete(key)
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [active])
  const [moreTool, setMoreTool] = useState('please-day')
  const [imageMode, setImageMode] = useState(() => localStorage.getItem(IMAGE_MODE_KEY) === 'dialogue' ? 'dialogue' : 'waterfall')
  const [pendingImageMode, setPendingImageMode] = useState(null)
  const [theme, setTheme] = useState(() => {
    if (!THEME_SELECTION_ENABLED) return 'dark'
    if (['light', 'dark'].includes(localPreviewTheme)) return localPreviewTheme
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [workspaceToken, setWorkspaceToken] = useState(0)
  const [filmDeepLink, setFilmDeepLink] = useState(() => localPreviewParams.get('module') === 'film' ? localPreviewParams.get('filmProject') : null)
  const activeWorkspace = useRef(workspaceToken)
  activeWorkspace.current = workspaceToken
  const [archiveViewOpen, setArchiveViewOpen] = useState(false)
  const pendingArchives = useRef(new Map())
  const archiveRevision = useRef(0)
  const accountScope = useRef(user?.id)
  accountScope.current = user?.id
  const conversationStorageKey = user ? `${STORAGE_KEY}:${user.email}` : STORAGE_KEY
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || null
  const activeConversations = conversations.filter((conversation) => !conversation.archived && !conversation.deleted && pendingArchives.current.get(conversation.id) !== conversationStorageKey)
  const archivedConversations = conversations.filter((conversation) => conversation.archived && !conversation.deleted)

  useEffect(() => {
    if (authState !== 'checking') return
    getCurrentAccount().then(({ user: account }) => { setUser(account); setAuthState('authenticated') }).catch(() => { clearAuthToken(); setAuthState('guest') })
  }, [authState])

  useEffect(() => {
    if (authState === 'checking') return
    // Video generation is a persistent waterfall workspace, not a chat.
    // Remove records left by the earlier node-based video workspace so they
    // no longer appear alongside actual conversations.
    const savedKey = user ? `${STORAGE_KEY}:${user.email}` : STORAGE_KEY
    const loaded = loadConversations(savedKey)
    const withoutVideoHistory = loaded.filter((conversation) => conversation.type !== 'video')
    if (withoutVideoHistory.length !== loaded.length) {
      try { localStorage.setItem(savedKey, JSON.stringify(withoutVideoHistory)) } catch { /* Keep the cleaned list in memory if storage is unavailable. */ }
    }
    setConversations(withoutVideoHistory)
    setActiveConversationId(null)
  }, [user, authState])

  useEffect(() => {
    if (!THEME_SELECTION_ENABLED) return
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem(THEME_KEY, theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#16191f' : '#fcfcfd')
  }, [theme])

  function updateConversations(transform) {
    setConversations((current) => {
      const next = transform(current)
      if (next === current) return current
      try { localStorage.setItem(conversationStorageKey, JSON.stringify(next.filter(item => !(item.archived && item.serverArchived && item.type !== 'film')))) } catch { /* Storage quota: keep the in-memory history. */ }
      return next
    })
  }

  useEffect(() => {
    if (!user || authState !== 'authenticated') return
    let live = true
    const pending = id => pendingArchives.current.get(id) === conversationStorageKey
    const sync = () => {
      const revision = archiveRevision.current
      return filmRequest('/history').then(({ projects }) => {
        if (!live || revision !== archiveRevision.current) return
        const confirmed = projects.filter(project => !pending(`film:${project.id}`))
        for (const project of confirmed.filter(item => item.archived)) clearFilmCache(user.id, project.id)
        updateConversations(current => mergeFilmHistory(current, confirmed))
      }).catch(() => {})
    }
    const syncArchives = () => {
      const revision = archiveRevision.current
      return filmRequest('/archive-records').then(({ records }) => {
        if (!live || revision !== archiveRevision.current) return
        updateConversations(current => {
          const confirmed = records.filter(record => !pending(record.id))
          const remoteIds = new Set(confirmed.map(record => record.id))
          return [...current.filter(item => pending(item.id) || (!remoteIds.has(item.id) && !item.serverArchived)), ...confirmed.map(record => ({ ...record, serverArchived: Boolean(record.archived) }))]
        })
      }).catch(() => {})
    }
    sync()
    syncArchives()
    const timer = setInterval(() => { sync(); syncArchives() }, 15000)
    return () => { live = false; clearInterval(timer) }
  }, [user, authState, conversationStorageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function recordFilm(project) {
    updateConversations((current) => mergeFilmHistory(current, [{
      ...project, named: Boolean(project.plan || project.directorPlan || project.script),
    }]))
    if (activeWorkspace.current === workspaceToken) setActiveConversationId(`film:${project.id}`)
  }

  function saveConversation(update) {
    const now = new Date().toISOString()
    const { activate, openNew, ...conversationUpdate } = update
    if (activate) setActiveConversationId(update.id)
    if (openNew) setWorkspaceToken((value) => value + 1)
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === update.id)
      const record = safeConversation({ ...existing, ...conversationUpdate, createdAt: existing?.createdAt || now, updatedAt: now })
      const next = [record, ...current.filter((conversation) => conversation.id !== update.id)].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      try { localStorage.setItem(conversationStorageKey, JSON.stringify(next)) } catch { /* Storage quota: keep the in-memory history. */ }
      return next
    })
  }

  function startNew(type = active) {
    setFilmDeepLink(null)
    setArchiveViewOpen(false)
    setActive(type)
    setActiveConversationId(null)
    setWorkspaceToken((value) => value + 1)
  }

  function changeModule(type) {
    if (type === 'strategy') { window.location.assign('/demos/activity-chat/'); return }
    if (!user && type !== 'more' && type !== 'skills' && type !== 'discover-skills' && type !== 'compliance' && !KNOWLEDGE_SECTIONS.some((item) => item.id === type)) { setPendingImageMode(null); openLogin(type); return }
    startNew(type)
  }

  function selectMoreTool(tool) {
    if (!user && !['please-day', 'qr'].includes(tool)) { setLoginPromptModule('more-qr'); return }
    const url = new URL(window.location.href)
    if (tool === 'please-day') url.searchParams.set('tool', 'avatar')
    else url.searchParams.delete('tool')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    setMoreTool(tool)
    startNew('more')
  }

  function selectImageMode(mode) {
    if (!user) { setPendingImageMode(mode); openLogin('image'); return }
    setImageMode(mode)
    localStorage.setItem(IMAGE_MODE_KEY, mode)
    setArchiveViewOpen(false)
    setActive('image')
    setWorkspaceToken((value) => value + 1)
  }

  function openArchiveView() {
    setArchiveViewOpen(true)
    setWorkspaceToken((value) => value + 1)
  }

  function openAdmin() {
    if (user?.email?.toLowerCase() !== 'zhangwj159@onewo.com') return
    setArchiveViewOpen(false)
    setActive('admin')
    setActiveConversationId(null)
    setWorkspaceToken((value) => value + 1)
  }

  function openLogin(module = 'general') {
    setLoginPromptModule(module)
  }

  function completeLogin(account) {
    const requestedModule = loginPromptModule
    setUser(account); setAuthState('authenticated'); setLoginPromptModule(null)
    if (requestedModule === 'more-qr') { setMoreTool('qr'); startNew('more') }
    else if (requestedModule === 'image') {
      if (pendingImageMode) {
        setImageMode(pendingImageMode)
        localStorage.setItem(IMAGE_MODE_KEY, pendingImageMode)
        setPendingImageMode(null)
      }
      startNew('image')
    } else if (requestedModule && requestedModule !== 'general') startNew(requestedModule)
  }

  function selectConversation(conversation) {
    setFilmDeepLink(null)
    setArchiveViewOpen(false)
    if (conversation.unreadComplete || conversation.messages?.some(isFailureMessage)) {
      updateConversations((current) => current.map((item) => item.id === conversation.id
        ? { ...item, unreadComplete: false, messages: withoutFailureMessages(item.messages) }
        : item))
    }
    if (conversation.type === 'image') {
      setImageMode('dialogue')
      localStorage.setItem(IMAGE_MODE_KEY, 'dialogue')
    }
    setActive(conversation.type)
    setActiveConversationId(conversation.id)
    setWorkspaceToken((value) => value + 1)
  }

  function togglePinConversation(id) {
    updateConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, pinned: !conversation.pinned, pinnedAt: conversation.pinned ? null : new Date().toISOString() } : conversation))
  }

  function renameConversation(id, title) {
    const nextTitle = title.trim().slice(0, 80)
    if (!nextTitle) return
    updateConversations((current) => current.map((conversation) => conversation.id === id
      ? { ...conversation, title: nextTitle, updatedAt: new Date().toISOString() }
      : conversation))
  }

  function clearFilmCache(userId, projectId) {
    try {
      localStorage.removeItem(`dgen-film-project-${userId}-${projectId}`)
      for (const suffix of ['stage', 'selected', 'message', 'panel']) localStorage.removeItem(`film-workbench:${projectId}:${suffix}`)
    } catch { /* Storage may be unavailable. */ }
  }

  async function archiveConversation(id) {
    const item = conversations.find(conversation => conversation.id === id)
    if (!item || item.archived || pendingArchives.current.get(id) === conversationStorageKey) return
    pendingArchives.current.set(id, conversationStorageKey)
    archiveRevision.current++
    updateConversations(current => current.map(conversation => conversation.id === id
      ? { ...conversation, archived: true, pinned: false, pinnedAt: null }
      : conversation))
    if (activeConversationId === id) startNew()

    try {
      const signal = AbortSignal.timeout(20000)
      if (item.type === 'film' && item.projectId) {
        await filmRequest(`/${encodeURIComponent(item.projectId)}/archive`, { archived: true }, { signal })
        clearFilmCache(user.id, item.projectId)
      } else if (user) {
        await filmRequest('/archive-records', { id, record: item }, { signal })
      }
      if (accountScope.current === user?.id) {
        updateConversations(current => current.map(conversation => conversation.id === id
          ? { ...conversation, serverArchived: Boolean(user && item.type !== 'film') }
          : conversation))
      }
    } catch (error) {
      if (accountScope.current !== user?.id) return
      updateConversations(current => current.map(conversation => conversation.id === id
        ? { ...conversation, archived: item.archived, pinned: item.pinned, pinnedAt: item.pinnedAt }
        : conversation))
      window.alert(`归档失败：${error.message}`)
    } finally {
      if (pendingArchives.current.get(id) === conversationStorageKey) pendingArchives.current.delete(id)
      archiveRevision.current++
    }
  }

  async function restoreConversation(id) {
    const item = conversations.find((conversation) => conversation.id === id)
    if (item?.type === 'film' && item.projectId) {
      try { await filmRequest(`/${encodeURIComponent(item.projectId)}/archive`, { archived: false }) }
      catch (error) { window.alert(`恢复失败：${error.message}`); return }
    } else if (item && user) {
      try {
        const restored = { ...item, archived: false, updatedAt: new Date().toISOString() }
        const next = conversations.map(record => record.id === id ? restored : record).filter(record => !(record.archived && record.type !== 'film'))
        localStorage.setItem(conversationStorageKey, JSON.stringify(next))
        await filmRequest('/archive-records', { id, record: restored, restore: true })
      } catch (error) { window.alert(`恢复失败：${error.message}`); return }
    }
    updateConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, archived: false, updatedAt: new Date().toISOString() } : conversation))
  }

  async function deleteConversation(id) {
    const item = conversations.find(conversation => conversation.id === id)
    if (user && item?.type !== 'film') {
      try { await filmRequest('/archive-records', { id, restore: true }) }
      catch (error) { window.alert(`删除失败：${error.message}`); return }
    }
    updateConversations((current) => current.flatMap((conversation) => conversation.id !== id ? [conversation] : conversation.type === 'film' ? [{ id, type: 'film', deleted: true }] : []))
  }

  async function deleteAllArchived() {
    if (user) {
      try { for (const item of archivedConversations.filter(conversation => conversation.type !== 'film')) await filmRequest('/archive-records', { id: item.id, restore: true }) }
      catch (error) { window.alert(`删除失败：${error.message}`); return }
    }
    updateConversations((current) => current.flatMap((conversation) => !conversation.archived ? [conversation] : conversation.type === 'film' ? [{ id: conversation.id, type: 'film', deleted: true }] : []))
  }

  const pageTitle = archiveViewOpen ? WORKSPACE_TITLES.archive
    : active === 'more' ? MORE_WORKSPACE_TITLES[moreTool]
    : WORKSPACE_TITLES[active]

  const content = archiveViewOpen
    ? <ArchiveWorkspace key={workspaceToken} archived={archivedConversations} onRestore={restoreConversation} onDelete={deleteConversation} onDeleteAll={deleteAllArchived}/>
    : active === 'admin'
      ? <AdminStudio key={workspaceToken}/>
    : active === 'more'
      ? <MoreTools key={workspaceToken} tool={moreTool}/>
    : active === 'image'
      ? <ImageStudio key={workspaceToken} conversation={activeConversation} onSave={saveConversation} imageMode={imageMode} waterfallStorageKey={`${WATERFALL_CACHE_PREFIX}${user?.email || 'guest'}`} onUserUpdate={setUser} onRequireLogin={() => openLogin('image')}/>
      : active === 'content'
        ? <FestivalPosterStudio key={workspaceToken} onUserUpdate={setUser} onRequireLogin={() => openLogin('content')}/>
      : active === 'skills'
        ? <SkillLibrary key={user?.id || 'guest'} user={user} onLogin={() => openLogin('skills')} onUse={(skill, target) => { selectGenerationSkill(target, skill.id); if (target === 'image') { setImageMode('waterfall'); localStorage.setItem(IMAGE_MODE_KEY, 'waterfall') }; startNew(target) }}/>
      : active === 'discover-skills'
        ? <DiscoverSkills key={user?.id || 'guest'} user={user} onLogin={() => openLogin('discover-skills')} onUse={(skill, target) => { selectGenerationSkill(target, skill.id); if (target === 'image') { setImageMode('waterfall'); localStorage.setItem(IMAGE_MODE_KEY, 'waterfall') }; startNew(target) }}/>
      : active === 'marketing-activities'
        ? <KnowledgeStudio key={`marketing:${user?.id || 'guest'}`} user={user} spaceName="营销活动" onLogin={() => openLogin('marketing-activities')}/>
      : active === 'brand-knowledge'
        ? <KnowledgeStudio user={user} onLogin={() => openLogin('brand-knowledge')}/>
      : active === 'assets'
        ? <MaterialLibrary key={workspaceToken}/>
      : ['brand-manual', 'marketing-strategy'].includes(active)
        ? <section className="material-library-workspace"><div className="material-library-page"><header className="material-library-header"><div><span>KNOWLEDGE BASE</span><h1>{KNOWLEDGE_SECTIONS.find((item) => item.id === active)?.label}</h1><p>{active === 'brand-manual' ? '集中查阅品牌规范与使用指引。' : '集中查阅营销策略与策划参考。'}</p></div></header><div className="knowledge-empty glass-strong"><Icon name="book" size={32}/><h2>暂无{active === 'brand-manual' ? '品牌手册' : '营销策略'}</h2><p>相关内容待补充</p></div></div></section>
      : active === 'video'
        ? <VideoStudio key={workspaceToken}/>
      : active === 'film' ? <FilmStudio key={`film:${user?.id || 'guest'}:${workspaceToken}`} user={user} projectId={activeConversation?.projectId || filmDeepLink} onCreated={recordFilm} onNew={() => startNew('film')} onLogin={() => openLogin('film')}/> : <TextStudio key={workspaceToken} type={active} conversation={activeConversation} onSave={saveConversation}/>

  async function logout() {
    try { await logoutAccount() } catch { /* Clear local login even if the server is unavailable. */ }
    clearAuthToken(); setUser(null); setConversations([]); setAuthState('guest')
  }

  if (localBatchPreview) return <div className="app-shell batch-preview-shell"><div className="atmosphere"/><main className="main"><Suspense fallback={<p role="status">正在加载工具…</p>}><QrBatchStudio/></Suspense></main></div>
  if (localAvatarPreview) return <div className="app-shell batch-preview-shell"><div className="atmosphere"/><main className="main"><PleaseDayAvatarStudio/></main></div>
  if (authState === 'checking') return <div className="auth-loading"><span className="brand-avatar"><BrandIcon alt="D-Gen"/></span><i/></div>
  return <div className="app-shell"><div className="atmosphere"/><Sidebar active={active} onChange={changeModule} imageMode={imageMode} onSelectImageMode={selectImageMode} moreTool={moreTool} onSelectMoreTool={selectMoreTool} onNew={() => user || active === 'compliance' || active === 'more' ? startNew(active, { createHistory: true }) : openLogin('image')} conversations={activeConversations} activeConversationId={activeConversationId} onSelectConversation={selectConversation} onPinConversation={togglePinConversation} onArchiveConversation={archiveConversation} onRenameConversation={renameConversation} onOpenArchive={openArchiveView} onOpenAdmin={openAdmin} theme={theme} onThemeChange={setTheme} open={sidebarOpen} onClose={() => setSidebarOpen(false)} user={user} onLogout={logout} onLogin={() => openLogin('general')}/><main className={`main${pageTitle ? " has-workspace-title" : ""}`}><Topbar onMenu={() => setSidebarOpen(true)}/>{pageTitle && <div className="workspace-title-slot"><ToolPageHeader eyebrow={pageTitle[0]} title={pageTitle[1]}/></div>}<Suspense fallback={<p role="status">正在加载工具…</p>}>{content}</Suspense></main>{loginPromptModule && <AuthScreen onClose={() => { setLoginPromptModule(null); setPendingImageMode(null) }} onAuthenticated={completeLogin}/>}</div>
}
