import { useEffect, useMemo, useRef, useState } from 'react'
import { createVideoTask, fileToDataUrl, generateImage, generateText, getVideoTask, uploadVideoReference } from './api.js'
import { Icon } from './icons.jsx'
import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_RESOLUTION } from './imageModels.js'
import { compressImageForUpload, isSupportedImageFile } from './imageUpload.js'

const VIDEO_MODELS = [
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast', resolutions: ['480p', '720p'], maximum: 15 },
  { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0', resolutions: ['480p', '720p', '1080p', '4k'], maximum: 15 },
  { value: 'doubao-seedance-2-0-mini-260615', label: 'Seedance 2.0 Mini', resolutions: ['480p', '720p'], maximum: 15 },
  { value: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5', resolutions: ['480p', '720p', '1080p'], maximum: 30 },
]

function statusText(status) {
  return ({ PENDING: '已提交，等待生成', RUNNING: '正在生成视频', COMPLETED: '视频已生成', FAILED: '生成失败' })[status] || ''
}

export default function VideoStudio() {
  const [scriptPrompt, setScriptPrompt] = useState('')
  const [script, setScript] = useState('')
  const [scriptLoading, setScriptLoading] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const [imageReferences, setImageReferences] = useState([])
  const [imageUrls, setImageUrls] = useState([])
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [model, setModel] = useState(VIDEO_MODELS[0].value)
  const [resolution, setResolution] = useState('720p')
  const [duration, setDuration] = useState(4)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [videoPrompt, setVideoPrompt] = useState('')
  const [videoReferences, setVideoReferences] = useState([])
  const [task, setTask] = useState({ status: 'idle', id: '', url: '', error: '' })
  const scriptFileRef = useRef(null)
  const videoFileRef = useRef(null)
  const selectedModel = useMemo(() => VIDEO_MODELS.find((item) => item.value === model) || VIDEO_MODELS[0], [model])

  useEffect(() => {
    const nextResolution = selectedModel.resolutions.includes(resolution) ? resolution : selectedModel.resolutions.at(-1)
    setResolution(nextResolution)
    if (duration > selectedModel.maximum) setDuration(selectedModel.maximum)
  }, [selectedModel, resolution, duration])

  useEffect(() => {
    if (!task.id || !['PENDING', 'RUNNING'].includes(task.status)) return undefined
    const timer = window.setTimeout(async () => {
      try {
        const next = await getVideoTask(task.id)
        setTask({ status: next.status, id: task.id, url: next.videoUrl || '', error: next.error || '' })
      } catch (error) {
        setTask((current) => ({ ...current, status: 'FAILED', error: error.message || '视频状态读取失败' }))
      }
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [task.id, task.status])

  async function addReferences(files, setReferences) {
    const supported = Array.from(files || []).filter(isSupportedImageFile).slice(0, 4)
    if (!supported.length) return
    const next = await Promise.all(supported.map(async (file) => {
      const prepared = await compressImageForUpload(file)
      return { name: prepared.name, src: await fileToDataUrl(prepared) }
    }))
    setReferences((current) => [...current, ...next].slice(0, 4))
  }

  async function createScript() {
    if (!scriptPrompt.trim() || scriptLoading) return
    setScriptLoading(true)
    try {
      const result = await generateText({
        systemPrompt: '你是专业视频创作策划。基于用户的灵感，输出可直接用于视频生成的中文脚本：剧情梗概、人物角色、场景描述、分镜动作和一段精炼的视频提示词。使用清晰的小标题。',
        messages: [{ role: 'user', content: scriptPrompt.trim() }],
        webSearch: false,
      })
      setScript(result.content || '')
      setImagePrompt((current) => current || result.content || '')
      setVideoPrompt((current) => current || result.content || '')
    } catch (error) { setScript(`生成失败：${error.message}`) } finally { setScriptLoading(false) }
  }

  async function createImages() {
    if (!imagePrompt.trim() || imageLoading) return
    setImageLoading(true); setImageError('')
    try {
      const result = await generateImage({ prompt: imagePrompt.trim(), images: imageReferences.map((item) => item.src), aspectRatio, model: DEFAULT_IMAGE_MODEL, resolution: DEFAULT_IMAGE_RESOLUTION })
      setImageUrls(result.urls || [])
    } catch (error) { setImageUrls([]); setImageError(`图片生成失败：${error.message}`) } finally { setImageLoading(false) }
  }

  async function submitVideo() {
    const prompt = videoPrompt.trim()
    if (!prompt || ['PENDING', 'RUNNING'].includes(task.status)) return
    setTask({ status: 'submitting', id: '', url: '', error: '' })
    try {
      const uploaded = await Promise.all(videoReferences.map(async (reference) => (await uploadVideoReference({ source: reference.src })).url))
      const created = await createVideoTask({ model, prompt, durationSeconds: duration, resolution, aspectRatio, referenceImageUrls: uploaded })
      setTask({ status: created.status || 'PENDING', id: created.taskId, url: '', error: '' })
    } catch (error) { setTask({ status: 'FAILED', id: '', url: '', error: error.message || '视频任务提交失败' }) }
  }

  function ReferenceRow({ items, setItems, inputRef, label }) {
    return <div className="video-studio-references"><span>{label}</span>{items.map((item, index) => <figure key={`${item.name}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); if (!Number.isInteger(from) || from === index) return; setItems((current) => { const next = [...current]; const [moved] = next.splice(from, 1); next.splice(index, 0, moved); return next }) }}><img src={item.src} alt=""/><button type="button" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="移除参考图">×</button></figure>)}<button type="button" className="video-studio-add-reference" onClick={() => inputRef.current?.click()} aria-label="添加参考图"><Icon name="plus" size={16}/></button><input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void addReferences(event.target.files, setItems); event.target.value = '' }}/></div>
  }

  return <section className="video-studio workspace">
    <header className="video-studio-heading"><span>VIDEO CREATION</span><h1>视频生成</h1><p>从灵感、画面到成片，按顺序完成三个创作步骤。</p></header>
    <div className="video-studio-flow" aria-label="视频创作流程">
      <article className="video-studio-card"><div className="video-studio-card-title"><span><Icon name="spark" size={17}/></span><div><b>视频脚本</b><small>GPT-6 Astra</small></div></div><textarea value={scriptPrompt} onChange={(event) => setScriptPrompt(event.target.value)} placeholder="写下一句灵感，例如：雨夜里一只蝴蝶飞进城市…"/><button type="button" className="video-studio-primary" onClick={createScript} disabled={!scriptPrompt.trim() || scriptLoading}>{scriptLoading ? '正在编写…' : '生成脚本'}</button>{script && <div className="video-studio-output">{script}</div>}</article>
      <article className="video-studio-card"><div className="video-studio-card-title"><span className="image"><Icon name="image" size={17}/></span><div><b>图片生成</b><small>GPT Image 2.5 Sunburst · 2K</small></div></div><textarea value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} placeholder="描述需要生成的角色或场景"/><ReferenceRow items={imageReferences} setItems={setImageReferences} inputRef={scriptFileRef} label="参考图"/><button type="button" className="video-studio-primary" onClick={createImages} disabled={!imagePrompt.trim() || imageLoading}>{imageLoading ? '正在生成…' : '生成图片'}</button>{imageError && <p className="video-studio-error">{imageError}</p>}{imageUrls.length > 0 && <div className="video-studio-images">{imageUrls.map((url) => <button type="button" key={url} onClick={() => setVideoReferences((current) => current.some((item) => item.src === url) ? current : [...current, { name: '生成图片', src: url }].slice(0, 4))}><img src={url} alt="生成图片"/></button>)}</div>}</article>
      <article className="video-studio-card"><div className="video-studio-card-title"><span className="video"><Icon name="video" size={17}/></span><div><b>视频生成</b><small>Vibbit Seedance</small></div></div><textarea value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} placeholder="描述视频的主体、动作、镜头和氛围"/><ReferenceRow items={videoReferences} setItems={setVideoReferences} inputRef={videoFileRef} label="参考图"/><div className="video-studio-controls"><select value={model} onChange={(event) => setModel(event.target.value)}>{VIDEO_MODELS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].map((item) => <option key={item}>{item}</option>)}</select><select value={resolution} onChange={(event) => setResolution(event.target.value)}>{selectedModel.resolutions.map((item) => <option key={item}>{item}</option>)}</select><select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{[4, 8, 12, 15, 20, 30].filter((item) => item <= selectedModel.maximum).map((item) => <option value={item} key={item}>{item}秒</option>)}</select></div><button type="button" className="video-studio-primary video" onClick={submitVideo} disabled={!videoPrompt.trim() || ['submitting', 'PENDING', 'RUNNING'].includes(task.status)}>{task.status === 'submitting' ? '正在提交…' : ['PENDING', 'RUNNING'].includes(task.status) ? '正在生成…' : '生成视频'}</button>{task.status !== 'idle' && <p className={task.status === 'FAILED' ? 'video-studio-error' : 'video-studio-status'}>{task.error || statusText(task.status)}</p>}{task.url && <video controls src={task.url}/>}</article>
    </div>
  </section>
}
