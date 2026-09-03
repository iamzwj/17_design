import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import { cancelWaterfallTask, changeAccountPassword, clearAuthToken, createWaterfallTask, downloadGeneratedImage, generateImage, generateText, fileToDataUrl, getAuthToken, getCurrentAccount, listWaterfallTasks, loginAccount, logoutAccount, reconnectGoogleDrive, registerAccount, requestRegisterCode, saveAuthToken, uploadGoogleDriveImage, verifyRegisterCode, waterfallReferenceForRequest } from './api.js'
import { buildComplianceSystemPrompt, COMPLIANCE_BRANDS } from './complianceRules.js'
import { Icon } from './icons.jsx'
import QrBatchStudio from './QrBatchStudio.jsx'
import MoreTools from './MoreTools.jsx'
import PleaseDayAvatarStudio from './PleaseDayAvatarStudio.jsx'
import VideoHub from './VideoHub.jsx'
import ImagePreview from './ImagePreview.jsx'
import { IMAGE_MODEL_OPTIONS, VIP_IMAGE_MODEL, VIP_IMAGE_RESOLUTION_OPTIONS, imageCreditCost, imageResolutionForModel } from './imageModels.js'

const MODULES = [
  { id: 'image', label: '图像创作', caption: '灵感变成画面', icon: 'image' },
  { id: 'strategy', label: '文案编撰', caption: '洞察与方案生成', icon: 'spark' },
  { id: 'video', label: '视频生成', caption: '节点式视频工作台', icon: 'video' },
  { id: 'compliance', label: '合规审核', caption: '内容风险预检', icon: 'shield' },
  { id: 'more', label: '更多工具', caption: '头像与批量套图', icon: 'blocks' },
  { id: 'content', label: '内容生产', caption: '即将上线', icon: 'book', disabled: true },
]

const RATIO_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: '9:21', label: '9:21' },
  { value: '9:16', label: '9:16' },
  { value: '2:3', label: '2:3' },
  { value: '3:4', label: '3:4' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '16:9', label: '16:9' },
  { value: '21:9', label: '21:9' },
]

const MODULE_COPY = {
  strategy: {
    eyebrow: 'AI STRATEGY',
    title: '一起把想法，变成清晰的策略。',
    subtitle: '输入你的目标、背景与限制，AI 会与你逐步梳理洞察、定位和执行方案。',
    placeholder: '告诉我你正在解决的问题，例如：为新品制定一份小红书上市策略…',
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
const IMAGE_MODE_KEY = 'diefa-image-mode-v1'
const WATERFALL_CACHE_PREFIX = 'diefa-waterfall-cache-v1:'
const GENERATED_IMAGE_DRAG_TYPE = 'application/x-diefa-generated-image'
const COMPLIANCE_FILE_EXTENSIONS = /\.(txt|md|csv|json|html|xml|pdf|doc|docx|xlsx|xls|ppt|pptx)$/i
const MAX_COMPLIANCE_TEXT_LENGTH = 60_000
const FAILURE_MESSAGE_TTL_MS = 5 * 60 * 1000
const FAILED_TASK_STATUSES = new Set(['failed', 'timeout'])

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

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

function promptAspectRatio(prompt) {
  const match = String(prompt || '').match(/(\d{1,2})\s*[:：比x×]\s*(\d{1,2})/i)
  const value = match ? `${Number(match[1])}:${Number(match[2])}` : '1:1'
  return RATIO_OPTIONS.some((option) => option.value === value) ? value : '1:1'
}

async function automaticReferenceAspect(source, prompt) {
  const fallback = promptAspectRatio(prompt)
  if (!source) return fallback
  return new Promise((resolve) => {
    const image = new Image()
    const finish = () => {
      if (!image.naturalWidth || !image.naturalHeight) return resolve(fallback)
      const sourceRatio = image.naturalWidth / image.naturalHeight
      const closest = RATIO_OPTIONS.filter((option) => option.value !== 'auto').reduce((nearest, option) => {
        const [width, height] = option.value.split(':').map(Number)
        const [bestWidth, bestHeight] = nearest.split(':').map(Number)
        return Math.abs(Math.log(width / height / sourceRatio)) < Math.abs(Math.log(bestWidth / bestHeight / sourceRatio)) ? option.value : nearest
      }, '1:1')
      resolve(closest)
    }
    image.onload = finish
    image.onerror = () => resolve(fallback)
    image.src = source
    window.setTimeout(() => resolve(fallback), 800)
  })
}

function createOptimisticWaterfallTask({ prompt, images = [], aspectRatio = 'auto', count = 2, model = VIP_IMAGE_MODEL, resolution = '2k', resolvedAspectRatio, clientRequestId }) {
  const now = new Date().toISOString()
  return {
    id: clientRequestId || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    prompt: prompt.trim(),
    aspectRatio,
    resolvedAspectRatio: resolvedAspectRatio || (aspectRatio === 'auto' ? promptAspectRatio(prompt) : aspectRatio),
    model,
    resolution: imageResolutionForModel(model, resolution),
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

function loadWaterfallCache(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]')
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
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return result.value.slice(0, MAX_COMPLIANCE_TEXT_LENGTH)
  }
  if (/\.pdf$/i.test(name)) {
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
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    return workbook.SheetNames.slice(0, 12).map((sheetName) => `--- 工作表：${sheetName} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]).slice(0, 12_000)}`).join('\n\n').slice(0, MAX_COMPLIANCE_TEXT_LENGTH)
  }
  if (/\.pptx$/i.test(name)) {
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

function waterfallThumbnailUrl(value) {
  const url = String(value || '')
  // A previous 404 can be cached by the browser while a deployment writes the
  // local asset. Versioning this route makes saved images retry cleanly.
  return url.startsWith('/api/waterfall/assets/') ? `${url}${url.includes('?') ? '&' : '?'}v=2` : url
}

function failureTaskDeadline(task) {
  const finishedAt = new Date(task?.completedAt || task?.updatedAt || task?.createdAt || '').getTime()
  return Number.isFinite(finishedAt) ? finishedAt + FAILURE_MESSAGE_TTL_MS : 0
}

function safeConversation(conversation) {
  const videoHub = conversation.videoHub
  const isPersistentMediaUrl = (value) => {
    const url = String(value || '')
    return Boolean(url) && !url.startsWith('data:') && !url.startsWith('blob:')
  }
  return {
    ...conversation,
    messages: (conversation.messages || []).map((message) => ({
      ...message,
      references: message.references?.filter((item) => isPersistentMediaUrl(item.src)),
      attachments: message.attachments?.map((item) => item.kind === 'image' ? { ...item, src: isPersistentMediaUrl(item.src) ? item.src : '' } : item),
    })),
    ...(videoHub ? {
      videoHub: {
        ...videoHub,
        // Local uploads are base64 data URLs. Keeping them in the conversation
        // list can exceed localStorage and make the whole history disappear on
        // reload. Prompts, nodes and generated public URLs remain restorable.
        imageRefs: (videoHub.imageRefs || []).filter(isPersistentMediaUrl),
        videoRefs: (videoHub.videoRefs || []).filter(isPersistentMediaUrl),
        imageUrls: (videoHub.imageUrls || []).filter(isPersistentMediaUrl),
      },
    } : {}),
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

function LiveTaskStatus({ startedAt }) {
  return <div className="task-elapsed live"><span className="task-thinking"><i/>思考中</span><LiveElapsed startedAt={startedAt}/></div>
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
  const items = (sources || []).filter((source) => source?.url)
  if (!items.length) return null
  return <div className="text-sources" aria-label="联网搜索来源"><span>搜索来源</span>{items.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>)}</div>
}

function ConversationRow({ conversation, activeConversationId, onSelect, onPin, onArchive, onRename }) {
  const module = MODULES.find((item) => item.id === conversation.type)
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

function Sidebar({ active, onChange, imageMode, onSelectImageMode, moreTool, onSelectMoreTool, onNew, conversations, activeConversationId, onSelectConversation, onPinConversation, onArchiveConversation, onRenameConversation, onOpenArchive, theme, onThemeChange, open, onClose, user, onChangePassword, onLogout, onLogin }) {
  const pinned = conversations.filter((conversation) => conversation.pinned)
  const regular = conversations.filter((conversation) => !conversation.pinned)
  const [accountExpanded, setAccountExpanded] = useState(false)
  const [imageExpanded, setImageExpanded] = useState(false)
  const [moreExpanded, setMoreExpanded] = useState(false)
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
        <span className="brand-avatar" role="img" aria-label="小蝶">
          <img className="mascot-frame mascot-open" src="/xiaodie-frame-open.png?v=3" alt="" />
          <img className="mascot-frame mascot-wave" src="/xiaodie-frame-wave.png?v=3" alt="" style={{ opacity: 0 }} />
          <img className="mascot-frame mascot-blink" src="/xiaodie-frame-blink.png?v=3" alt="" style={{ opacity: 0 }} />
        </span>
        <div className="brand-copy">
          <div className="brand-name">小蝶</div>
          <div className="brand-caption">AI办公小能手</div>
        </div>
      </div>
      <button className="new-task" onClick={() => { onNew(); onClose() }}><Icon name="plus" size={18}/> 新对话</button>
      <nav className="module-nav primary-tools">
        {MODULES.map((item) => item.id === 'image' ? <div className="more-tool-nav" key={item.id}>
          <button disabled={item.disabled} className={active === item.id ? 'active' : ''} aria-expanded={imageExpanded} onClick={() => { if (item.disabled) return; setImageExpanded((value) => !value); onChange(item.id) }}><Icon name={item.icon} size={17}/><b>{item.label}</b><Icon name="chevron" size={14}/></button>
          {imageExpanded && <div className="module-submenu" role="menu" aria-label="图像创作模式">
            <button type="button" role="menuitem" aria-current={active === 'image' && imageMode === 'dialogue' ? 'true' : undefined} className={active === 'image' && imageMode === 'dialogue' ? 'active' : ''} onClick={() => { onSelectImageMode('dialogue'); onClose() }}>对话模式</button>
            <button type="button" role="menuitem" aria-current={active === 'image' && imageMode === 'waterfall' ? 'true' : undefined} className={active === 'image' && imageMode === 'waterfall' ? 'active' : ''} onClick={() => { onSelectImageMode('waterfall'); onClose() }}>瀑布流模式</button>
          </div>}
        </div> : item.id === 'more' ? <div className="more-tool-nav" key={item.id}>
          <button disabled={item.disabled} className={active === item.id ? 'active' : ''} aria-expanded={moreExpanded} onClick={() => { if (item.disabled) return; setMoreExpanded((value) => !value); onChange(item.id) }}><Icon name={item.icon} size={17}/><b>{item.label}</b><Icon name="chevron" size={14}/></button>
          {moreExpanded && <div className="module-submenu" role="menu" aria-label="更多工具列表">
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
          <button onClick={() => { onChangePassword(); setAccountExpanded(false); onClose() }}><Icon name="lock" size={16}/><span>修改密码</span><Icon name="chevron" size={14}/></button>
          <button onClick={() => { onOpenArchive(); setAccountExpanded(false); onClose() }}><Icon name="database" size={16}/><span>已归档对话</span><Icon name="chevron" size={14}/></button>
          <div className="theme-menu-row">
            <span className="theme-menu-label"><Icon name="sun" size={16}/><span>显示模式</span></span>
            <div className="theme-mode-options" role="group" aria-label="显示模式">
              <button type="button" aria-pressed={theme === 'light'} className={theme === 'light' ? 'active' : ''} onClick={() => onThemeChange('light')}>LIGHT</button>
              <button type="button" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'active' : ''} onClick={() => onThemeChange('dark')}>DARK</button>
            </div>
          </div>
          <button className="account-logout" onClick={onLogout}><Icon name="logout" size={16}/><span>退出登录</span><Icon name="chevron" size={14}/></button>
        </div>}
        {user ? <button className="account" onMouseEnter={keepAccountMenuOpen} onClick={() => { keepAccountMenuOpen(); setAccountExpanded((value) => !value) }}><span>{user.email.slice(0, 2).toUpperCase()}</span><b>{user.email.split('@')[0]}<small>积分 {user.credits ?? 50}</small></b></button> : <button className="guest-account" onClick={onLogin}><Icon name="lock" size={16}/><span>登录以使用 AI 功能</span></button>}
      </div>
    </aside>
  </>
}

const EMAIL_LOCAL_PATTERN = /^[^\s@]+$/
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,64}$/

function AuthScreen({ onAuthenticated, onClose, requiredModule = 'general' }) {
  const [mode, setMode] = useState('login')
  const [registerStep, setRegisterStep] = useState('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function updateEmailLocal(value) {
    const local = String(value || '').trim().toLowerCase().replace(/@onewo\.com$/i, '').replace(/@.*$/, '')
    setEmail(local)
  }

  function switchMode(next) {
    setMode(next); setRegisterStep('email'); setCode(''); setPassword(''); setConfirmPassword(''); setError(''); setNotice('')
  }

  async function submit(event) {
    event.preventDefault(); setError(''); setNotice('')
    const emailLocal = email.trim().toLowerCase()
    if (!EMAIL_LOCAL_PATTERN.test(emailLocal)) { setError('请输入企业邮箱账号'); return }
    const normalizedEmail = `${emailLocal}@onewo.com`
    setLoading(true)
    try {
      if (mode === 'login') {
        const result = await loginAccount({ email: normalizedEmail, password, remember })
        saveAuthToken(result.token, remember); onAuthenticated(result.user)
      } else if (registerStep === 'email') {
        const result = await requestRegisterCode(normalizedEmail)
        setRegisterStep('verify')
        setNotice(result.devCode ? `本地开发验证码：${result.devCode}` : `验证码已发送至 ${normalizedEmail}`)
      } else if (registerStep === 'verify') {
        if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位验证码')
        await verifyRegisterCode(normalizedEmail, code)
        setRegisterStep('password'); setNotice('邮箱验证完成，请设置登录密码')
      } else {
        if (!PASSWORD_PATTERN.test(password)) throw new Error('密码须为 8–64 位，且同时包含字母和数字')
        if (password !== confirmPassword) throw new Error('两次输入的密码不一致')
        const result = await registerAccount({ email: normalizedEmail, code, password, remember })
        saveAuthToken(result.token, remember); onAuthenticated(result.user)
      }
    } catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }

  const isRegister = mode === 'register'
  const moduleLabel = requiredModule === 'more-qr' ? '批处理二维码' : MODULES.find((item) => item.id === requiredModule)?.label || ''
  const prompt = moduleLabel ? `登录后才能使用“${moduleLabel}”。` : '登录后继续你的创作与对话。'
  return <div className="modal-scrim auth-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="auth-card auth-modal-card glass-strong">
    <button className="modal-close" onClick={onClose} aria-label="关闭"><Icon name="x"/></button>
  <div className="auth-brand"><span className="brand-avatar"><img className="mascot-frame mascot-open" src="/xiaodie-frame-open.png?v=3" alt="小蝶"/></span><div><b>小蝶</b><small>AI 办公小能手</small></div></div>
    <div className="auth-heading"><span>{isRegister ? 'CREATE ACCOUNT' : 'WELCOME BACK'}</span><h1>{isRegister ? '注册企业账号' : '登录后继续'}</h1><p>{isRegister ? '使用 onewo.com 企业邮箱注册' : prompt}</p></div>
    <div className="auth-tabs"><button type="button" className={!isRegister ? 'active' : ''} onClick={() => switchMode('login')}>登录</button><button type="button" className={isRegister ? 'active' : ''} onClick={() => switchMode('register')}>注册</button></div>
    {isRegister && <div className="auth-steps"><i className="done">1</i><span className={registerStep !== 'email' ? 'done' : ''}/><i className={registerStep !== 'email' ? 'done' : ''}>2</i><span className={registerStep === 'password' ? 'done' : ''}/><i className={registerStep === 'password' ? 'done' : ''}>3</i></div>}
    <form className="auth-form" onSubmit={submit}>
      {(mode === 'login' || registerStep === 'email') && <label><span>企业邮箱</span><div className="email-local-field"><Icon name="mail" size={17}/><input type="text" inputMode="email" autoComplete="username" value={email} onChange={(e) => updateEmailLocal(e.target.value)} placeholder="邮箱账号" disabled={loading}/><b>@onewo.com</b></div></label>}
      {isRegister && registerStep !== 'email' && <div className="auth-fixed-email"><Icon name="check" size={15}/><span>{email.trim().toLowerCase()}@onewo.com</span><button type="button" onClick={() => { setRegisterStep('email'); setCode(''); setNotice('') }}>修改</button></div>}
      {mode === 'login' && <label><span>密码</span><div><Icon name="lock" size={17}/><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" disabled={loading}/></div></label>}
      {isRegister && registerStep === 'verify' && <label><span>邮箱验证码</span><div><Icon name="shield" size={17}/><input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6 位验证码" disabled={loading}/></div></label>}
      {isRegister && registerStep === 'password' && <><label><span>设置密码</span><div><Icon name="lock" size={17}/><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8–64 位字母与数字" disabled={loading}/></div></label><label><span>确认密码</span><div><Icon name="lock" size={17}/><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入密码" disabled={loading}/></div></label><small className="password-hint">密码必须同时包含字母和数字，不支持空格及特殊符号</small></>}
      {(mode === 'login' || registerStep === 'password') && <label className="remember-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}/><span>记住登录状态，30 天内免登录</span></label>}
      {notice && <div className="auth-notice">{notice}</div>}{error && <div className="auth-error">{error}</div>}
      <button className="auth-submit" disabled={loading}>{loading ? '请稍候…' : mode === 'login' ? '登录' : registerStep === 'email' ? '发送验证码' : registerStep === 'verify' ? '验证邮箱' : '完成注册'}</button>
    </form>
  </section></div>
}

function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault(); setError('')
    if (!PASSWORD_PATTERN.test(newPassword)) { setError('新密码须为 8–64 位，且同时包含字母和数字'); return }
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return }
    setLoading(true)
    try { await changeAccountPassword({ currentPassword, newPassword }); window.alert('密码修改成功'); onClose() }
    catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }
  return <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section className="password-modal glass-strong"><button className="modal-close" onClick={onClose} aria-label="关闭"><Icon name="x"/></button><span className="modal-icon"><Icon name="lock" size={22}/></span><h2>修改密码</h2><p>新密码必须同时包含字母和数字</p><form className="auth-form" onSubmit={submit}><label><span>当前密码</span><div><Icon name="lock" size={16}/><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}/></div></label><label><span>新密码</span><div><Icon name="lock" size={16}/><input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="8–64 位字母与数字"/></div></label><label><span>确认新密码</span><div><Icon name="lock" size={16}/><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}/></div></label>{error && <div className="auth-error">{error}</div>}<button className="auth-submit" disabled={loading}>{loading ? '保存中…' : '保存新密码'}</button></form></section></div>
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
            const module = MODULES.find((item) => item.id === conversation.type)
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

function WelcomeArt() {
  return <div className="welcome-art" aria-hidden="true">
    <div className="art-card back"><span /><span /><span /></div>
    <div className="art-card front"><Icon name="image" size={34}/><i /><b /></div>
    <div className="art-spark one">✦</div><div className="art-spark two">✦</div>
  </div>
}

function ImageStudio({ conversation, onSave, imageMode, waterfallStorageKey, onUserUpdate, onRequireLogin }) {
  const conversationId = useRef(conversation?.id || crypto.randomUUID())
  const lastGeneratedImage = [...(conversation?.messages || [])].reverse().find((message) => message.role === 'assistant' && message.urls?.length)?.urls?.[0] || null
  const restoredEditImage = conversation && Object.hasOwn(conversation, 'editImage') ? conversation.editImage : lastGeneratedImage
  const [messages, setMessages] = useState(conversation?.messages || [])
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState(conversation?.ratio || 'auto')
  const [model, setModel] = useState(conversation?.imageModel || VIP_IMAGE_MODEL)
  const [resolution, setResolution] = useState(() => imageResolutionForModel(conversation?.imageModel || VIP_IMAGE_MODEL, conversation?.imageResolution))
  const [references, setReferences] = useState([])
  const [editImage, setEditImage] = useState(restoredEditImage)
  const [previewImage, setPreviewImage] = useState(null)
  const [loading, setLoading] = useState(conversation?.status === 'running')
  const [runningStartedAt, setRunningStartedAt] = useState(conversation?.runningStartedAt || null)
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
    setMessages(conversation.messages || [])
    setLoading(conversation.status === 'running')
    setRunningStartedAt(conversation.runningStartedAt || null)
    const nextModel = conversation.imageModel || VIP_IMAGE_MODEL
    setModel(nextModel)
    setResolution(imageResolutionForModel(nextModel, conversation.imageResolution))
    if (Object.hasOwn(conversation, 'editImage')) setEditImage(conversation.editImage)
  }, [conversation])

  useEffect(() => {
    const failedMessages = messages.filter(isFailureMessage)
    if (!failedMessages.length) return undefined
    const cleanUp = () => {
      const nextMessages = withoutFailureMessages(messages)
      if (nextMessages.length === messages.length) return
      setMessages(nextMessages)
      onSave({ id: conversationId.current, type: 'image', messages: nextMessages, ratio, imageModel: model, imageResolution: resolution, editImage, status: 'idle', runningStartedAt: null, unreadComplete: false })
    }
    const nextDeadline = Math.min(...failedMessages.map(failureDeadline))
    if (!nextDeadline || nextDeadline <= Date.now()) { cleanUp(); return undefined }
    const timer = window.setTimeout(cleanUp, nextDeadline - Date.now())
    return () => window.clearTimeout(timer)
  }, [editImage, messages, model, onSave, ratio, resolution])

  async function appendFiles(fileList) {
    const referenceLimit = editImage ? 3 : 4
    const files = Array.from(fileList || []).slice(0, referenceLimit - references.length)
    const valid = files.filter((file) => (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(file.name)) && file.size <= 8 * 1024 * 1024)
    if (files.length && !valid.length) {
      setError('没有识别到可上传的图片，请使用 PNG、JPG、WebP 等格式，单张不超过 8MB')
      return
    }
    try {
      const encoded = await Promise.all(valid.map(async (file) => ({ name: file.name, src: await fileToDataUrl(file) })))
      setReferences((current) => [...current, ...encoded].slice(0, referenceLimit))
      if (encoded.length) setError('')
      void Promise.allSettled(encoded.map(async (reference) => ({ source: reference.src, url: (await uploadGoogleDriveImage({ source: reference.src, name: reference.name })).url }))).then((results) => {
        const replacements = new Map(results.filter((result) => result.status === 'fulfilled').map((result) => [result.value.source, result.value.url]))
        if (replacements.size) setReferences((current) => current.map((reference) => replacements.has(reference.src) ? { ...reference, src: replacements.get(reference.src) } : reference))
      })
    } catch (error) { setError(error.message || '图片读取失败') }
  }

  async function addFiles(event) {
    await appendFiles(event.target.files)
    event.target.value = ''
  }

  async function submit(customPrompt) {
    const text = (customPrompt || prompt).trim()
    if (!text || loading) return
    const referenceSnapshot = references
    const editSnapshot = editImage
    const startedAt = new Date().toISOString()
    const userMessages = [...messages, { role: 'user', content: text, references: referenceSnapshot, editImage: editSnapshot }]
    setMessages(userMessages)
    scrollToLatestResult()
    onSave({ id: conversationId.current, type: 'image', messages: userMessages, ratio, imageModel: model, imageResolution: resolution, editImage: editSnapshot, status: 'running', runningStartedAt: startedAt, unreadComplete: false, activate: true })
    setPrompt(''); setReferences([]); setLoading(true); setRunningStartedAt(startedAt); setError('')
    const creditCost = imageCreditCost(model)
    onUserUpdate((current) => current ? { ...current, credits: Math.max(0, (current.credits ?? 50) - creditCost) } : current)
    try {
      const requestPrompt = editSnapshot
        ? `请基于提供的第一张图片继续编辑。保持用户没有要求改变的主体、构图、风格、光影与细节，只执行这项修改：${text}`
        : text
      const result = await generateImage({
        prompt: requestPrompt,
        images: [...new Set([editSnapshot, ...referenceSnapshot.map((item) => item.src)].filter(Boolean))],
        aspectRatio: ratio,
        model,
        resolution,
      })
      if (result.user) onUserUpdate(result.user)
      const nextEditImage = result.urls[0] || null
      const elapsedMs = Date.now() - new Date(startedAt).getTime()
      const completedMessages = [...userMessages, { role: 'assistant', urls: result.urls, elapsedMs, prompt: text }]
      setMessages(completedMessages)
      scrollToLatestResult()
      setEditImage(nextEditImage)
      onSave({ id: conversationId.current, type: 'image', messages: completedMessages, ratio, imageModel: model, imageResolution: resolution, editImage: nextEditImage, status: 'idle', runningStartedAt: null, unreadComplete: true })
    } catch (err) {
      try {
        const { user: refreshedUser } = await getCurrentAccount()
        onUserUpdate(refreshedUser)
      } catch {
        onUserUpdate((current) => current ? { ...current, credits: (current.credits ?? 50) + creditCost } : current)
      }
      setError(err.message)
      const failedMessages = [...userMessages, { role: 'error', content: err.message, elapsedMs: Date.now() - new Date(startedAt).getTime(), failedAt: new Date().toISOString() }]
      setMessages(failedMessages)
      scrollToLatestResult()
      onSave({ id: conversationId.current, type: 'image', messages: failedMessages, ratio, imageModel: model, imageResolution: resolution, editImage: editSnapshot, status: 'idle', runningStartedAt: null, unreadComplete: false })
    } finally { setLoading(false); setRunningStartedAt(null) }
  }

  const empty = messages.length === 0
  return <>
    {imageMode === 'waterfall' ? <WaterfallStudio storageKey={waterfallStorageKey} onUserUpdate={onUserUpdate} onRequireLogin={onRequireLogin}/> : <section className={`workspace with-image-mode ${empty ? 'empty' : ''}`}>
    <div className="conversation" ref={conversationScrollRef}>
      {empty ? <div className="welcome">
        <WelcomeArt />
        <div className="eyebrow">GPT-IMAGE-2</div>
        <h1>把脑海里的画面，<em>带到眼前。</em></h1>
        <p>描述你的想法，或上传参考图片。你可以像聊天一样不断调整，直到它真正符合你的想象。</p>
      </div> : <div className="message-list">
        {messages.map((message, index) => <ImageMessage key={index} message={message} focusRef={!loading && index === messages.length - 1 ? focusRef : null} onPreview={setPreviewImage}/>) }
        {loading && <div ref={focusRef}><LiveTaskStatus startedAt={runningStartedAt}/></div>}
        <div className="conversation-tail-space" aria-hidden="true"/>
      </div>}
    </div>
    <ImageComposer prompt={prompt} setPrompt={setPrompt} ratio={ratio} setRatio={setRatio} model={model} setModel={setModel} resolution={resolution} setResolution={setResolution} references={references} setReferences={setReferences} editImage={editImage} fileRef={fileRef} addFiles={addFiles} appendFiles={appendFiles} submit={submit} loading={loading} error={error} onPreview={setPreviewImage}/>
    {previewImage && <ImagePreview url={previewImage.url || previewImage} urls={previewImage.urls} prompt={previewImage.prompt} onClose={() => setPreviewImage(null)}/>} 
    </section>}
  </>
}

function WaterfallStudio({ storageKey, onUserUpdate, onRequireLogin }) {
  const dismissedFailureTaskIds = useRef(new Set())
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
  const [visibleLimit, setVisibleLimit] = useState(20)
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('auto')
  const [model, setModel] = useState(VIP_IMAGE_MODEL)
  const [resolution, setResolution] = useState('2k')
  const [count, setCount] = useState(2)
  const [references, setReferences] = useState([])
  const [ratioOpen, setRatioOpen] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [previewImage, setPreviewImage] = useState(null)
  const [expandedReferenceTaskIds, setExpandedReferenceTaskIds] = useState(() => new Set())
  const [refreshToken, setRefreshToken] = useState(0)
  const fileRef = useRef(null)
  const promptRef = useRef(null)
  const ratioPickerRef = useRef(null)
  const dragDepth = useRef(0)
  const scrolledAway = useRef(false)
  const resultsRef = useRef(null)
  const historyHeight = useRef(0)
  const sessionReferenceImages = useRef(new Map())
  const tasksRef = useRef(tasks)
  const openAtLatest = useRef(true)
  const followLatestTask = useRef(false)

  useEffect(() => {
    tasksRef.current = tasks
    try { localStorage.setItem(storageKey, JSON.stringify(compactWaterfallCache(tasks))) } catch { /* Keep in-memory history if local storage is full. */ }
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
          if (dismissedFailureTaskIds.current.has(task.id)) return false
          if (!isInitialTaskLoad.current || !isFailedWaterfallTask(task)) return true
          dismissedFailureTaskIds.current.add(task.id)
          return false
        })
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
              return oldSlot && slot.status === oldSlot.status && slot.url === oldSlot.url && slot.error === oldSlot.error
            })
          })
          return unchanged ? current : merged
        })
        isInitialTaskLoad.current = false
        setTotal(result.total || 0)
        // A waterfall task is asynchronous, so the result endpoint is the
        // source of truth.  Check active work frequently so a completed
        // upstream image replaces its loading card without a noticeable wait.
        if (active && (result.tasks || []).some((task) => task.status === 'running')) timer = window.setTimeout(refresh, 1_000)
      } catch (err) {
        if (!active) return
        // History refresh is retried on the next entry/poll.  Do not surface a
        // generic transport message such as “Load failed” in the composer.
        console.warn('瀑布流历史刷新失败', err)
    } finally {
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
    const failedTasks = tasks.filter(isFailedWaterfallTask)
    if (!failedTasks.length) return undefined
    const nextDeadline = Math.min(...failedTasks.map(failureTaskDeadline))
    const cleanUp = () => {
      const now = Date.now()
      setTasks((current) => current.filter((task) => {
        if (!isFailedWaterfallTask(task)) return true
        const deadline = failureTaskDeadline(task)
        if (deadline && deadline > now) return true
        dismissedFailureTaskIds.current.add(task.id)
        return false
      }))
    }
    if (!nextDeadline || nextDeadline <= Date.now()) { cleanUp(); return undefined }
    const timer = window.setTimeout(cleanUp, nextDeadline - Date.now())
    return () => window.clearTimeout(timer)
  }, [tasks])

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
    const close = (event) => { if (!ratioPickerRef.current?.contains(event.target)) setRatioOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

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
    const files = Array.from(fileList || []).slice(0, 9 - references.length)
    const valid = files.filter((file) => (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif|avif)$/i.test(file.name)) && file.size <= 8 * 1024 * 1024)
    if (files.length && !valid.length) return setError('请选择单张不超过 8MB 的图片文件')
    try {
      const encoded = await Promise.all(valid.map(async (file) => ({ name: file.name, src: await fileToDataUrl(file) })))
      setReferences((current) => [...current, ...encoded].slice(0, 9))
      if (encoded.length) setError('')
      void Promise.allSettled(encoded.map(async (reference) => ({ source: reference.src, url: (await uploadGoogleDriveImage({ source: reference.src, name: reference.name })).url }))).then((results) => {
        const replacements = new Map(results.filter((result) => result.status === 'fulfilled').map((result) => [result.value.source, result.value.url]))
        if (replacements.size) setReferences((current) => current.map((reference) => replacements.has(reference.src) ? { ...reference, src: replacements.get(reference.src) } : reference))
      })
    } catch (error) { setError(error.message || '图片读取失败') }
  }

  function appendGeneratedReference(source) {
    if (!source) return
    setReferences((current) => current.some((item) => item.src === source) ? current : [...current, { name: '已生成图片', src: source }].slice(0, 9))
    setError('')
  }

  async function submitTask() {
    if (!prompt.trim() || submitting) return
    if (!getAuthToken()) { onRequireLogin(); return }
    const referenceSnapshot = references.map((item) => item.src)
    const clientRequestId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const request = { prompt: prompt.trim(), images: referenceSnapshot, aspectRatio: ratio, count, model, resolution, clientRequestId }
    const resolvedAspectRatio = ratio === 'auto' ? await automaticReferenceAspect(referenceSnapshot[0], request.prompt) : ratio
    const optimisticTask = createOptimisticWaterfallTask({ ...request, resolvedAspectRatio })
    setSubmitting(true); setError(''); setInitialLoading(false)
    setTasks((current) => [...current, optimisticTask])
    scrollToLatestTask()
    setPrompt(''); setReferences([])
    try {
      const result = await createWaterfallTask(request)
      if (result.user) onUserUpdate(result.user)
      if (referenceSnapshot.length) sessionReferenceImages.current.set(result.task.id, referenceSnapshot)
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
      setTasks((current) => current.filter((item) => item.id !== optimisticTask.id))
      setPrompt((current) => current || request.prompt)
      setReferences((current) => current.length ? current : referenceSnapshot.map((src, index) => ({ name: `参考图 ${index + 1}`, src })))
      setError(err.message)
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
      setError(err.message)
    }
  }

  function editTask(task) {
    setPrompt(task.prompt || '')
    setRatio(task.aspectRatio || 'auto')
    const nextModel = task.model || VIP_IMAGE_MODEL
    setModel(nextModel)
    setResolution(imageResolutionForModel(nextModel, task.resolution))
    setCount(task.count || 2)
    setReferences((task.referenceImages || []).map((src, index) => ({ name: `参考图 ${index + 1}`, src })))
    setError('')
    window.requestAnimationFrame(() => promptRef.current?.focus())
  }

  function generateAgain(task) {
    if (!getAuthToken()) { onRequireLogin(); return }
    const request = {
      prompt: task.prompt,
      images: (task.referenceImages || []).map(waterfallReferenceForRequest),
      aspectRatio: task.aspectRatio || 'auto',
      count: task.count || 2,
      model: task.model || VIP_IMAGE_MODEL,
      resolution: imageResolutionForModel(task.model || VIP_IMAGE_MODEL, task.resolution),
    }
    const optimisticTask = createOptimisticWaterfallTask({ ...request, resolvedAspectRatio: task.resolvedAspectRatio })
    setError(''); setInitialLoading(false)
    setTasks((current) => [...current, optimisticTask])
    scrollToLatestTask()
    // Submitting is deliberately detached from this button.  The new task is
    // already visible and the user may immediately submit another one.
    void createWaterfallTask({ ...request, clientRequestId: optimisticTask.id }).then((result) => {
      if (result.user) onUserUpdate(result.user)
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
      setTasks((current) => current.filter((item) => item.id !== optimisticTask.id))
      setError(`再次生成失败：${err.message || '请求未完成，请稍后重试'}`)
    })
  }

  function shapeStyle(value) {
    if (value === 'auto') return undefined
    const [width, height] = value.split(':').map(Number)
    const scale = 21 / Math.max(width, height)
    return { width: Math.max(8, width * scale), height: Math.max(8, height * scale) }
  }

  function handleScroll(event) {
    const top = event.currentTarget.scrollTop
    if (top > 100) scrolledAway.current = true
    if (top < 24 && scrolledAway.current && tasks.length < total) {
      scrolledAway.current = false
      historyHeight.current = event.currentTarget.scrollHeight
      setVisibleLimit((current) => Math.min(current + 20, total))
    }
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
      {initialLoading ? <div className="waterfall-initial-loading" aria-label="加载任务"><i/><i/><i/></div> : tasks.filter((task) => task.status === 'running' || task.status === 'cancelled' || (task.slots || []).some((slot) => slot.status === 'succeeded')).length === 0 ? <div className="waterfall-empty"><b>开始你的第一组创作</b><span>一次生成多张图片，也可以连续提交多个任务。</span></div> : <div className="waterfall-task-list">
        {tasks.filter((task) => task.status === 'running' || task.status === 'cancelled' || (task.slots || []).some((slot) => slot.status === 'succeeded')).map((task) => {
          const referenceImages = task.referenceImages || []
          const referencesExpanded = expandedReferenceTaskIds.has(task.id)
          const visibleSlots = (task.slots || []).filter((slot) => slot.status === 'running' || slot.status === 'succeeded')
          const displayedCount = task.status === 'running' ? task.count : visibleSlots.filter((slot) => slot.status === 'succeeded').length
          const referenceThumbnails = referenceImages.map(waterfallThumbnailUrl)
          return <article className="waterfall-task" key={task.id}>
          <header><div className="waterfall-task-leading">{referenceImages.length > 0 && <div className="waterfall-reference-summary"><button type="button" onClick={() => toggleTaskReferences(task.id)} aria-expanded={referencesExpanded} aria-label={`${referencesExpanded ? '收起' : '展开'}参考图`} title={`${referencesExpanded ? '收起' : '展开'}参考图`}><span className="waterfall-reference-stack" aria-hidden="true">{referenceThumbnails.slice(0, 3).map((url, index) => <img src={url} alt="" loading="lazy" decoding="async" key={`${url}-${index}`}/>)}</span></button>{referencesExpanded && <div className="waterfall-reference-list">{referenceImages.map((url, index) => <button type="button" key={`${url}-${index}`} onClick={() => setPreviewImage({ url, prompt: task.prompt })} aria-label={`预览参考图 ${index + 1}`}><img src={referenceThumbnails[index]} alt={`参考图 ${index + 1}`} loading="lazy" decoding="async"/></button>)}</div>}</div>}<div className="waterfall-task-info"><div className="waterfall-prompt-line"><b>{task.prompt}</b><button type="button" aria-label="复制提示词" title="复制提示词" onClick={() => navigator.clipboard.writeText(task.prompt)}><Icon name="copy" size={14}/></button></div><small>{new Date(task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {task.aspectRatio === 'auto' ? `自动 · ${task.resolvedAspectRatio || '1:1'}` : task.aspectRatio} · {displayedCount} 张</small></div></div>{task.status === 'running' ? !task.optimistic && <div className="waterfall-task-actions"><button type="button" onClick={() => editTask(task)}>编辑</button><button className="stop" type="button" onClick={() => stopTask(task.id)}>停止</button></div> : <div className="waterfall-task-actions">{task.status === 'cancelled' && <span className="waterfall-task-status cancelled">已取消任务</span>}<button type="button" onClick={() => editTask(task)}>重新编辑</button><button type="button" onClick={() => generateAgain(task)}>再次生成</button></div>}</header>
          {visibleSlots.length > 0 && <div className={`waterfall-grid count-${visibleSlots.length}`}>{visibleSlots.map((slot) => <div className={`waterfall-slot ${slot.status} ${task.aspectRatio === 'auto' ? 'auto-ratio' : ''}`} style={{ aspectRatio: (task.resolvedAspectRatio || (task.aspectRatio === 'auto' ? '1:1' : task.aspectRatio)).replace(':', ' / ') }} key={slot.index}>
            {slot.status === 'succeeded' && slot.url ? <><button type="button" onClick={() => setPreviewImage({ url: slot.url, urls: visibleSlots.filter((item) => item.status === 'succeeded' && item.url).map((item) => item.url), prompt: task.prompt })}><img src={waterfallThumbnailUrl(slot.url)} alt={`${task.prompt} ${slot.index + 1}`} loading="lazy" decoding="async" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(GENERATED_IMAGE_DRAG_TYPE, slot.url); event.dataTransfer.setData('text/uri-list', slot.url) }}/></button><button className="waterfall-download" type="button" onClick={() => void downloadGeneratedImage(slot.url, task.prompt)} title="下载图片" aria-label="下载图片"><Icon name="download" size={15}/></button></> : <div className="bubble-loader" aria-label="生成中"><i/><i/><i/></div>}
          </div>)}</div>}
        </article>})}
      </div>}
    </div>
    <div className="waterfall-composer-wrap">
      <div className={`composer waterfall-composer glass-strong ${draggingFiles ? 'is-dragging-files' : ''}`} onDragEnter={(event) => { if (hasSupportedDrag(event.dataTransfer)) { event.preventDefault(); dragDepth.current += 1; setDraggingFiles(true) } }} onDragOver={(event) => { if (hasSupportedDrag(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDraggingFiles(false) }} onDrop={handleDrop}>
        {draggingFiles && <div className="image-drop-zone" aria-hidden="true"><b>松开以上传参考图</b><small>最多 9 张</small></div>}
        {references.length > 0 && <div className="reference-strip">{references.map((item, index) => <div key={item.name + index}><button type="button" className="reference-preview" onClick={() => setPreviewImage(waterfallThumbnailUrl(item.src))}><img src={waterfallThumbnailUrl(item.src)} alt={item.name}/></button><button type="button" className="reference-remove" onClick={() => setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Icon name="x" size={13}/></button></div>)}</div>}
        <textarea ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitTask() } }} placeholder="描述这一组图片…" rows="2"/>
        <div className="composer-tools"><div className="tool-group">
          <button className="tool-button reference-add" type="button" onClick={() => fileRef.current?.click()} disabled={references.length >= 9}><Icon name="plus" size={18}/></button><input ref={fileRef} type="file" hidden multiple accept="image/*" onChange={async (event) => { await appendReferences(event.target.files); event.target.value = '' }}/>
          <div className="ratio-picker" ref={ratioPickerRef}><button className="ratio-trigger" type="button" onClick={() => setRatioOpen((open) => !open)}><span>比例</span><b>{RATIO_OPTIONS.find((item) => item.value === ratio)?.label}</b><Icon name="chevron" size={14}/></button>{ratioOpen && <div className="ratio-menu glass-strong"><div className="ratio-menu-title">比例</div><div className="ratio-grid">{RATIO_OPTIONS.map((item) => <button key={item.value} className={ratio === item.value ? 'active' : ''} onClick={() => { setRatio(item.value); setRatioOpen(false) }}><span className={`ratio-shape ${item.value === 'auto' ? 'auto' : ''}`} style={shapeStyle(item.value)}/><b>{item.label}</b></button>)}</div></div>}</div>
          <select className="image-model-select" aria-label="生图模型" value={model} onChange={(event) => { const nextModel = event.target.value; setModel(nextModel); setResolution(nextModel === VIP_IMAGE_MODEL ? '2k' : '1k') }}>{IMAGE_MODEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <select className="image-model-select image-resolution-select" aria-label="生图清晰度" value={resolution} disabled={model !== VIP_IMAGE_MODEL} onChange={(event) => setResolution(event.target.value)}>{VIP_IMAGE_RESOLUTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <div className="count-picker"><span>数量</span>{[1,2,3,4].map((value) => <button type="button" className={count === value ? 'active' : ''} onClick={() => setCount(value)} key={value}>{value}</button>)}</div>
        </div><div className="generation-submit"><span className="generation-credit-cost">消耗 <b>{imageCreditCost(model, count)}</b> 分</span><button className="send-button" type="button" aria-label={submitting ? '提交中' : `生成，消耗 ${imageCreditCost(model, count)} 积分`} onClick={submitTask} disabled={!prompt.trim() || submitting}><Icon name="arrowUp" size={18}/></button></div></div>
      </div>
      {error && <small className="composer-note error">{error}{error.includes('Google Drive 授权已失效') && <button className="drive-reconnect" type="button" onClick={() => { void reconnectGoogleDrive().catch((err) => setError(err.message || '无法打开 Google Drive 授权页面')) }}>重新连接 Google Drive</button>}</small>}
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
    <MessageCopyButton content={message.urls.join('\n')}/>
  </div>
}

function TextUserMessage({ message, messageRef, onPreview }) {
  const imageAttachments = (message.attachments || []).filter((file) => file.kind === 'image' && file.src)
  const textAttachments = (message.attachments || []).filter((file) => file.kind !== 'image')
  return <div ref={messageRef} className="user-message">
    {imageAttachments.length > 0 && <div className="message-refs">{imageAttachments.map((file, index) => <button type="button" onClick={() => onPreview(file.src)} aria-label={`预览上传图片 ${index + 1}`} key={file.name + index}><img src={file.src} alt={file.name}/></button>)}</div>}
    {textAttachments.length > 0 && <div className="text-attachment-list">{textAttachments.map((file, index) => <span key={file.name + index}><Icon name="book" size={14}/>{file.name}</span>)}</div>}
    <div className="user-message-content">{message.content}</div>
    <MessageCopyButton content={message.content}/>
  </div>
}

const COMPLIANCE_SECTION_TITLES = new Set(['摘要', '问题清单', '人工核验项', '通过项'])
const COMPLIANCE_FIELD_LABELS = ['触发原文/画面位置', '问题原因', '规则依据', '可直接替换/补充建议', '可直接替换建议', '修改建议']

function cleanComplianceLine(line) {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/^>\s?/, '')
    .trim()
}

function ComplianceReport({ content }) {
  const lines = String(content || '').split(/\r?\n/).map(cleanComplianceLine).filter(Boolean)
  const conclusionIndex = lines.findIndex((line) => /审核结论\s*[：:]/.test(line))
  const scoreIndex = lines.findIndex((line) => /(?:合规)?得分\s*[：:]/.test(line))
  const conclusionMatch = conclusionIndex >= 0 ? lines[conclusionIndex].match(/审核结论\s*[：:]\s*([^。；]+)/) : null
  const scoreMatch = scoreIndex >= 0 ? lines[scoreIndex].match(/(?:合规)?得分\s*[：:]\s*([^。；，]+)/) : null
  const conclusion = conclusionMatch?.[1]?.trim() || '审核完成'
  const score = scoreMatch?.[1]?.trim() || null
  const blocked = conclusion.includes('禁止发布') || lines.some((line) => /^严重度\s*[：:]\s*S1\b/i.test(line) || /^\d+[.、]\s*严重度\s*[：:]\s*S1\b/i.test(line))
  const displayScore = blocked ? '0 分' : score
  const bodyLines = lines.filter((line, index) => index !== conclusionIndex && index !== scoreIndex && !/^(我先|我会先|下面先)/.test(line) && !/^(以上|本结果|本审核).*(仅供参考|不替代|专业人士|律师意见)/.test(line))

  return <div className="compliance-report">
    <div className={`report-overview ${blocked ? 'blocked' : ''}`}>
      <div className="report-conclusion"><span>审核结论</span><strong>{blocked ? '禁止发布' : conclusion}</strong></div>
      {displayScore && <div className="report-score"><span>合规得分</span><strong>{displayScore}</strong></div>}
    </div>
    <div className="report-body">{bodyLines.map((line, index) => {
      if (COMPLIANCE_SECTION_TITLES.has(line)) return <h3 key={index}>{line}</h3>
      const numbered = line.match(/^(\d+)[.、]\s*(.*)$/)
      if (numbered) {
        const severity = numbered[2].match(/^严重度\s*[：:]\s*(.+)$/)
        return <div className="report-numbered" key={index}><span className="report-index">{numbered[1]}</span>{severity ? <span className={`severity-badge ${severity[1].toLowerCase()}`}>{severity[1]}</span> : <p>{numbered[2]}</p>}</div>
      }
      const severity = line.match(/^严重度\s*[：:]\s*(.+)$/)
      if (severity) return <div className="report-severity" key={index}><span>风险等级</span><b className={`severity-badge ${severity[1].toLowerCase()}`}>{severity[1]}</b></div>
      const field = COMPLIANCE_FIELD_LABELS.find((label) => line.startsWith(`${label}：`) || line.startsWith(`${label}:`))
      if (field) return <div className="report-field" key={index}><b>{field}</b><p>{line.slice(field.length + 1).trim()}</p></div>
      if (/^[-•]\s+/.test(line)) return <div className="report-pass" key={index}><i/> <span>{line.replace(/^[-•]\s+/, '')}</span></div>
      return <p className="report-paragraph" key={index}>{line}</p>
    })}</div>
  </div>
}

function ImageComposer({ prompt, setPrompt, ratio, setRatio, model, setModel, resolution, setResolution, references, setReferences, editImage, fileRef, addFiles, appendFiles, submit, loading, error, onPreview }) {
  const [ratioOpen, setRatioOpen] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const ratioPickerRef = useRef(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (!ratioPickerRef.current?.contains(event.target)) setRatioOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [])

  function shapeStyle(value) {
    if (value === 'auto') return undefined
    const [width, height] = value.split(':').map(Number)
    const scale = 21 / Math.max(width, height)
    return { width: Math.max(8, width * scale), height: Math.max(8, height * scale) }
  }

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
      const referenceLimit = editImage ? 3 : 4
      setReferences((current) => current.some((item) => item.src === generatedImage) ? current : [...current, { name: '已生成图片', src: generatedImage }].slice(0, referenceLimit))
      return
    }
    await appendFiles(droppedFiles(event.dataTransfer))
  }

  return <div className="composer-wrap">
    <div className={`composer glass-strong ${draggingFiles ? 'is-dragging-files' : ''}`} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {draggingFiles && <div className="image-drop-zone" aria-hidden="true"><span><Icon name="plus" size={16}/></span><b>松开以上传图片</b><small>支持多张</small></div>}
      {references.length > 0 && <div className="reference-strip">{references.map((item, index) => <div key={item.name + index}><button type="button" className="reference-preview" onClick={() => onPreview(item.src)} aria-label={`预览参考图 ${index + 1}`}><img src={item.src} alt={item.name}/></button><button type="button" className="reference-remove" onClick={() => setReferences((current) => current.filter((_, i) => i !== index))} aria-label={`移除参考图 ${index + 1}`}><Icon name="x" size={13}/></button></div>)}</div>}
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} placeholder="描述你想生成的画面…" rows="2" />
      <div className="composer-tools">
        <div className="tool-group">
          <button className="tool-button reference-add" title="添加参考图" aria-label="添加参考图" onClick={() => fileRef.current?.click()} disabled={references.length >= (editImage ? 3 : 4)}><Icon name="plus" size={18}/></button>
          <input ref={fileRef} type="file" hidden accept="image/*" multiple onChange={addFiles}/>
          <div className="ratio-picker" ref={ratioPickerRef}>
            <button className="ratio-trigger" type="button" aria-haspopup="menu" aria-expanded={ratioOpen} onClick={() => setRatioOpen((open) => !open)}><span>比例</span><b>{RATIO_OPTIONS.find((item) => item.value === ratio)?.label || ratio}</b><Icon name="chevron" size={14}/></button>
            {ratioOpen && <div className="ratio-menu glass-strong" role="menu" aria-label="选择图片比例">
              <div className="ratio-menu-title">比例</div>
              <div className="ratio-grid">{RATIO_OPTIONS.map((item) => <button key={item.value} type="button" role="menuitem" className={ratio === item.value ? 'active' : ''} onClick={() => { setRatio(item.value); setRatioOpen(false) }}>
                <span className={`ratio-shape ${item.value === 'auto' ? 'auto' : ''}`} style={shapeStyle(item.value)}/>
                <b>{item.label}</b>
              </button>)}</div>
            </div>}
          </div>
          <select className="image-model-select" aria-label="生图模型" value={model} onChange={(event) => { const nextModel = event.target.value; setModel(nextModel); setResolution(nextModel === VIP_IMAGE_MODEL ? '2k' : '1k') }}>{IMAGE_MODEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <select className="image-model-select image-resolution-select" aria-label="生图清晰度" value={resolution} disabled={model !== VIP_IMAGE_MODEL} onChange={(event) => setResolution(event.target.value)}>{VIP_IMAGE_RESOLUTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
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
  const [messages, setMessages] = useState(conversation?.messages || [])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState([])
  const [attachmentError, setAttachmentError] = useState('')
  const [brand, setBrand] = useState(conversation?.brand || 'general')
  const webSearch = type === 'strategy'
  const [brandOpen, setBrandOpen] = useState(false)
  const [draggingComplianceFiles, setDraggingComplianceFiles] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [loading, setLoading] = useState(conversation?.status === 'running')
  const [runningStartedAt, setRunningStartedAt] = useState(conversation?.runningStartedAt || null)
  const complianceFileRef = useRef(null)
  const brandPickerRef = useRef(null)
  const complianceDragDepth = useRef(0)
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
    setMessages(conversation.messages || [])
    setLoading(conversation.status === 'running')
    setRunningStartedAt(conversation.runningStartedAt || null)
    if (conversation.brand) setBrand(conversation.brand)
  }, [conversation])

  useEffect(() => {
    const failedMessages = messages.filter(isFailureMessage)
    if (!failedMessages.length) return undefined
    const cleanUp = () => {
      const nextMessages = withoutFailureMessages(messages)
      if (nextMessages.length === messages.length) return
      setMessages(nextMessages)
      onSave({ id: conversationId.current, type, messages: nextMessages, brand, webSearch, status: 'idle', runningStartedAt: null, unreadComplete: false })
    }
    const nextDeadline = Math.min(...failedMessages.map(failureDeadline))
    if (!nextDeadline || nextDeadline <= Date.now()) { cleanUp(); return undefined }
    const timer = window.setTimeout(cleanUp, nextDeadline - Date.now())
    return () => window.clearTimeout(timer)
  }, [brand, messages, onSave, type, webSearch])

  useEffect(() => {
    const closeBrandMenu = (event) => {
      if (!brandPickerRef.current?.contains(event.target)) setBrandOpen(false)
    }
    document.addEventListener('pointerdown', closeBrandMenu)
    return () => document.removeEventListener('pointerdown', closeBrandMenu)
  }, [])

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
    } catch (error) { setAttachmentError(error.message || '文件解析失败') }
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
    const attachmentSnapshot = attachments
    const content = (customInput || input).trim() || (attachmentSnapshot.length ? '请审核我上传的文件。' : '')
    if (!content || loading) return
    const startedAt = new Date().toISOString()
    const nextMessages = [...messages, { role: 'user', content, ...(type === 'compliance' && attachmentSnapshot.length ? { attachments: attachmentSnapshot } : {}) }]
    setMessages(nextMessages); setInput(''); setAttachments([]); setLoading(true); setRunningStartedAt(startedAt)
    scrollToLatestResult()
    onSave({ id: conversationId.current, type, messages: nextMessages, brand, webSearch, status: 'running', runningStartedAt: startedAt, unreadComplete: false, activate: true })
    try {
      const requestMessages = nextMessages.filter((item) => item.role !== 'error').map((item) => {
        if (item.role !== 'user' || !item.attachments?.length) return { role: item.role, content: item.content }
        const textFiles = item.attachments.filter((file) => file.kind === 'text')
        const imageFiles = item.attachments.filter((file) => file.kind === 'image' && file.src)
        const imageInstruction = imageFiles.length ? `\n\n当前消息附带 ${imageFiles.length} 张待审核图片。你必须直接查看图片中的文字、Logo、排版和可见内容并完成审核，不得要求用户再次提供图片或图片文字。` : ''
        const text = [item.content, imageInstruction, ...textFiles.map((file) => `\n\n--- 文件：${file.name} ---\n${file.content}`)].join('')
        return { role: 'user', content: [{ type: 'text', text }, ...imageFiles.map((file) => ({ type: 'image_url', image_url: { url: file.src, detail: 'high' } }))] }
      })
      const systemPrompt = type === 'compliance' ? buildComplianceSystemPrompt(brand, copy.systemPrompt) : copy.systemPrompt
      const result = await generateText({ messages: requestMessages, systemPrompt, webSearch, searchQuery: content })
      const completedMessages = [...nextMessages, { role: 'assistant', content: result.content, sources: result.sources || [], elapsedMs: Date.now() - new Date(startedAt).getTime() }]
      setMessages(completedMessages)
      scrollToLatestResult()
      onSave({ id: conversationId.current, type, messages: completedMessages, brand, webSearch, status: 'idle', runningStartedAt: null, unreadComplete: true })
    } catch (err) {
      const failedMessages = [...nextMessages, { role: 'error', content: err.message, elapsedMs: Date.now() - new Date(startedAt).getTime(), failedAt: new Date().toISOString() }]
      setMessages(failedMessages)
      scrollToLatestResult()
      onSave({ id: conversationId.current, type, messages: failedMessages, brand, webSearch, status: 'idle', runningStartedAt: null, unreadComplete: false })
    } finally { setLoading(false); setRunningStartedAt(null) }
  }

  return <section className={`workspace text-workspace ${messages.length === 0 ? 'empty' : ''}`} onDragEnter={handleComplianceDragEnter} onDragOver={handleComplianceDragOver} onDragLeave={handleComplianceDragLeave} onDrop={handleComplianceDrop}>
    <div className="conversation" ref={conversationScrollRef}>
      {messages.length === 0 ? <div className="welcome text-welcome">
        <div className={`text-orb ${type}`}><Icon name={type === 'strategy' ? 'spark' : 'shield'} size={38}/></div>
        <div className="eyebrow">{copy.eyebrow}</div><h1>{copy.title}</h1><p>{copy.subtitle}</p>
      </div> : <div className="message-list text-list">{messages.map((message, index) => {
        const messageRef = !loading && index === messages.length - 1 ? focusRef : null
        return message.role === 'user' ? <TextUserMessage message={message} messageRef={messageRef} onPreview={setPreviewImage} key={index}/> : message.role === 'error' ? <div ref={messageRef} className="error-message" key={index}><span><b>请求失败{message.elapsedMs != null ? ` · 耗时 ${formatElapsed(message.elapsedMs)}` : ''}</b>{message.content}</span></div> : <div ref={messageRef} className="assistant-turn text-answer has-copy-control" key={index}>{message.elapsedMs != null && <div className="task-elapsed">耗时 {formatElapsed(message.elapsedMs)}</div>}{type === 'compliance' ? <ComplianceReport content={message.content}/> : <AnswerText content={message.content}/>}<TextSources sources={message.sources}/><MessageCopyButton content={message.content} label={type !== 'compliance'}/></div>
      })}
        {loading && <div ref={focusRef}><LiveTaskStatus startedAt={runningStartedAt}/></div>}
        <div className="conversation-tail-space" aria-hidden="true"/>
      </div>}
    </div>
    <div className="composer-wrap text-composer-wrap"><div className={`composer glass-strong ${draggingComplianceFiles ? 'is-dragging-files' : ''}`}>
      {type === 'compliance' && draggingComplianceFiles && <div className="image-drop-zone" aria-hidden="true"><span><Icon name="plus" size={16}/></span><b>松开以上传图片</b><small>支持多张</small></div>}
      {type === 'compliance' && attachments.some((file) => file.kind === 'image' && file.src) && <div className="reference-strip">{attachments.filter((file) => file.kind === 'image' && file.src).map((file, index) => <div key={file.name + index}><button type="button" className="reference-preview" onClick={() => setPreviewImage(file.src)} aria-label={`预览上传图片 ${index + 1}`}><img src={file.src} alt={file.name}/></button><button type="button" className="reference-remove" onClick={() => setAttachments((current) => current.filter((item) => item !== file))} aria-label={`移除图片 ${index + 1}`}><Icon name="x" size={13}/></button></div>)}</div>}
      {type === 'compliance' && attachments.some((file) => file.kind !== 'image') && <div className="compliance-file-strip">{attachments.filter((file) => file.kind !== 'image').map((file, index) => <span key={file.name + index}><Icon name="book" size={14}/><b>{file.name}</b><button type="button" onClick={() => setAttachments((current) => current.filter((item) => item !== file))} aria-label={`移除文件 ${index + 1}`}><Icon name="x" size={12}/></button></span>)}</div>}
      <textarea rows="3" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} placeholder={copy.placeholder}/><div className="composer-tools">
        {type === 'compliance' ? <div className="tool-group">
          <button className="tool-button reference-add" type="button" title="上传文件" aria-label="上传文件" onClick={() => complianceFileRef.current?.click()} disabled={attachments.length >= 4}><Icon name="plus" size={18}/></button>
          <input ref={complianceFileRef} type="file" hidden multiple accept="image/*,.txt,.md,.csv,.json,.html,.xml,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/*" onChange={addComplianceFiles}/>
          <div className="brand-picker" ref={brandPickerRef}>
            <button className="brand-trigger" type="button" aria-haspopup="menu" aria-expanded={brandOpen} onClick={() => setBrandOpen((open) => !open)}><span>品牌</span><b>{COMPLIANCE_BRANDS.find((item) => item.value === brand)?.label || '通用合规'}</b><Icon name="chevron" size={14}/></button>
            {brandOpen && <div className="brand-menu glass-strong" role="menu" aria-label="选择审核品牌"><div className="brand-menu-title">选择品牌</div><div className="brand-grid">{COMPLIANCE_BRANDS.map((item) => <button key={item.value} type="button" role="menuitem" className={brand === item.value ? 'active' : ''} onClick={() => { setBrand(item.value); setBrandOpen(false) }}><b>{item.label}</b></button>)}</div></div>}
          </div>
        </div> : <div className="text-tools"><span className="model-chip">GPT-5.6 Terra</span></div>}
        <button className="send-button" onClick={() => submit()} disabled={(!input.trim() && attachments.length === 0) || loading}><Icon name="arrowUp" size={18}/></button>
      </div></div>{attachmentError && <small className="composer-note error">{attachmentError}</small>}</div>
    {previewImage && <ImagePreview url={previewImage} onClose={() => setPreviewImage(null)}/>} 
  </section>
}

export default function App() {
  const localPreviewParams = new URLSearchParams(window.location.search)
  const localBatchPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname) && localPreviewParams.get('preview') === 'batch'
  const localAvatarPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname) && localPreviewParams.get('preview') === 'avatar'
  const localVideoPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname) && localPreviewParams.get('preview') === 'video'
  const localPreviewTheme = localPreviewParams.get('theme')
  const [authState, setAuthState] = useState(() => getAuthToken() ? 'checking' : 'guest')
  const [user, setUser] = useState(null)
  const [loginPromptModule, setLoginPromptModule] = useState(null)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [active, setActive] = useState('image')
  const [moreTool, setMoreTool] = useState('please-day')
  const [imageMode, setImageMode] = useState(() => localStorage.getItem(IMAGE_MODE_KEY) === 'dialogue' ? 'dialogue' : 'waterfall')
  const [videoHistoryRequested, setVideoHistoryRequested] = useState(false)
  const [pendingImageMode, setPendingImageMode] = useState(null)
  const [theme, setTheme] = useState(() => ['light', 'dark'].includes(localPreviewTheme) ? localPreviewTheme : localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [workspaceToken, setWorkspaceToken] = useState(0)
  const [archiveViewOpen, setArchiveViewOpen] = useState(false)
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || null
  const activeConversations = conversations.filter((conversation) => !conversation.archived)
  const archivedConversations = conversations.filter((conversation) => conversation.archived)
  const conversationStorageKey = user ? `${STORAGE_KEY}:${user.email}` : STORAGE_KEY

  useEffect(() => {
    if (authState !== 'checking') return
    getCurrentAccount().then(({ user: account }) => { setUser(account); setAuthState('authenticated') }).catch(() => { clearAuthToken(); setAuthState('guest') })
  }, [authState])

  useEffect(() => {
    if (!user) return
    setConversations(loadConversations(`${STORAGE_KEY}:${user.email}`))
    setActiveConversationId(null)
  }, [user])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    localStorage.setItem(THEME_KEY, theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101713' : '#e8ede3')
  }, [theme])

  function updateConversations(transform) {
    setConversations((current) => {
      const next = transform(current)
      try { localStorage.setItem(conversationStorageKey, JSON.stringify(next)) } catch { /* Storage quota: keep the in-memory history. */ }
      return next
    })
  }

  function saveConversation(update) {
    const now = new Date().toISOString()
    const { activate, ...conversationUpdate } = update
    if (activate) setActiveConversationId(update.id)
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === update.id)
      const record = safeConversation({ ...existing, ...conversationUpdate, createdAt: existing?.createdAt || now, updatedAt: now })
      const next = [record, ...current.filter((conversation) => conversation.id !== update.id)].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      try { localStorage.setItem(conversationStorageKey, JSON.stringify(next)) } catch { /* Storage quota: keep the in-memory history. */ }
      return next
    })
  }

  function startNew(type = active, { createHistory = false } = {}) {
    setArchiveViewOpen(false)
    setActive(type)
    setVideoHistoryRequested(type === 'video' && createHistory)
    setActiveConversationId(null)
    setWorkspaceToken((value) => value + 1)
  }

  function changeModule(type) {
    if (!user && type !== 'more' && type !== 'compliance') { setPendingImageMode(null); openLogin(type); return }
    startNew(type)
  }

  function selectMoreTool(tool) {
    if (!user && !['please-day', 'qr'].includes(tool)) { setLoginPromptModule('more-qr'); return }
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
    setVideoHistoryRequested(false)
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

  function archiveConversation(id) {
    updateConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, archived: true, pinned: false, pinnedAt: null } : conversation))
    if (activeConversationId === id) startNew()
  }

  function restoreConversation(id) {
    updateConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, archived: false, updatedAt: new Date().toISOString() } : conversation))
  }

  function deleteConversation(id) {
    updateConversations((current) => current.filter((conversation) => conversation.id !== id))
  }

  function deleteAllArchived() {
    updateConversations((current) => current.filter((conversation) => !conversation.archived))
  }

  const content = archiveViewOpen
    ? <ArchiveWorkspace key={workspaceToken} archived={archivedConversations} onRestore={restoreConversation} onDelete={deleteConversation} onDeleteAll={deleteAllArchived}/>
    : active === 'more'
      ? <MoreTools key={workspaceToken} tool={moreTool}/>
      : active === 'image'
      ? <ImageStudio key={workspaceToken} conversation={activeConversation} onSave={saveConversation} imageMode={imageMode} waterfallStorageKey={`${WATERFALL_CACHE_PREFIX}${user?.email || 'guest'}`} onUserUpdate={setUser} onRequireLogin={() => openLogin('image')}/>
      : active === 'video'
        ? <VideoHub key={workspaceToken} floatingSidebar conversation={activeConversation} onSave={saveConversation} createHistoryOnOpen={videoHistoryRequested}/>
      : <TextStudio key={workspaceToken} type={active} conversation={activeConversation} onSave={saveConversation}/>

  async function logout() {
    try { await logoutAccount() } catch { /* Clear local login even if the server is unavailable. */ }
    clearAuthToken(); setUser(null); setConversations([]); setAuthState('guest')
  }

  if (localBatchPreview) return <div className="app-shell batch-preview-shell"><div className="atmosphere"/><main className="main"><QrBatchStudio/></main></div>
  if (localAvatarPreview) return <div className="app-shell batch-preview-shell"><div className="atmosphere"/><main className="main"><PleaseDayAvatarStudio/></main></div>
  if (localVideoPreview) return <div className="app-shell batch-preview-shell"><div className="atmosphere"/><main className="main"><Topbar onMenu={() => {}}/><VideoHub/></main></div>
  if (authState === 'checking') return <div className="auth-loading"><span className="brand-avatar"><img className="mascot-frame mascot-open" src="/xiaodie-frame-open.png?v=3" alt="小蝶"/></span><i/></div>
  return <div className={`app-shell ${active === 'video' && !archiveViewOpen ? 'video-shell' : ''}`}><div className="atmosphere"/><Sidebar active={active} onChange={changeModule} imageMode={imageMode} onSelectImageMode={selectImageMode} moreTool={moreTool} onSelectMoreTool={selectMoreTool} onNew={() => user || active === 'compliance' || active === 'more' ? startNew(active, { createHistory: true }) : openLogin('image')} conversations={activeConversations} activeConversationId={activeConversationId} onSelectConversation={selectConversation} onPinConversation={togglePinConversation} onArchiveConversation={archiveConversation} onRenameConversation={renameConversation} onOpenArchive={openArchiveView} theme={theme} onThemeChange={setTheme} open={sidebarOpen} onClose={() => setSidebarOpen(false)} user={user} onChangePassword={() => setPasswordModalOpen(true)} onLogout={logout} onLogin={() => openLogin('general')}/><main className="main"><Topbar onMenu={() => setSidebarOpen(true)}/>{content}</main>{passwordModalOpen && <ChangePasswordModal onClose={() => setPasswordModalOpen(false)}/>} {loginPromptModule && <AuthScreen requiredModule={loginPromptModule} onClose={() => { setLoginPromptModule(null); setPendingImageMode(null) }} onAuthenticated={completeLogin}/>}</div>
}
