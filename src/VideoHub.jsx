import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createVideoTask, generateImage, generateText, getVideoTask, uploadGoogleDriveImage, uploadVideoReference } from './api.js'
import { Icon } from './icons.jsx'
import ImagePreview from './ImagePreview.jsx'
import { IMAGE_MODEL_OPTIONS, VIP_IMAGE_MODEL, VIP_IMAGE_RESOLUTION_OPTIONS, imageResolutionForModel } from './imageModels.js'

const SCRIPT_PROMPT = `你是影视分镜与提示词策划师。根据用户给出的原文，输出严格 JSON（不要 Markdown、不要解释）：{"script":"详细剧情，按镜头写明人物动作、场景、氛围、景别、运镜和时长建议","characters":"提取每个角色，并给出可直接用于生图的外貌、服饰、年龄气质、表情与动作提示词","scenes":"提取场景，并给出可直接用于生图/生视频的空间、时间、光线、风格和镜头提示词"}。使用中文，描述具体、有电影感。`

const nodeTitles = { script: ['视频脚本', 'spark'], image: ['图片生成', 'image'], video: ['视频生成', 'video'] }
const defaultNodes = []
const HUB_WORLD_WIDTH = 15_000
const HUB_WORLD_HEIGHT = 9_000
const quickStarts = [
  { type: 'script', title: '故事脚本生成', description: '把一句灵感拆成剧情、角色与场景', tag: 'GPT-5.6 Terra' },
  { type: 'image', title: '角色 / 场景生图', description: '生成可连入视频节点的视觉素材', tag: 'Image 2' },
  { type: 'video', title: '全能参考生视频', description: '用文字与参考图生成最终视频', tag: 'SD 2.5' },
]

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

async function normalizeVideoReference(source) {
  if (!String(source || '').startsWith('data:image/')) return source
  const image = new Image()
  image.src = source
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('参考图无法读取')) })
  const originalWidth = image.naturalWidth || image.width
  const originalHeight = image.naturalHeight || image.height
  if (!originalWidth || !originalHeight) throw new Error('参考图尺寸无效')
  const scale = Math.min(2048 / Math.max(originalWidth, originalHeight), Math.max(1, 512 / Math.min(originalWidth, originalHeight)))
  const drawWidth = Math.max(2, Math.round(originalWidth * scale))
  const drawHeight = Math.max(2, Math.round(originalHeight * scale))
  const width = Math.max(512, drawWidth)
  const height = Math.max(512, drawHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, Math.round((width - drawWidth) / 2), Math.round((height - drawHeight) / 2), drawWidth, drawHeight)
  return canvas.toDataURL('image/jpeg', 0.92)
}

function parseScript(content) {
  const raw = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const json = raw.match(/\{[\s\S]*\}/)?.[0] || raw
  try {
    const data = JSON.parse(json)
    return { script: String(data.script || ''), characters: String(data.characters || ''), scenes: String(data.scenes || '') }
  } catch { return { script: raw, characters: '', scenes: '' } }
}

function mergeText(...values) {
  return values.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n')
}

function friendlyVideoError(message) {
  const text = String(message || '')
  const referenceIndex = text.match(/第\s*(\d+)\s*个image参考素材校验失败/i)?.[1]
  if (referenceIndex !== undefined) return `第 ${Number(referenceIndex) + 1} 张参考图无法读取，请重新上传 JPG、PNG 或 WebP 图片`
  return text || '视频生成失败'
}

function NodePort({ side, label, portKey, registerPort, onPointerDown, onPointerUp }) {
  return <button type="button" ref={(element) => registerPort(portKey, element)} className={`hub-port ${side}`} title={label} aria-label={label} onPointerDown={onPointerDown} onPointerUp={onPointerUp}><i/></button>
}

function ReferenceStrip({ files, linkedFiles = [], onAdd, onRemove, limit = 8 }) {
  return <div className="hub-reference-strip">
    {linkedFiles.map((file, index) => <span className="hub-reference hub-reference-linked" key={`linked-${file}-${index}`} title="来自已连接的图片节点"><img src={file} alt="关联参考图"/></span>)}
    {files.map((file, index) => <span className="hub-reference" key={`${file}-${index}`}><img src={file} alt="参考图"/><button type="button" onClick={() => onRemove(index)} aria-label="移除参考图"><Icon name="x" size={12}/></button></span>)}
    {files.length + linkedFiles.length < limit && <label className="hub-upload" title="添加参考图"><Icon name="plus" size={17}/><input type="file" accept="image/*" multiple onChange={onAdd}/></label>}
  </div>
}

function GenerationProgress({ progress, quiet = false }) {
  const hasProviderProgress = Number.isInteger(progress) && progress >= 0 && progress <= 100
  const bubbles = useMemo(() => Array.from({ length: 9 }, (_, index) => ({
    id: index,
    size: `${72 + Math.round(Math.random() * 118)}px`,
    blur: `${20 + Math.round(Math.random() * 20)}px`,
    duration: `${5.2 + Math.random() * 4.6}s`,
    delay: `${-(Math.random() * 6)}s`,
    x1: `${Math.round(Math.random() * 580 - 290)}px`,
    y1: `${Math.round(Math.random() * 360 - 180)}px`,
    x2: `${Math.round(Math.random() * 580 - 290)}px`,
    y2: `${Math.round(Math.random() * 360 - 180)}px`,
    x3: `${Math.round(Math.random() * 580 - 290)}px`,
    y3: `${Math.round(Math.random() * 360 - 180)}px`,
  })), [])
  return <div className={`hub-generation-progress ${quiet ? 'is-quiet' : ''}`} role="status" aria-live="polite" aria-label={quiet ? '视频生成中' : '图片生成中'}>{bubbles.map((bubble) => <i className="hub-progress-bubble" key={bubble.id} style={{ '--bubble-size': bubble.size, '--bubble-blur': bubble.blur, '--bubble-duration': bubble.duration, '--bubble-delay': bubble.delay, '--bubble-x1': bubble.x1, '--bubble-y1': bubble.y1, '--bubble-x2': bubble.x2, '--bubble-y2': bubble.y2, '--bubble-x3': bubble.x3, '--bubble-y3': bubble.y3 }}/>) }{!quiet && <b>{hasProviderProgress ? `生成中 ${progress}%` : '生成中'}</b>}</div>
}

function VideoHub({ floatingSidebar = false, conversation, onSave, createHistoryOnOpen = false }) {
  const canvasRef = useRef(null)
  const timerRef = useRef(null)
  const dragRef = useRef(null)
  const portRefs = useRef({})
  const linkGestureRef = useRef(null)
  const zoomRef = useRef(100)
  const gestureScaleRef = useRef(1)
  const initialViewportSetRef = useRef(false)
  const persistTimerRef = useRef(null)
  const hubSnapshotRef = useRef(null)
  const isHubDirtyRef = useRef(false)
  const hasHydratedWorkspaceRef = useRef(false)
  const savedHub = conversation?.videoHub || {}
  const activeNodeIdRef = useRef(savedHub.activeNodeId || savedHub.nodes?.[0]?.id || '')
  const onSaveRef = useRef(onSave)
  const conversationId = useRef(conversation?.id || crypto.randomUUID())
  const historyTitleRef = useRef(conversation?.messages?.find((message) => message.role === 'user')?.content || '')
  const [nodes, setNodes] = useState(savedHub.nodes || defaultNodes)
  const [links, setLinks] = useState(savedHub.links || [])
  const [linking, setLinking] = useState(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const [scriptInput, setScriptInput] = useState(savedHub.scriptInput || '')
  const [scriptData, setScriptData] = useState(savedHub.scriptData || { script: '', characters: '', scenes: '' })
  const [scriptLoading, setScriptLoading] = useState(false)
  const [imagePrompt, setImagePrompt] = useState(savedHub.imagePrompt || '')
  const [imageRefs, setImageRefs] = useState(savedHub.imageRefs || [])
  const [imageUrls, setImageUrls] = useState(savedHub.imageUrls || [])
  const [imageResultPrompt, setImageResultPrompt] = useState(savedHub.imageResultPrompt || '')
  const [imageLoading, setImageLoading] = useState(false)
  const [imageAspectRatio, setImageAspectRatio] = useState(savedHub.imageAspectRatio || '16:9')
  const [imageModel, setImageModel] = useState(savedHub.imageModel || VIP_IMAGE_MODEL)
  const [imageResolution, setImageResolution] = useState(() => imageResolutionForModel(savedHub.imageModel || VIP_IMAGE_MODEL, savedHub.imageResolution))
  const [imageResultAspect, setImageResultAspect] = useState(null)
  const [previewImage, setPreviewImage] = useState(null)
  const [videoPrompt, setVideoPrompt] = useState(savedHub.videoPrompt || '')
  const [videoRefs, setVideoRefs] = useState(savedHub.videoRefs || [])
  const [model, setModel] = useState(savedHub.model || 'doubao-seedance-2-0-260128')
  const [duration, setDuration] = useState(savedHub.duration || 8)
  const [resolution, setResolution] = useState(savedHub.resolution || '720p')
  const [aspectRatio, setAspectRatio] = useState(savedHub.aspectRatio || '16:9')
  const [referenceMode, setReferenceMode] = useState(savedHub.referenceMode || 'multi')
  const [omniType, setOmniType] = useState(savedHub.omniType || 'reference')
  const [videoState, setVideoState] = useState(savedHub.videoState || { status: 'idle', taskId: '', url: '', error: '' })
  const [videoResultAspect, setVideoResultAspect] = useState(null)
  const [workspaceName, setWorkspaceName] = useState(savedHub.workspaceName || conversation?.title || '未命名工作区')
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('')
  const [isEditingWorkspaceName, setIsEditingWorkspaceName] = useState(false)
  const [nodeMenuPosition, setNodeMenuPosition] = useState(null)
  const [zoom, setZoom] = useState(100)
  const hasWorkspaceContent = nodes.length > 0 || links.length > 0 || Boolean(scriptInput.trim() || scriptData.script.trim() || scriptData.characters.trim() || scriptData.scenes.trim() || imagePrompt.trim() || imageRefs.length || imageUrls.length || videoPrompt.trim() || videoRefs.length || videoState.taskId || videoState.url)
  const shouldPersistWorkspace = Boolean(conversation || createHistoryOnOpen || hasWorkspaceContent)

  onSaveRef.current = onSave
  hubSnapshotRef.current = { workspaceName, nodes, links, activeNodeId: activeNodeIdRef.current, scriptInput, scriptData, imagePrompt, imageRefs, imageUrls, imageResultPrompt, imageAspectRatio, imageModel, imageResolution, videoPrompt, videoRefs, model, duration, resolution, aspectRatio, referenceMode, omniType, videoState }

  function persistHub(snapshot = hubSnapshotRef.current) {
    if (!snapshot || !onSaveRef.current) return
    const isRunning = ['submitting', 'running', 'PENDING', 'RUNNING'].includes(snapshot.videoState.status)
    onSaveRef.current({
      id: conversationId.current,
      type: 'video',
      title: snapshot.workspaceName,
      messages: [{ role: 'user', content: historyTitleRef.current || snapshot.workspaceName || '未命名视频任务' }],
      status: isRunning ? 'running' : 'idle',
      runningStartedAt: isRunning ? new Date().toISOString() : null,
      unreadComplete: false,
      videoHub: snapshot,
      activate: true,
    })
  }

  useEffect(() => {
    if (!onSaveRef.current || !shouldPersistWorkspace) return undefined
    // Loading a saved workspace must not mark it as freshly edited: that
    // previously refreshed updatedAt and moved the history row to the top.
    if (!hasHydratedWorkspaceRef.current) {
      hasHydratedWorkspaceRef.current = true
      if (conversation || !createHistoryOnOpen) return undefined
    }
    isHubDirtyRef.current = true
    window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      persistHub()
      isHubDirtyRef.current = false
    }, 320)
    return () => window.clearTimeout(persistTimerRef.current)
  }, [shouldPersistWorkspace, workspaceName, nodes, links, scriptInput, scriptData, imagePrompt, imageRefs, imageUrls, imageResultPrompt, imageAspectRatio, imageModel, imageResolution, videoPrompt, videoRefs, model, duration, resolution, aspectRatio, referenceMode, omniType, videoState])

  useEffect(() => () => {
    window.clearTimeout(persistTimerRef.current)
    if (isHubDirtyRef.current && shouldPersistWorkspace) persistHub(hubSnapshotRef.current)
  }, [])

  function nodeCenter(node) {
    const width = node.type === 'script' ? 364 : 560
    const height = node.type === 'script' ? 380 : 520
    return { x: node.x + width / 2, y: node.y + height / 2 }
  }

  function nodeGroupCenter() {
    if (!nodes.length) return { x: HUB_WORLD_WIDTH / 2, y: HUB_WORLD_HEIGHT / 2 }
    const centers = nodes.map(nodeCenter)
    return {
      x: (Math.min(...centers.map((point) => point.x)) + Math.max(...centers.map((point) => point.x))) / 2,
      y: (Math.min(...centers.map((point) => point.y)) + Math.max(...centers.map((point) => point.y))) / 2,
    }
  }

  function zoomAnchor() {
    const activeNode = nodes.find((node) => node.id === activeNodeIdRef.current) || nodes[0]
    return activeNode ? nodeCenter(activeNode) : null
  }

  function centerCanvasOn(point, targetZoom = zoomRef.current) {
    const canvas = canvasRef.current
    if (!canvas || !point) return
    const scale = targetZoom / 100
    canvas.scrollLeft = Math.max(0, point.x * scale - canvas.clientWidth / 2)
    canvas.scrollTop = Math.max(0, point.y * scale - canvas.clientHeight / 2)
  }

  useLayoutEffect(() => {
    if (initialViewportSetRef.current || !canvasRef.current) return
    initialViewportSetRef.current = true
    window.requestAnimationFrame(() => centerCanvasOn(nodeGroupCenter()))
  }, [nodes.length])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  function recordTask(title, status = 'running', overrides = {}) {
    if (!onSave) return
    if (title) historyTitleRef.current = title
    const taskTitle = historyTitleRef.current || '未命名视频任务'
    onSave({
      id: conversationId.current,
      type: 'video',
      title: workspaceName,
      messages: [{ role: 'user', content: taskTitle }],
      status,
      runningStartedAt: status === 'running' ? new Date().toISOString() : null,
      unreadComplete: false,
      videoHub: { workspaceName, nodes, links, scriptInput, scriptData, imagePrompt, imageRefs, imageUrls, imageResultPrompt, imageAspectRatio, imageModel, imageResolution, videoPrompt, videoRefs, model, duration, resolution, aspectRatio, referenceMode, omniType, videoState, ...overrides },
      activate: true,
    })
  }

  function beginWorkspaceNameEdit() {
    setWorkspaceNameDraft(workspaceName)
    setIsEditingWorkspaceName(true)
  }

  function commitWorkspaceName() {
    const nextName = workspaceNameDraft.trim() || '未命名工作区'
    setWorkspaceName(nextName)
    setIsEditingWorkspaceName(false)
    if (!onSave) return
    const isRunning = ['submitting', 'running', 'PENDING', 'RUNNING'].includes(videoState.status)
    onSave({
      id: conversationId.current,
      type: 'video',
      title: nextName,
      messages: [{ role: 'user', content: historyTitleRef.current || nextName }],
      status: isRunning ? 'running' : 'idle',
      runningStartedAt: isRunning ? new Date().toISOString() : null,
      unreadComplete: false,
      videoHub: { workspaceName: nextName, nodes, links, scriptInput, scriptData, imagePrompt, imageRefs, imageUrls, imageResultPrompt, imageAspectRatio, imageModel, imageResolution, videoPrompt, videoRefs, model, duration, resolution, aspectRatio, referenceMode, omniType, videoState },
      activate: true,
    })
  }

  function updateZoom(nextValue, clientX, clientY) {
    const canvas = canvasRef.current
    const current = zoomRef.current
    const next = Math.max(1, Math.min(150, Math.round(nextValue)))
    if (!canvas || next === current) return
    const contentAnchor = zoomAnchor()
    const rect = canvas.getBoundingClientRect()
    const pointerX = clientX ?? rect.left + rect.width / 2
    const pointerY = clientY ?? rect.top + rect.height / 2
    const viewportX = pointerX - rect.left
    const viewportY = pointerY - rect.top
    const worldX = (canvas.scrollLeft + viewportX) / (current / 100)
    const worldY = (canvas.scrollTop + viewportY) / (current / 100)
    zoomRef.current = next
    setZoom(next)
    window.requestAnimationFrame(() => {
      if (contentAnchor) centerCanvasOn(contentAnchor, next)
      else {
        canvas.scrollLeft = Math.max(0, worldX * (next / 100) - viewportX)
        canvas.scrollTop = Math.max(0, worldY * (next / 100) - viewportY)
      }
    })
  }

  function focusFirstNode() {
    const canvas = canvasRef.current
    const node = nodes[0]
    if (!canvas || !node) return
    const element = canvas.querySelector(`[data-node-id="${node.id}"]`)
    const nodeWidth = element?.offsetWidth || (node.type === 'script' ? 300 : 560)
    const nodeHeight = element?.offsetHeight || 360
    const targetZoom = Math.max(1, Math.min(150, Math.round(Math.min((canvas.clientWidth - 112) / nodeWidth, (canvas.clientHeight - 112) / nodeHeight) * 100)))
    const scale = targetZoom / 100
    zoomRef.current = targetZoom
    setZoom(targetZoom)
    window.requestAnimationFrame(() => {
      canvas.scrollLeft = Math.max(0, node.x * scale - (canvas.clientWidth - nodeWidth * scale) / 2)
      canvas.scrollTop = Math.max(0, node.y * scale - (canvas.clientHeight - nodeHeight * scale) / 2)
    })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const onWheel = (event) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const strength = Math.min(12, Math.max(2, Math.abs(event.deltaY) / 8))
      updateZoom(zoomRef.current + (event.deltaY < 0 ? strength : -strength), event.clientX, event.clientY)
    }
    const onGestureStart = (event) => { event.preventDefault(); gestureScaleRef.current = event.scale || 1 }
    const onGestureChange = (event) => {
      event.preventDefault()
      const relative = (event.scale || 1) / gestureScaleRef.current
      gestureScaleRef.current = event.scale || 1
      updateZoom(zoomRef.current * relative, event.clientX, event.clientY)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('gesturestart', onGestureStart, { passive: false })
    canvas.addEventListener('gesturechange', onGestureChange, { passive: false })
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('gesturestart', onGestureStart)
      canvas.removeEventListener('gesturechange', onGestureChange)
    }
  }, [])

  function canvasPosition(clientX, clientY) {
    const canvas = canvasRef.current
    const rect = canvas?.getBoundingClientRect()
    const scale = zoomRef.current / 100
    if (!canvas || !rect) return null
    return { x: (clientX - rect.left + canvas.scrollLeft) / scale, y: (clientY - rect.top + canvas.scrollTop) / scale }
  }

  const linkedText = (targetId) => links.filter((link) => link.to === targetId).map((link) => {
    const sourceNode = nodes.find((node) => node.id === link.from)
    if (sourceNode?.type === 'script') return scriptData[link.output] || ''
    return ''
  }).filter(Boolean)
  const linkedImages = (targetId) => links.filter((link) => link.to === targetId && nodes.some((node) => node.id === link.from && node.type === 'image')).flatMap(() => imageUrls)

  function addNode(type, position) {
    const canvas = canvasRef.current
    const scale = zoomRef.current / 100
    const nodeWidth = type === 'script' ? 364 : 560
    const nodeHeight = type === 'script' ? 380 : 520
    const fallback = canvas
      ? { x: (canvas.scrollLeft + canvas.clientWidth / 2) / scale - nodeWidth / 2 + nodes.length * 28, y: (canvas.scrollTop + canvas.clientHeight / 2) / scale - nodeHeight / 2 + nodes.length * 28 }
      : { x: HUB_WORLD_WIDTH / 2 - nodeWidth / 2, y: HUB_WORLD_HEIGHT / 2 - nodeHeight / 2 }
    const x = Math.max(18, position?.x ?? fallback.x)
    const y = Math.max(64, position?.y ?? fallback.y)
    const id = `${type}-${Date.now()}`
    activeNodeIdRef.current = id
    setNodes((current) => [...current, { id, type, x, y }])
    setNodeMenuPosition(null)
  }

  function removeNode(nodeId) {
    setNodes((current) => current.filter((node) => node.id !== nodeId))
    setLinks((current) => current.filter((link) => link.from !== nodeId && link.to !== nodeId))
    if (linking?.from === nodeId) setLinking(null)
    if (dragRef.current?.id === nodeId) dragRef.current = null
  }

  function openCanvasMenu(event) {
    if (event.target.closest('.hub-node, button, textarea, input, select, label')) return
    const position = canvasPosition(event.clientX, event.clientY)
    if (!position) return
    setNodeMenuPosition(position)
  }

  function startDrag(event, node) {
    activeNodeIdRef.current = node.id
    if (event.target.closest('button, textarea, input, select, label')) return
    const position = canvasPosition(event.clientX, event.clientY)
    if (!position) return
    dragRef.current = { id: node.id, offsetX: position.x - node.x, offsetY: position.y - node.y }
  }

  function moveCanvas(event) {
    const position = canvasPosition(event.clientX, event.clientY)
    if (!position) return
    setPointer(position)
    if (linkGestureRef.current && Math.hypot(position.x - linkGestureRef.current.x, position.y - linkGestureRef.current.y) > 4) linkGestureRef.current.moved = true
    if (!dragRef.current) return
    const { id, offsetX, offsetY } = dragRef.current
    setNodes((current) => current.map((node) => node.id === id ? { ...node, x: Math.max(12, position.x - offsetX), y: Math.max(56, position.y - offsetY) } : node))
  }

  function finishCanvas() { dragRef.current = null; linkGestureRef.current = null; if (linking) setLinking(null) }
  function beginLink(event, from, output) {
    event.stopPropagation()
    const position = canvasPosition(event.clientX, event.clientY)
    if (!position) return
    linkGestureRef.current = { from, output, x: position.x, y: position.y, moved: false }
    setLinking({ from, output })
  }
  function finishOutputLink(event, from, output) {
    event.stopPropagation()
    if (!linkGestureRef.current?.moved) setLinks((current) => current.filter((link) => link.from !== from || link.output !== output))
    linkGestureRef.current = null
    setLinking(null)
  }
  function finishLink(event, to) {
    event.stopPropagation()
    const source = linking
    const wasDragged = linkGestureRef.current?.moved
    if (source && source.from !== to) setLinks((current) => current.some((link) => link.from === source.from && link.to === to && link.output === source.output) ? current : [...current, { ...source, to }])
    else if (!wasDragged) setLinks((current) => current.filter((link) => link.to !== to))
    linkGestureRef.current = null
    setLinking(null)
  }

  function registerPort(key, element) {
    if (element) portRefs.current[key] = element
    else delete portRefs.current[key]
  }

  function portPoint(key) {
    const port = portRefs.current[key]
    const canvas = canvasRef.current
    if (!port || !canvas) return null
    const canvasRect = canvas.getBoundingClientRect()
    const portRect = port.getBoundingClientRect()
    const scale = zoomRef.current / 100
    return { x: (portRect.left - canvasRect.left + canvas.scrollLeft + portRect.width / 2) / scale, y: (portRect.top - canvasRect.top + canvas.scrollTop + portRect.height / 2) / scale }
  }

  async function addReferences(event, setter, limit) {
    const selected = Array.from(event.target.files || []).slice(0, limit)
    try {
      const references = await Promise.all(selected.map(async (file) => ({ source: await fileToDataUrl(file), name: file.name })))
      // References are usable the moment the local file is read. Drive sync is
      // deliberately background-only so selecting an image never waits on I/O.
      const localSources = references.map((reference) => reference.source)
      setter((current) => [...current, ...localSources].slice(0, limit))
      void Promise.allSettled(references.map(async (reference) => ({ source: reference.source, url: (await uploadGoogleDriveImage({ source: reference.source, name: reference.name })).url }))).then((results) => {
        const replacements = new Map(results.filter((result) => result.status === 'fulfilled').map((result) => [result.value.source, result.value.url]))
        if (replacements.size) setter((current) => current.map((source) => replacements.get(source) || source))
      })
    } catch (error) { window.alert(error.message) }
    event.target.value = ''
  }

  async function makeScript() {
    if (!scriptInput.trim() || scriptLoading) return
    recordTask(`视频脚本：${scriptInput.trim().slice(0, 22)}`)
    setScriptLoading(true)
    try {
      const result = await generateText({ messages: [{ role: 'user', content: scriptInput.trim() }], systemPrompt: SCRIPT_PROMPT, webSearch: false })
      const nextScriptData = parseScript(result.content)
      setScriptData(nextScriptData)
      recordTask('', 'idle', { scriptData: nextScriptData })
    } catch (error) { recordTask('', 'idle'); window.alert(error.message || '视频脚本生成失败') } finally { setScriptLoading(false) }
  }

  async function makeImage(targetId) {
    const prompt = mergeText(imagePrompt, ...linkedText(targetId))
    if (!prompt || imageLoading) return
    recordTask(`图片生成：${prompt.slice(0, 22)}`)
    setImageLoading(true)
    try {
      const result = await generateImage({ prompt, images: imageRefs, aspectRatio: imageAspectRatio, model: imageModel, resolution: imageResolution })
      const urls = result.urls || []
      setImageUrls(urls); setImageResultPrompt(prompt); setImageResultAspect(null)
      recordTask('', 'idle', { imageUrls: urls, imageResultPrompt: prompt })
    } catch (error) { recordTask('', 'idle'); window.alert(error.message || '图片生成失败') } finally { setImageLoading(false) }
  }

  function addMention(text) {
    setVideoPrompt((current) => `${current}${current ? ' ' : ''}@${text}`)
  }

  async function publicReferences(sources) {
    return Promise.all(sources.map(async (source) => (await uploadVideoReference({ source: await normalizeVideoReference(source) })).url))
  }

  async function makeVideo(targetId) {
    const textPrompt = mergeText(videoPrompt, ...linkedText(targetId))
    const refs = [...new Set([...videoRefs, ...linkedImages(targetId)])]
    if (!textPrompt || videoState.status === 'running') return
    const submittingState = { status: 'submitting', taskId: '', url: '', error: '' }
    recordTask(`视频生成：${textPrompt.slice(0, 22)}`, 'running', { videoState: submittingState })
    setVideoState(submittingState)
    try {
      const urls = await publicReferences(refs)
      const payload = { model, prompt: textPrompt, durationSeconds: Number(duration), resolution, aspectRatio, referenceMode, omniReferenceTaskType: model.includes('2-5') ? omniType : undefined }
      if (referenceMode === 'single') payload.imageUrl = urls[0]
      if (referenceMode === 'frames') { payload.firstFrameImageUrl = urls[0]; payload.lastFrameImageUrl = urls[1] }
      if (referenceMode === 'multi') payload.referenceImageUrls = urls
      const task = await createVideoTask(payload)
      const nextVideoState = { status: task.status || 'running', taskId: task.taskId, url: '', error: '' }
      setVideoState(nextVideoState)
      recordTask('', 'running', { videoState: nextVideoState })
      pollVideo(task.taskId)
    } catch (error) { const failedState = { status: 'failed', taskId: '', url: '', error: error.message || '视频任务提交失败' }; setVideoState(failedState); recordTask('', 'idle', { videoState: failedState }) }
  }

  function pollVideo(taskId) {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(async () => {
      try {
        const task = await getVideoTask(taskId)
        if (task.status === 'COMPLETED') { const completedState = { status: 'completed', taskId, url: task.videoUrl, error: '' }; setVideoResultAspect(null); setVideoState(completedState); recordTask('', 'idle', { videoState: completedState }); return }
        if (task.status === 'FAILED') { const failedState = { status: 'failed', taskId, url: '', error: friendlyVideoError(task.error) }; setVideoState(failedState); recordTask('', 'idle', { videoState: failedState }); return }
        const nextVideoState = { status: task.status || 'running', taskId, url: '', error: '', progress: task.progress }
        setVideoState(nextVideoState); recordTask('', 'running', { videoState: nextVideoState }); pollVideo(taskId)
      } catch (error) { const failedState = { status: 'failed', taskId, url: '', error: error.message || '视频任务查询失败' }; setVideoState(failedState); recordTask('', 'idle', { videoState: failedState }) }
    }, 5_000)
  }

  const resolutions = model.includes('2-5') ? ['480p', '720p', '1080p'] : ['480p', '720p', '1080p', '4k']
  const maxDuration = model.includes('2-5') ? 30 : 15
  const card = (node) => {
    const [title, icon] = nodeTitles[node.type]
    const isScript = node.type === 'script'
    const isImage = node.type === 'image'
    const isVideo = node.type === 'video'
    return <article className={`hub-node hub-node-${node.type}`} key={node.id} data-node-id={node.id} style={{ transform: `translate(${node.x}px, ${node.y}px)` }} onPointerDown={(event) => startDrag(event, node)}>
      <header><span className="hub-node-icon"><Icon name={icon} size={15}/></span><b>{title}</b><button type="button" className="hub-node-delete" aria-label={`删除${title}节点`} title="删除节点" onClick={() => removeNode(node.id)}><Icon name="x" size={14}/></button>{!isScript && <NodePort side="in" portKey={`${node.id}:in`} registerPort={registerPort} label="拖动连接；点击断开输入连接" onPointerUp={(event) => finishLink(event, node.id)}/>}</header>
      {isScript && <div className="hub-node-body">
        <textarea value={scriptInput} onChange={(event) => setScriptInput(event.target.value)} placeholder="粘贴故事、文案或创意方向…"/>
        <button type="button" className="hub-primary" onClick={makeScript} disabled={scriptLoading || !scriptInput.trim()}>{scriptLoading ? '正在拆解…' : '生成脚本'}<Icon name="spark" size={14}/></button>
        <div className="hub-script-fields">
          {[['script', '剧情与运镜'], ['characters', '人物角色'], ['scenes', '场景描述']].map(([key, label]) => <label key={key}><span>{label}</span><textarea value={scriptData[key]} onChange={(event) => setScriptData((current) => ({ ...current, [key]: event.target.value }))} placeholder="生成后可直接编辑"/><NodePort side="out" portKey={`${node.id}:${key}`} registerPort={registerPort} label={`拖动连出${label}；点击断开`} onPointerDown={(event) => beginLink(event, node.id, key)} onPointerUp={(event) => finishOutputLink(event, node.id, key)}/></label>)}
        </div>
      </div>}
      {isImage && <div className="hub-node-body hub-image-body">
        <div className={`hub-image-stage ${imageUrls.length ? 'has-media' : ''}`} style={imageUrls.length && imageResultAspect ? { aspectRatio: imageResultAspect } : undefined}>
          {imageLoading ? <GenerationProgress/> : imageUrls.length ? <div className="hub-image-results">{imageUrls.map((url, index) => <button type="button" className="hub-image-preview" key={url} onClick={() => setPreviewImage({ url, urls: imageUrls, prompt: imageResultPrompt })} aria-label={`预览生成图片 ${index + 1}`}><img src={url} alt={`生成图片 ${index + 1}`} loading="lazy" decoding="async" onLoad={(event) => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setImageResultAspect(`${naturalWidth} / ${naturalHeight}`) }}/></button>)}</div> : <div className="hub-image-empty"><Icon name="image" size={38}/><span>图片将在这里生成</span></div>}
        </div>
        <div className="hub-image-composer">
          <ReferenceStrip files={imageRefs} limit={4} onAdd={(event) => addReferences(event, setImageRefs, 4)} onRemove={(index) => setImageRefs((items) => items.filter((_, i) => i !== index))}/>
          <textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="描述想生成的画面，或连入角色、场景提示词…"/>
          <div className="hub-image-footer"><select aria-label="图片模型" value={imageModel} onChange={(event) => { const nextModel = event.target.value; setImageModel(nextModel); setImageResolution(nextModel === VIP_IMAGE_MODEL ? '2k' : '1k') }}>{IMAGE_MODEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select aria-label="图片清晰度" value={imageResolution} disabled={imageModel !== VIP_IMAGE_MODEL} onChange={(event) => setImageResolution(event.target.value)}>{VIP_IMAGE_RESOLUTION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select aria-label="图片画幅" value={imageAspectRatio} onChange={(event) => setImageAspectRatio(event.target.value)}>{['16:9', '9:16', '1:1', '4:3', '3:4', 'auto'].map((item) => <option key={item}>{item}</option>)}</select><span>{imageResolution.toUpperCase()} · 1 张</span><button type="button" aria-label="生成图片" title="生成图片" onClick={() => makeImage(node.id)} disabled={imageLoading || !mergeText(imagePrompt, ...linkedText(node.id))}><Icon name="arrowUp" size={16}/></button></div>
        </div>
      </div>}
      {isVideo && <div className="hub-node-body hub-video-body">
        <div className={`hub-video-stage ${videoState.url ? 'has-media' : ''}`} style={videoState.url && videoResultAspect ? { aspectRatio: videoResultAspect } : undefined}>{['submitting', 'running', 'PENDING', 'RUNNING'].includes(videoState.status) ? <GenerationProgress progress={videoState.progress} quiet/> : videoState.url ? <video controls src={videoState.url} onLoadedMetadata={(event) => { const { videoWidth, videoHeight } = event.currentTarget; if (videoWidth && videoHeight) setVideoResultAspect(`${videoWidth} / ${videoHeight}`) }}/> : <div><Icon name="video" size={42}/><span>视频将在这里生成</span></div>}</div>
        <div className="hub-video-composer">
          {(() => {
            const linkedFiles = [...new Set(linkedImages(node.id))]
            const limit = referenceMode === 'multi' ? 30 : 2
            return <ReferenceStrip files={videoRefs} linkedFiles={linkedFiles} limit={limit} onAdd={(event) => addReferences(event, setVideoRefs, Math.max(0, limit - linkedFiles.length))} onRemove={(index) => setVideoRefs((items) => items.filter((_, i) => i !== index))}/>
          })()}
          <textarea value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} placeholder="描述想生成的视频，使用 @ 关联脚本或参考图…"/>
          <div className="hub-mentions">{scriptData.script && <button type="button" onClick={() => addMention('视频脚本')}>@ 视频脚本</button>}{scriptData.characters && <button type="button" onClick={() => addMention('角色描述')}>@ 角色描述</button>}{imageUrls.length > 0 && <button type="button" onClick={() => addMention('角色参考图')}>@ 角色参考图</button>}</div>
          <div className="hub-video-footer">
            <select aria-label="视频模型" value={model} onChange={(event) => { const next = event.target.value; setModel(next); setResolution(next.includes('2-5') ? '1080p' : '720p'); setDuration(8) }}><option value="doubao-seedance-2-0-260128">Seedance 2.0</option><option value="doubao-seedance-2-5-260628">Seedance 2.5</option></select>
            <select aria-label="生成模式" value={referenceMode} onChange={(event) => setReferenceMode(event.target.value)}><option value="single">单图参考</option><option value="frames">首帧 / 首尾帧</option><option value="multi">全模态参考</option></select>
            <select aria-label="视频画幅" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="视频分辨率" value={resolution} onChange={(event) => setResolution(event.target.value)}>{resolutions.map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="视频时长" value={duration} onChange={(event) => setDuration(event.target.value)}>{Array.from({ length: maxDuration - 3 }, (_, i) => i + 4).map((second) => <option key={second} value={second}>{second}s</option>)}</select>
            {model.includes('2-5') && <select aria-label="Seedance 2.5 任务类型" value={omniType} onChange={(event) => setOmniType(event.target.value)}><option value="reference">参考</option><option value="auto">自动</option><option value="edit">编辑</option><option value="extend">延长</option></select>}
            <button type="button" aria-label="生成视频" title="生成视频" onClick={() => makeVideo(node.id)} disabled={!mergeText(videoPrompt, ...linkedText(node.id)) || ['submitting', 'running', 'PENDING', 'RUNNING'].includes(videoState.status)}><Icon name="arrowUp" size={16}/></button>
          </div>
          {videoState.error && <p className="hub-error">{videoState.error}</p>}
        </div>
      </div>}
      {isImage && <NodePort side="out" portKey={`${node.id}:image`} registerPort={registerPort} label="拖动连出生成图片；点击断开" onPointerDown={(event) => beginLink(event, node.id, 'image')} onPointerUp={(event) => finishOutputLink(event, node.id, 'image')}/>} 
    </article>
  }

  const worldStyle = { width: `${HUB_WORLD_WIDTH * zoom / 100}px`, height: `${HUB_WORLD_HEIGHT * zoom / 100}px` }
  const layerStyle = { width: `${HUB_WORLD_WIDTH}px`, height: `${HUB_WORLD_HEIGHT}px`, transform: `scale(${zoom / 100})` }

  return <section className={`video-hub-workspace ${floatingSidebar ? 'has-floating-sidebar' : ''}`}>
    <header className="video-hub-header"><div className="hub-workspace-title"><span>VIDEO HUB</span>{isEditingWorkspaceName ? <input aria-label="工作区名称" autoFocus value={workspaceNameDraft} onChange={(event) => setWorkspaceNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') commitWorkspaceName(); if (event.key === 'Escape') setIsEditingWorkspaceName(false) }} onBlur={commitWorkspaceName}/> : <h1>{workspaceName}<button type="button" title="编辑工作区名称" aria-label="编辑工作区名称" onClick={beginWorkspaceNameEdit}><Icon name="edit" size={14}/></button></h1>}<p>从一个创作节点开始，再把文字、图片和视频串成可复用的工作流。</p></div><div className="hub-header-tools"><button type="button" className="hub-focus" title="聚焦第一个节点" aria-label="聚焦第一个节点" onClick={focusFirstNode} disabled={nodes.length === 0}><Icon name="focus" size={15}/><span>聚焦</span></button><label className="hub-zoom" title="也可以用触控板捏合缩放"><input type="range" min="1" max="150" value={zoom} onInput={(event) => updateZoom(Number(event.currentTarget.value))} onChange={(event) => updateZoom(Number(event.target.value))}/><output>{zoom}%</output></label><div className="hub-workflow-state"><i/><span>{nodes.length ? `${nodes.length} 个节点` : '尚未创建节点'}</span></div></div></header>
    <div className={`video-hub-canvas ${linking ? 'is-linking' : ''}`} ref={canvasRef} onDoubleClick={openCanvasMenu} onPointerMove={moveCanvas} onPointerUp={finishCanvas} onPointerCancel={finishCanvas} onPointerLeave={finishCanvas}>
      <div className="hub-canvas-world" style={worldStyle}><div className="hub-canvas-layer" style={layerStyle}>
      <svg className="hub-links" aria-hidden="true">{links.map((link, index) => { const start = portPoint(`${link.from}:${link.output}`); const end = portPoint(`${link.to}:in`); if (!start || !end) return null; return <path key={`${link.from}-${link.to}-${link.output}-${index}`} d={`M ${start.x} ${start.y} C ${start.x + 54} ${start.y}, ${end.x - 54} ${end.y}, ${end.x} ${end.y}`}/> })}{linking && (() => { const start = portPoint(`${linking.from}:${linking.output}`); if (!start) return null; return <path className="draft" d={`M ${start.x} ${start.y} C ${start.x + 54} ${start.y}, ${pointer.x - 54} ${pointer.y}, ${pointer.x} ${pointer.y}`}/> })()}</svg>
      {nodes.map(card)}
      {nodeMenuPosition && <div className="hub-canvas-menu" style={{ transform: `translate(${nodeMenuPosition.x}px, ${nodeMenuPosition.y}px)` }}><b>添加创作节点</b><button onClick={() => addNode('script', nodeMenuPosition)}>视频脚本 <small>GPT-5.6 Terra</small></button><button onClick={() => addNode('image', nodeMenuPosition)}>图片生成 <small>Image 2</small></button><button onClick={() => addNode('video', nodeMenuPosition)}>视频生成 <small>Seedance</small></button></div>}
      </div></div>
      {nodes.length === 0 && <div className="hub-empty-start"><p><Icon name="spark" size={17}/> 选择一个节点，开始创建</p><div className="hub-quick-starts">{quickStarts.map((item) => <button type="button" title={item.description} className={`hub-quick-start hub-quick-${item.type}`} key={item.type} onClick={() => addNode(item.type)}><span><Icon name={nodeTitles[item.type][1]} size={19}/></span><b>{item.title}</b></button>)}</div><small>双击画布也可以添加节点</small></div>}
      <div className="hub-bottom-tools">{[['script', '文案'], ['image', '图片'], ['video', '视频']].map(([type, label]) => <button type="button" className={`hub-node-shortcut hub-node-shortcut-${type}`} key={type} onClick={() => addNode(type)}><Icon name="plus" size={15}/><span>{label}</span></button>)}</div>
    </div>
    {previewImage && <ImagePreview url={previewImage.url || previewImage} urls={previewImage.urls} prompt={previewImage.prompt} onClose={() => setPreviewImage(null)}/>} 
  </section>
}

export default VideoHub
