import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import './logoTool.css'

const OUTPUT_SIZE = 240
const DEFAULT_CONTENT_SIZE = 184

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片无法读取，请换一张 PNG、JPG、WebP 或 SVG 文件'))
    image.src = source
  })
}

export default function LogoTool() {
  const canvasRef = useRef(null)
  const uploadRef = useRef(null)
  const dragRef = useRef(null)
  const imageUrlRef = useRef('')
  const [logo, setLogo] = useState(null)
  const [fitScale, setFitScale] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: OUTPUT_SIZE / 2, y: OUTPUT_SIZE / 2 })
  const [error, setError] = useState('')

  const scale = fitScale * zoom

  useEffect(() => () => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    if (!logo) return
    const width = logo.naturalWidth * scale
    const height = logo.naturalHeight * scale
    context.drawImage(logo, position.x - width / 2, position.y - height / 2, width, height)
  }, [logo, position, scale])

  async function selectLogo(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
      setError('请上传 PNG、JPG、WebP 或 SVG 图片文件')
      return
    }
    try {
      const url = URL.createObjectURL(file)
      const image = await loadImage(url)
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效，请换一张图片重试')
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = url
      setLogo(image)
      setFitScale(Math.min(1, DEFAULT_CONTENT_SIZE / Math.max(image.naturalWidth, image.naturalHeight)))
      setZoom(1)
      setPosition({ x: OUTPUT_SIZE / 2, y: OUTPUT_SIZE / 2 })
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  function pointFromEvent(event) {
    const bounds = canvasRef.current.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * OUTPUT_SIZE / bounds.width,
      y: (event.clientY - bounds.top) * OUTPUT_SIZE / bounds.height,
    }
  }

  function beginDrag(event) {
    if (!logo || !canvasRef.current) return
    const point = pointFromEvent(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, offsetX: point.x - position.x, offsetY: point.y - position.y }
  }

  function moveLogo(event) {
    if (!dragRef.current || !canvasRef.current) return
    const point = pointFromEvent(event)
    setPosition({ x: point.x - dragRef.current.offsetX, y: point.y - dragRef.current.offsetY })
  }

  function stopDrag(event) {
    const drag = dragRef.current
    if (!drag) return
    try { event.currentTarget.releasePointerCapture(drag.pointerId) } catch { /* A pointer may finish outside the window. */ }
    dragRef.current = null
  }

  function reset() {
    setZoom(1)
    setPosition({ x: OUTPUT_SIZE / 2, y: OUTPUT_SIZE / 2 })
  }

  function download() {
    const canvas = canvasRef.current
    if (!canvas || !logo) return
    canvas.toBlob((blob) => {
      if (!blob) return setError('图片导出失败，请重试')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'logo-240x240.png'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }, 'image/png')
  }

  return <section className="workspace logo-tool-workspace">
    <div className="logo-tool-page more-tool-page">
      <header className="logo-tool-heading more-tool-heading">
        <span>LOGO PROCESSING</span>
        <h1>Logo 处理</h1>
        <p>上传 Logo 后自动居中，调整位置和缩放，导出 240 × 240 白底 PNG。</p>
      </header>

      <div className="logo-tool-layout">
        <main className="logo-preview-panel glass-strong">
          <div className={`logo-canvas-wrap${logo ? ' has-logo' : ''}`}>
            <canvas ref={canvasRef} width={OUTPUT_SIZE} height={OUTPUT_SIZE} aria-label="Logo 输出预览" onPointerDown={beginDrag} onPointerMove={moveLogo} onPointerUp={stopDrag} onPointerCancel={stopDrag}/>
            {!logo && <button className="logo-empty-upload" type="button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={20}/><b>上传 Logo</b><small>PNG、JPG、WebP 或 SVG</small></button>}
          </div>
          <p className="logo-preview-note">{logo ? '拖动 Logo 调整位置' : '输出画布：240 × 240，白色背景'}</p>
        </main>

        <aside className="logo-tool-controls glass-strong">
          <div className="logo-control-heading"><b>{logo ? '调整 Logo' : '上传 Logo'}</b><small>{logo ? '已自动置于画布中心' : '建议上传清晰、留白适中的 Logo'}</small></div>
          <input ref={uploadRef} className="logo-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={selectLogo}/>
          <button className="logo-upload-button" type="button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={16}/>{logo ? '更换 Logo' : '选择图片'}</button>

          <label className="logo-scale-control">
            <span><b>缩放</b><output>{Math.round(zoom * 100)}%</output></span>
            <input aria-label="Logo 缩放" type="range" min="0.1" max="3" step="0.01" value={zoom} disabled={!logo} onChange={(event) => setZoom(Number(event.target.value))}/>
          </label>

          <div className="logo-output-info"><span>输出格式</span><b>240 × 240 PNG</b><small>白色背景</small></div>
          {error && <div className="logo-error" role="alert">{error}</div>}
          <div className="logo-actions"><button className="logo-reset-button" type="button" disabled={!logo} onClick={reset}>还原位置</button><button className="logo-download-button" type="button" disabled={!logo} onClick={download}><Icon name="download" size={16}/>下载 PNG</button></div>
        </aside>
      </div>
    </div>
  </section>
}
