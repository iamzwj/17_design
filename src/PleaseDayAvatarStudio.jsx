import { useEffect, useRef, useState } from 'react'
import { getPleaseDayAvatarDownloadCount, recordPleaseDayAvatarDownload } from './api.js'
import { Icon } from './icons.jsx'
import './pleaseDayAvatar.css'

const FRAME_URL = '/please-day-avatar-frame.png'
const OUTPUT_SIZE = 850

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片无法读取，请换一张图片重试'))
    image.src = source
  })
}

export default function PleaseDayAvatarStudio() {
  const canvasRef = useRef(null)
  const uploadRef = useRef(null)
  const dragRef = useRef(null)
  const avatarUrlRef = useRef('')
  const [frameOverlay, setFrameOverlay] = useState(null)
  const [avatar, setAvatar] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [error, setError] = useState('')
  const [downloadCount, setDownloadCount] = useState(null)

  useEffect(() => {
    let active = true
    const refreshCount = async () => {
      try {
        const { count } = await getPleaseDayAvatarDownloadCount()
        if (active) setDownloadCount(Number.isFinite(Number(count)) ? Number(count) : 0)
      } catch { /* The editor remains available when the public counter is temporarily unavailable. */ }
    }
    void refreshCount()
    const timer = window.setInterval(refreshCount, 15_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    let available = true
    loadImage(FRAME_URL).then((image) => {
      if (available) setFrameOverlay(image)
    }).catch((loadError) => available && setError(loadError.message))
    return () => { available = false }
  }, [])

  useEffect(() => () => {
    if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frameOverlay) return
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const context = canvas.getContext('2d')
    context.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    if (avatar) {
      const baseScale = Math.max(OUTPUT_SIZE / avatar.naturalWidth, OUTPUT_SIZE / avatar.naturalHeight)
      const drawWidth = avatar.naturalWidth * baseScale * zoom
      const drawHeight = avatar.naturalHeight * baseScale * zoom
      const x = (OUTPUT_SIZE - drawWidth) / 2 + offset.x
      const y = (OUTPUT_SIZE - drawHeight) / 2 + offset.y
      context.drawImage(avatar, x, y, drawWidth, drawHeight)
    }
    context.drawImage(frameOverlay, 0, 0)
  }, [avatar, frameOverlay, offset, zoom])

  async function selectAvatar(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('请上传 PNG、JPG、WebP 等图片文件')
      return
    }
    try {
      const url = URL.createObjectURL(file)
      const image = await loadImage(url)
      if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)
      avatarUrlRef.current = url
      setAvatar(image)
      setZoom(1)
      setOffset({ x: 0, y: 0 })
      setError('')
    } catch (loadError) { setError(loadError.message) }
  }

  function beginDrag(event) {
    if (!avatar || !canvasRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset }
  }

  function moveAvatar(event) {
    const drag = dragRef.current
    const canvas = canvasRef.current
    if (!drag || !canvas) return
    const bounds = canvas.getBoundingClientRect()
    const scale = OUTPUT_SIZE / bounds.width
    setOffset({ x: drag.offset.x + (event.clientX - drag.x) * scale, y: drag.offset.y + (event.clientY - drag.y) * scale })
  }

  function stopDrag(event) {
    if (!dragRef.current) return
    try { event.currentTarget.releasePointerCapture(dragRef.current.pointerId) } catch { /* Pointer can end outside the browser. */ }
    dragRef.current = null
  }

  function adjustZoom(nextZoom) {
    setZoom(Math.max(.7, Math.min(3.5, nextZoom)))
  }

  function download() {
    const canvas = canvasRef.current
    if (!canvas || !avatar) return
    canvas.toBlob((blob) => {
      if (!blob) return setError('图片导出失败，请重试')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = '朴里节头像.png'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      void recordPleaseDayAvatarDownload().then(({ count }) => {
        if (Number.isFinite(Number(count))) setDownloadCount(Number(count))
      }).catch(() => {})
    }, 'image/png')
  }

  return <section className="workspace please-day-workspace">
    <div className="please-day-page more-tool-page">
      <header className="please-day-heading more-tool-heading">
        <span>PLEASE DAY</span>
        <h1>朴里节头像框</h1>
        <p>上传头像，调整位置和大小，即可生成活动头像。</p>
      </header>
      <div className="please-day-layout">
        <main className="please-day-preview glass-strong">
          <div className={`please-day-canvas-wrap ${avatar ? 'has-avatar' : ''}`}>
            <canvas ref={canvasRef} aria-label="朴里节头像预览" onPointerDown={beginDrag} onPointerMove={moveAvatar} onPointerUp={stopDrag} onPointerCancel={stopDrag} onWheel={(event) => { if (!avatar) return; event.preventDefault(); adjustZoom(zoom - event.deltaY * .001) }}/>
            {!avatar && <button className="please-day-empty" type="button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={20}/><b>上传头像</b></button>}
          </div>
          {avatar && <div className="please-day-editor-bar">
              <div><b>缩放与定位</b><small>拖动图片调整位置，滑动调节大小</small></div>
              <div className="please-day-zoom">
                <button type="button" aria-label="缩小头像" onClick={() => adjustZoom(zoom - .1)}>−</button>
                <input aria-label="头像缩放" type="range" min="0.7" max="3.5" step="0.01" value={zoom} onChange={(event) => adjustZoom(Number(event.target.value))}/>
                <button type="button" aria-label="放大头像" onClick={() => adjustZoom(zoom + .1)}>＋</button>
              </div>
              <div className="please-day-reset-row"><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }}>还原位置</button></div>
            </div>
          }
          {error && <div className="please-day-error">{error}</div>}
          <input ref={uploadRef} className="please-day-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={selectAvatar}/>
          <button className="please-day-download" type="button" disabled={!avatar || !frameOverlay} onClick={download}><Icon name="download" size={17}/>下载头像</button>
        </main>
        <aside className="please-day-stat" aria-live="polite">
          <span className="please-day-stat-label">朴里节头像已生成</span>
          <div className="please-day-stat-value"><strong>{downloadCount === null ? '—' : downloadCount.toLocaleString('zh-CN')}</strong><em>次</em></div>
        </aside>
      </div>
    </div>
  </section>
}
