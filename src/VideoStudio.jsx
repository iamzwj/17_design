import { useEffect, useMemo, useRef, useState } from 'react'
import { createVideoTask, fileToDataUrl, getVideoTask, listVideoTasks, uploadVideoReference } from './api.js'
import { Icon } from './icons.jsx'
import { compressImageForUpload, isSupportedImageFile } from './imageUpload.js'

const MODELS = [
  { value: 'minimax-h3', label: 'MiniMax H3', resolutions: ['480p', '768p', '1080p'], maximum: 15, aspectRatios: [{ value: 'landscape', label: '横屏' }, { value: 'portrait', label: '竖屏' }, { value: 'square', label: '方屏' }] },
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast', resolutions: ['480p', '720p'], maximum: 15 },
  { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0', resolutions: ['480p', '720p', '1080p', '4k'], maximum: 15 },
  { value: 'doubao-seedance-2-0-mini-260615', label: 'Seedance 2.0 Mini', resolutions: ['480p', '720p'], maximum: 15 },
  { value: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5', resolutions: ['480p', '720p', '1080p'], maximum: 30 },
]

const ACTIVE = new Set(['PENDING', 'RUNNING'])
const STANDARD_ASPECT_RATIOS = [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' }, { value: '3:4', label: '3:4' }, { value: '21:9', label: '21:9' }]

function taskStatus(task) {
  if (task.status === 'PENDING') return '等待视频服务响应…'
  if (task.status === 'RUNNING') return '正在生成视频…'
  if (task.status === 'COMPLETED') return '视频已生成'
  return task.error || '视频生成失败'
}

export default function VideoStudio() {
  const [tasks, setTasks] = useState([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [references, setReferences] = useState([])
  const [model, setModel] = useState(MODELS[0].value)
  const [resolution, setResolution] = useState('720p')
  const [duration, setDuration] = useState(4)
  const [aspectRatio, setAspectRatio] = useState('landscape')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const selectedModel = MODELS.find((item) => item.value === model) || MODELS[0]
  const aspectRatios = useMemo(() => selectedModel.aspectRatios || STANDARD_ASPECT_RATIOS, [selectedModel])

  useEffect(() => {
    void listVideoTasks().then((result) => setTasks(result.tasks || [])).catch((requestError) => setError(requestError.message)).finally(() => setLoadingTasks(false))
  }, [])

  useEffect(() => {
    if (!selectedModel.resolutions.includes(resolution)) setResolution(selectedModel.resolutions.at(-1))
    if (!aspectRatios.some((item) => item.value === aspectRatio)) setAspectRatio(aspectRatios[0].value)
    if (duration > selectedModel.maximum) setDuration(selectedModel.maximum)
    if (model === 'minimax-h3' && resolution === '1080p' && duration > 10) setDuration(10)
  }, [aspectRatio, aspectRatios, duration, model, resolution, selectedModel])

  useEffect(() => {
    const activeTask = tasks.find((task) => ACTIVE.has(task.status) && !String(task.id).startsWith('local-'))
    if (!activeTask) return undefined
    const timer = window.setTimeout(async () => {
      try {
        const next = await getVideoTask(activeTask.id)
        setTasks((current) => current.map((task) => task.id === activeTask.id ? { ...task, ...next } : task))
      } catch (requestError) {
        setTasks((current) => current.map((task) => task.id === activeTask.id ? { ...task, status: 'FAILED', error: requestError.message } : task))
      }
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [tasks])

  async function appendReferences(files) {
    const valid = Array.from(files || []).filter(isSupportedImageFile).slice(0, 4 - references.length)
    if (!valid.length) return
    try {
      const next = await Promise.all(valid.map(async (file) => {
        const prepared = await compressImageForUpload(file)
        return { name: prepared.name, src: await fileToDataUrl(prepared) }
      }))
      setReferences((current) => [...current, ...next].slice(0, 4)); setError('')
    } catch (uploadError) { setError(uploadError.message || '图片读取失败') }
  }

  async function submit() {
    if (!prompt.trim() || submitting) return
    const request = { prompt: prompt.trim(), model, resolution, duration, aspectRatio, references: [...references] }
    const optimistic = { id: `local-${Date.now()}`, prompt: request.prompt, model, resolution, durationSeconds: duration, aspectRatio, referenceImages: request.references.map((item) => item.src), status: 'PENDING', createdAt: Date.now() }
    setTasks((current) => [optimistic, ...current]); setSubmitting(true); setError(''); setPrompt(''); setReferences([])
    try {
      const uploaded = await Promise.all(request.references.map(async (reference) => (await uploadVideoReference({ source: reference.src })).url))
      const created = await createVideoTask({ model: request.model, prompt: request.prompt, resolution: request.resolution, durationSeconds: request.duration, aspectRatio: request.aspectRatio, referenceImageUrls: uploaded })
      setTasks((current) => current.map((task) => task.id === optimistic.id ? { ...optimistic, id: created.taskId, status: created.status || 'PENDING', referenceImages: uploaded, videoUrl: created.videoUrl || '', error: created.error || '' } : task))
    } catch (requestError) {
      setTasks((current) => current.map((task) => task.id === optimistic.id ? { ...task, status: 'FAILED', error: requestError.message } : task))
    } finally { setSubmitting(false) }
  }

  function reorderReferences(from, to) {
    setReferences((current) => { const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next })
  }

  return <section className="workspace video-waterfall-workspace">
    <div className="video-waterfall-results">
      {loadingTasks ? <div className="waterfall-initial-loading" aria-label="加载视频任务"><i/><i/><i/></div> : tasks.length === 0 ? <div className="waterfall-empty"><b>开始你的第一段视频创作</b><span>输入提示词并添加参考图，生成任务会显示在这里。</span></div> : <div className="video-waterfall-list">{tasks.map((task) => <article className="video-waterfall-task" key={task.id}><header><div className="video-waterfall-task-info"><b>{task.prompt}</b><small>{task.model ? `${MODELS.find((item) => item.value === task.model)?.label || task.model} · ${task.aspectRatio} · ${task.resolution} · ${task.durationSeconds}秒` : '正在提交任务'}</small></div><span className={task.status === 'FAILED' ? 'failed' : ACTIVE.has(task.status) ? 'running' : ''}>{taskStatus(task)}</span></header>{task.referenceImages?.length > 0 && <div className="video-waterfall-references">{task.referenceImages.map((url, index) => <img src={url} alt={`参考图 ${index + 1}`} key={`${url}-${index}`}/>)}</div>}{ACTIVE.has(task.status) && <div className="video-waterfall-pending"><div className="bubble-loader" aria-label="视频生成中"><i/><i/><i/></div></div>}{task.videoUrl && <video controls src={task.videoUrl}/>}</article>)}</div>}
    </div>
    <div className="waterfall-composer-wrap">
      <div className="composer waterfall-composer glass-strong"><div className="video-waterfall-composer-title"><Icon name="video" size={16}/><b>视频生成</b></div>{references.length > 0 && <div className="reference-strip sortable-reference-strip" aria-label="视频参考图，拖动可调整顺序">{references.map((item, index) => <div key={`${item.name}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(from) && from !== index) reorderReferences(from, index) }}><button type="button" className="reference-preview"><img src={item.src} alt="参考图"/></button><span className="reference-order">{index + 1}</span><button type="button" className="reference-remove" onClick={() => setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="移除参考图"><Icon name="x" size={13}/></button></div>)}</div>}<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} placeholder="描述你想生成的视频…" rows="2"/><div className="composer-tools"><div className="tool-group"><button className="tool-button reference-add" type="button" onClick={() => fileRef.current?.click()} disabled={references.length >= 4}><Icon name="plus" size={18}/></button><input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void appendReferences(event.target.files); event.target.value = '' }}/><select className="image-model-select video-model-select" value={model} onChange={(event) => setModel(event.target.value)}>{MODELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select className="image-model-select" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{aspectRatios.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select className="image-model-select" value={resolution} onChange={(event) => setResolution(event.target.value)}>{selectedModel.resolutions.map((item) => <option key={item}>{item}</option>)}</select><select className="image-model-select" value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{[1, 2, 3, 4, 5, 8, 10, 12, 15, 20, 30].filter((item) => item <= selectedModel.maximum && !(model === 'minimax-h3' && resolution === '1080p' && item > 10)).map((item) => <option key={item} value={item}>{item}秒</option>)}</select></div><button className="send-button" type="button" onClick={() => void submit()} disabled={!prompt.trim() || submitting} aria-label="生成视频"><Icon name="arrowUp" size={18}/></button></div></div>{error && <small className="composer-note error">{error}</small>}</div>
  </section>
}
