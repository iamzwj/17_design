import { useEffect, useMemo, useRef, useState } from 'react'
import { createVideoTask, fileToDataUrl, getVideoTask, listVideoTasks, uploadVideoReference } from './api.js'
import { Icon } from './icons.jsx'
import { compressImageForUpload, isSupportedImageFile } from './imageUpload.js'

const MODELS = [
  { value: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5', resolutions: ['480p', '720p', '1080p'], maximum: 30, seedance25: true },
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast', resolutions: ['480p', '720p'], maximum: 15 },
  { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0', resolutions: ['480p', '720p', '1080p', '4k'], maximum: 15 },
  { value: 'doubao-seedance-2-0-mini-260615', label: 'Seedance 2.0 Mini', resolutions: ['480p', '720p'], maximum: 15 },
  { value: 'minimax-h3', label: 'MiniMax H3', resolutions: ['480p', '768p', '1080p'], maximum: 15, minimax: true, aspectRatios: [{ value: 'landscape', label: '横屏' }, { value: 'portrait', label: '竖屏' }, { value: 'square', label: '方屏' }] },
]

const ACTIVE = new Set(['PENDING', 'RUNNING'])
const STANDARD_ASPECT_RATIOS = [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' }, { value: '3:4', label: '3:4' }, { value: '21:9', label: '21:9' }]
const VIDEO_FILE_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])
const REFERENCE_MODES = {
  text: { label: '纯文本', hint: '只用提示词生成视频' },
  image: { label: '首帧图片', hint: '让一张图片动起来' },
  frames: { label: '首尾帧', hint: '指定开始与结束画面' },
  reference: { label: '多模态参考', hint: '图片、视频共同参考' },
  edit: { label: '视频编辑', hint: '改画面或音频，保留镜头运动' },
  extend: { label: '视频延长', hint: '从原视频继续向前或向后' },
}

function taskStatus(task) {
  if (task.status === 'PENDING') return '等待视频服务响应…'
  if (task.status === 'RUNNING') return '正在生成视频…'
  if (task.status === 'COMPLETED') return '视频已生成'
  return task.error || '视频生成失败'
}

function availableModes(model) {
  if (model.minimax) return ['reference']
  if (model.seedance25) return ['frames', 'reference', 'edit', 'extend']
  return ['frames', 'reference']
}

function mediaLimit(model, mode, kind) {
  if (mode === 'image') return kind === 'image' ? 1 : 0
  if (mode === 'frames') return kind === 'image' ? 2 : 0
  if (mode === 'edit' || mode === 'extend') return kind === 'video' ? 1 : 0
  if (mode === 'reference') {
    if (model.minimax) return kind === 'image' ? 9 : 0
    return kind === 'image' ? (model.seedance25 ? 30 : 9) : (model.seedance25 ? 10 : 0)
  }
  return 0
}

function referenceLabel(mode, item, index) {
  if (mode === 'frames') return index === 0 ? '首帧' : '尾帧'
  if (mode === 'edit' || mode === 'extend') return '源视频'
  return item.kind === 'video' ? `视频 ${index + 1}` : `图片 ${index + 1}`
}

function VideoSelect({ value, options, onChange, label }) {
  const [open, setOpen] = useState(false)
  const selectRef = useRef(null)
  const selected = options.find((item) => item.value === value) || options[0]

  useEffect(() => {
    function closeIfOutside(event) {
      if (!selectRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeIfOutside)
    return () => document.removeEventListener('pointerdown', closeIfOutside)
  }, [])

  return <div className={`video-select${open ? ' is-open' : ''}`} ref={selectRef}>
    <button type="button" className="video-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{selected?.label}</span><i/></button>
    {open && <div className="video-select-menu" role="listbox" aria-label={label}>{options.map((item) => <button type="button" role="option" aria-selected={item.value === value} className={item.value === value ? 'selected' : ''} key={item.value} onClick={() => { onChange(item.value); setOpen(false) }}>{item.label}</button>)}</div>}
  </div>
}

export default function VideoStudio() {
  const [tasks, setTasks] = useState([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [references, setReferences] = useState([])
  const [model, setModel] = useState(MODELS[0].value)
  const [referenceMode, setReferenceMode] = useState('reference')
  const [resolution, setResolution] = useState('720p')
  const [duration, setDuration] = useState(4)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [error, setError] = useState('')
  const imageRef = useRef(null)
  const videoRef = useRef(null)
  const resultsRef = useRef(null)
  const selectedModel = MODELS.find((item) => item.value === model) || MODELS[0]
  const modes = availableModes(selectedModel)
  const aspectRatios = useMemo(() => selectedModel.aspectRatios || STANDARD_ASPECT_RATIOS, [selectedModel])
  const locksAspectRatio = ['frames', 'edit', 'extend'].includes(referenceMode) && !selectedModel.minimax
  const locksDuration = referenceMode === 'edit' && selectedModel.seedance25
  const durationMin = selectedModel.minimax ? 1 : 4
  const durationMax = selectedModel.minimax && resolution === '1080p' ? 10 : selectedModel.maximum
  const images = references.filter((item) => item.kind === 'image')
  const videos = references.filter((item) => item.kind === 'video')

  useEffect(() => {
    void listVideoTasks().then((result) => {
      setTasks([...(result.tasks || [])].reverse())
      window.requestAnimationFrame(() => {
        if (resultsRef.current) resultsRef.current.scrollTop = resultsRef.current.scrollHeight
      })
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoadingTasks(false))
  }, [])

  useEffect(() => {
    if (!modes.includes(referenceMode)) { setReferenceMode('reference'); setReferences([]) }
    if (!selectedModel.resolutions.includes(resolution)) setResolution(selectedModel.resolutions.includes('720p') ? '720p' : selectedModel.resolutions[0])
    if (!aspectRatios.some((item) => item.value === aspectRatio)) setAspectRatio(aspectRatios[0].value)
    if (duration < durationMin) setDuration(durationMin)
    if (duration > durationMax) setDuration(durationMax)
    if (locksAspectRatio) setAspectRatio('adaptive')
    if (locksDuration) setDuration(-1)
  }, [aspectRatio, aspectRatios, duration, durationMax, durationMin, locksAspectRatio, locksDuration, modes, referenceMode, resolution, selectedModel])

  useEffect(() => {
    const activeTaskIds = tasks.filter((task) => ACTIVE.has(task.status) && !String(task.id).startsWith('local-')).map((task) => task.id)
    if (!activeTaskIds.length) return undefined
    const timer = window.setTimeout(async () => {
      const updates = await Promise.all(activeTaskIds.map(async (id) => {
        try {
          return [id, { ...await getVideoTask(id) }]
        } catch (requestError) {
          // A provider status request can occasionally time out while the
          // generation continues upstream. Keep polling in that case instead
          // of incorrectly marking an otherwise live task as failed.
          if ([0, 502, 503, 504].includes(requestError.status)) return [id, null]
          return [id, { status: 'FAILED', error: requestError.message }]
        }
      }))
      const byId = new Map(updates)
      setTasks((current) => current.map((task) => byId.get(task.id) ? { ...task, ...byId.get(task.id) } : task))
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [tasks])

  async function appendImages(files) {
    const room = mediaLimit(selectedModel, referenceMode, 'image') - images.length
    const valid = Array.from(files || []).filter(isSupportedImageFile).slice(0, Math.max(0, room))
    if (!valid.length) return
    try {
      const next = await Promise.all(valid.map(async (file) => {
        const prepared = await compressImageForUpload(file)
        return { name: prepared.name, src: await fileToDataUrl(prepared), kind: 'image' }
      }))
      setReferences((current) => [...current, ...next]); setError('')
    } catch (uploadError) { setError(uploadError.message || '图片读取失败') }
  }

  async function appendVideos(files) {
    const room = mediaLimit(selectedModel, referenceMode, 'video') - videos.length
    const valid = Array.from(files || []).filter((file) => VIDEO_FILE_TYPES.has(file.type)).slice(0, Math.max(0, room))
    if (!valid.length) { setError('请上传 MP4、MOV 或 WebM 视频文件'); return }
    const oversized = valid.find((file) => file.size > 200 * 1024 * 1024)
    if (oversized) { setError('单个参考视频不能超过 200MB'); return }
    try {
      const next = await Promise.all(valid.map(async (file) => ({ name: file.name, src: await fileToDataUrl(file), kind: 'video' })))
      setReferences((current) => [...current, ...next]); setError('')
    } catch (uploadError) { setError(uploadError.message || '视频读取失败') }
  }

  function selectMode(nextMode) { setReferenceMode(nextMode); setReferences([]); setError('') }

  function scrollToLatestTask() {
    window.requestAnimationFrame(() => {
      if (resultsRef.current) resultsRef.current.scrollTo({ top: resultsRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  async function submit() {
    if (!prompt.trim()) return
    if (referenceMode === 'image' && images.length !== 1) { setError('请添加一张首帧图片'); return }
    if (referenceMode === 'frames' && !images.length) { setError('请至少添加一张首帧图片'); return }
    if (['edit', 'extend'].includes(referenceMode) && !videos.length) { setError('视频编辑和视频延长都需要上传一段源视频'); return }
    const request = { prompt: prompt.trim(), model, resolution, duration, aspectRatio: locksAspectRatio ? 'adaptive' : aspectRatio, referenceMode, references: [...references] }
    const optimistic = { id: `local-${Date.now()}`, prompt: request.prompt, model, resolution, durationSeconds: request.duration, aspectRatio: request.aspectRatio, referenceMode, referenceImages: images.map((item) => item.src), referenceVideos: videos.map((item) => item.src), status: 'PENDING', createdAt: Date.now() }
    setTasks((current) => [...current, optimistic]); scrollToLatestTask(); setError(''); setPrompt(''); setReferences([])
    try {
      const uploaded = await Promise.all(request.references.map(async (reference) => ({ ...reference, url: (await uploadVideoReference({ source: reference.src })).url })))
      const uploadedImages = uploaded.filter((item) => item.kind === 'image').map((item) => item.url)
      const uploadedVideos = uploaded.filter((item) => item.kind === 'video').map((item) => item.url)
      const payload = { model: request.model, prompt: request.prompt, resolution: request.resolution, durationSeconds: request.duration, aspectRatio: request.aspectRatio, referenceMode: request.referenceMode, referenceImageUrls: uploadedImages, referenceVideoUrls: uploadedVideos }
      if (request.referenceMode === 'image') payload.imageUrl = uploadedImages[0]
      if (request.referenceMode === 'frames') { payload.firstFrameImageUrl = uploadedImages[0]; payload.lastFrameImageUrl = uploadedImages[1] }
      if (selectedModel.seedance25 && (request.referenceMode !== 'reference' || request.references.length)) payload.omniReferenceTaskType = request.referenceMode === 'reference' ? 'reference' : request.referenceMode
      const created = await createVideoTask(payload)
      setTasks((current) => current.map((task) => task.id === optimistic.id ? { ...optimistic, id: created.taskId, status: created.status || 'PENDING', referenceImages: uploadedImages, referenceVideos: uploadedVideos, videoUrl: created.videoUrl || '', error: created.error || '' } : task))
    } catch (requestError) {
      setTasks((current) => current.map((task) => task.id === optimistic.id ? { ...task, status: 'FAILED', error: requestError.message } : task))
    }
  }

  function reorderReferences(from, to) {
    setReferences((current) => { const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next })
  }

  return <section className="workspace video-waterfall-workspace">
    <div className="video-waterfall-results" ref={resultsRef}>
      {loadingTasks ? <div className="waterfall-initial-loading" aria-label="加载视频任务"><i/><i/><i/></div> : tasks.length === 0 ? <div className="waterfall-empty"><b>开始你的第一段视频创作</b><span>选择参考方式，添加素材后生成任务会显示在这里。</span></div> : <div className="video-waterfall-list">{tasks.map((task) => <article className="video-waterfall-task" key={task.id}><header><div className="video-waterfall-task-info"><b>{task.prompt}</b><small>{task.model ? `${MODELS.find((item) => item.value === task.model)?.label || task.model} · ${REFERENCE_MODES[task.referenceMode]?.label || '纯文本'} · ${task.aspectRatio} · ${task.resolution} · ${task.durationSeconds === -1 ? '自动时长' : `${task.durationSeconds}秒`}` : '正在提交任务'}</small></div><span className={task.status === 'FAILED' ? 'failed' : ACTIVE.has(task.status) ? 'running' : ''}>{taskStatus(task)}</span></header>{(task.referenceImages?.length > 0 || task.referenceVideos?.length > 0) && <div className="video-waterfall-references">{task.referenceImages?.map((url, index) => <img src={url} alt={`参考图 ${index + 1}`} key={`${url}-${index}`}/>)}{task.referenceVideos?.map((url, index) => <video muted preload="metadata" src={url} aria-label={`参考视频 ${index + 1}`} key={`${url}-${index}`}/>)}</div>}{ACTIVE.has(task.status) && <div className="video-waterfall-pending"><div className="bubble-loader" aria-label="视频生成中"><i/><i/><i/></div></div>}{task.videoUrl && <video controls src={task.videoUrl}/>}</article>)}</div>}
    </div>
    <div className="waterfall-composer-wrap">
      {modes.length > 0 && <div className="reference-mode-picker" aria-label="参考方式">{modes.map((mode) => <button type="button" key={mode} className={referenceMode === mode ? 'selected' : ''} onClick={() => selectMode(mode)}>{REFERENCE_MODES[mode].label}</button>)}</div>}
      <div className="composer waterfall-composer glass-strong">
        {references.length > 0 && <div className="reference-strip sortable-reference-strip video-reference-strip" aria-label="视频参考素材，拖动可调整顺序">{references.map((item, index) => <div key={`${item.name}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(from) && from !== index) reorderReferences(from, index) }}><button type="button" className="reference-preview">{item.kind === 'video' ? <video muted preload="metadata" src={item.src}/> : <img src={item.src} alt="参考图"/>}</button><span className="reference-order">{referenceLabel(referenceMode, item, index)}</span><button type="button" className="reference-remove" onClick={() => setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="移除参考素材"><Icon name="x" size={13}/></button></div>)}</div>}
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} placeholder={referenceMode === 'edit' ? '描述要怎样编辑源视频，例如：将背景换成雨夜，同时保留人物动作和运镜…' : referenceMode === 'extend' ? '描述接下来的视频内容，例如：从视频 1 的结尾继续，人物走进车站…' : '描述你想生成的视频…'} rows="2"/>
        <div className="composer-tools"><div className="tool-group">{mediaLimit(selectedModel, referenceMode, 'image') > images.length && <><button className="tool-button reference-add" type="button" onClick={() => imageRef.current?.click()} aria-label="添加图片参考"><Icon name="image" size={17}/></button><input ref={imageRef} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void appendImages(event.target.files); event.target.value = '' }}/></>}{mediaLimit(selectedModel, referenceMode, 'video') > videos.length && <><button className="tool-button reference-add video-reference-add" type="button" onClick={() => videoRef.current?.click()} aria-label="添加视频参考"><Icon name="video" size={17}/></button><input ref={videoRef} hidden type="file" accept="video/mp4,video/quicktime,video/webm" multiple onChange={(event) => { void appendVideos(event.target.files); event.target.value = '' }}/></>}<VideoSelect label="视频模型" value={model} onChange={setModel} options={MODELS.map((item) => ({ value: item.value, label: item.label }))}/>{locksAspectRatio ? <span className="video-locked-setting">自适应画幅</span> : <VideoSelect label="视频画幅" value={aspectRatio} onChange={setAspectRatio} options={aspectRatios}/>}<VideoSelect label="视频清晰度" value={resolution} onChange={setResolution} options={selectedModel.resolutions.map((item) => ({ value: item, label: item }))}/>{locksDuration ? <span className="video-locked-setting">自动时长</span> : <label className="video-duration-control"><input type="range" min={durationMin} max={durationMax} step="1" value={duration} onChange={(event) => setDuration(Number(event.target.value))} aria-label="视频时长"/><output>{duration}秒</output></label>}</div><button className="send-button" type="button" onClick={() => void submit()} disabled={!prompt.trim()} aria-label="生成视频"><Icon name="arrowUp" size={18}/></button></div>
      </div>{error && <small className="composer-note error">{error}</small>}
    </div>
  </section>
}
