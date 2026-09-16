import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { embeddedImagesFromWorkbook } from './excelEmbeddedImages.js'
import { Icon } from './icons.jsx'
import './logoTool.css'

const OUTPUT_SIZE = 240
const DEFAULT_CONTENT_SIZE = 184

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    if (/^https?:\/\//i.test(source)) image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片无法读取，请确认图片文件或链接可访问'))
    image.src = source
  })
}

function fitScale(image) {
  return Math.min(1, DEFAULT_CONTENT_SIZE / Math.max(image.naturalWidth, image.naturalHeight))
}

function drawLogo(canvas, image, scale = fitScale(image), position = { x: OUTPUT_SIZE / 2, y: OUTPUT_SIZE / 2 }) {
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  if (!image) return
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  context.drawImage(image, position.x - width / 2, position.y - height / 2, width, height)
}

function pngBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片导出失败，请重试')), 'image/png'))
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function safeName(value, fallback) {
  const cleaned = String(value || '').replace(/[\\/:*?"<>|]/g, '_').trim().replace(/\.+$/g, '')
  return cleaned || fallback
}

async function imageFromBlob(blob, urls) {
  const url = URL.createObjectURL(blob)
  urls.push(url)
  return loadImage(url)
}

async function readableBatchLogos(file, urls) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const logos = []
  const imageSources = new Set()
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const embedded = await embeddedImagesFromWorkbook(buffer, sheetName, sheet)
    for (const [row, blob] of [...embedded.entries()].sort(([first], [second]) => first - second)) {
      const image = await imageFromBlob(blob, urls)
      logos.push({ id: `${sheetName}-${row}-${logos.length}`, image, label: `${sheetName}-${row}` })
    }
    for (const [cellAddress, cell] of Object.entries(sheet)) {
      if (cellAddress.startsWith('!')) continue
      const source = String(cell?.v || '').trim()
      if (!/^(?:https?:\/\/|data:image\/)/i.test(source) || imageSources.has(source)) continue
      imageSources.add(source)
      try {
        const image = await loadImage(source)
        logos.push({ id: `link-${logos.length}`, image, label: `链接-${logos.length + 1}` })
      } catch { /* Unavailable links are ignored if the workbook has other usable logo images. */ }
    }
  }
  if (!logos.length) throw new Error('未在表格中发现 Logo 图片。请上传含有嵌入图片或图片链接的 .xlsx 表格')
  return logos
}

async function uniqueFileName(directory, filename) {
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ''
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = index ? `${stem}_${index + 1}${extension}` : filename
    try { await directory.getFileHandle(candidate) } catch (error) {
      if (error?.name === 'NotFoundError') return candidate
      throw error
    }
  }
  throw new Error('无法创建不重复的输出文件名')
}

async function saveToFolder(directory, filename, blob) {
  const handle = await directory.getFileHandle(filename, { create: true })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

export default function LogoTool() {
  const canvasRef = useRef(null)
  const uploadRef = useRef(null)
  const dragRef = useRef(null)
  const imageUrlRef = useRef('')
  const batchUrlsRef = useRef([])
  const outputDirectoryRef = useRef(null)
  const [mode, setMode] = useState('single')
  const [logo, setLogo] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: OUTPUT_SIZE / 2, y: OUTPUT_SIZE / 2 })
  const [batchLogos, setBatchLogos] = useState([])
  const [tableName, setTableName] = useState('')
  const [outputFolderName, setOutputFolderName] = useState('')
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState('')

  useEffect(() => () => {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
    batchUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    if (canvasRef.current) drawLogo(canvasRef.current, logo, logo ? fitScale(logo) * zoom : 1, position)
  }, [logo, position, zoom])

  async function selectLogo(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|svg)$/i.test(file.name)) { setError('请上传 PNG、JPG、WebP 或 SVG 图片文件'); return }
    let url = ''
    try {
      url = URL.createObjectURL(file)
      const image = await loadImage(url)
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效，请换一张图片重试')
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = url
      setLogo(image); setZoom(1); setPosition({ x: OUTPUT_SIZE / 2, y: OUTPUT_SIZE / 2 }); setError('')
    } catch (loadError) {
      if (url) URL.revokeObjectURL(url)
      setError(loadError.message)
    }
  }

  async function selectTable(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) { setError('请上传 .xlsx 格式的表格，以识别其中嵌入的 Logo 或图片链接'); return }
    batchUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    batchUrlsRef.current = []
    setBatchLogos([]); setTableName(file.name); setOutputFolderName(''); outputDirectoryRef.current = null; setProgress({ current: 0, total: 0 }); setError('')
    try { setBatchLogos(await readableBatchLogos(file, batchUrlsRef.current)) } catch (loadError) { setError(loadError.message || '表格读取失败') }
  }

  function pointFromEvent(event) {
    const bounds = canvasRef.current.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) * OUTPUT_SIZE / bounds.width, y: (event.clientY - bounds.top) * OUTPUT_SIZE / bounds.height }
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
    try { event.currentTarget.releasePointerCapture(drag.pointerId) } catch { /* The pointer can end outside the browser window. */ }
    dragRef.current = null
  }

  function downloadSingle() {
    if (!canvasRef.current || !logo) return
    pngBlob(canvasRef.current).then((blob) => downloadBlob(blob, 'logo-240x240.png')).catch((downloadError) => setError(downloadError.message))
  }

  async function chooseOutputFolder() {
    if (!window.showDirectoryPicker) { setError('当前浏览器不支持直接保存到文件夹。请使用 Chrome 或 Edge，或下载 ZIP 文件'); return }
    try {
      const directory = await window.showDirectoryPicker({ mode: 'readwrite' })
      outputDirectoryRef.current = directory
      setOutputFolderName(directory.name || '已选择文件夹')
      setError('')
    } catch (folderError) { if (folderError?.name !== 'AbortError') setError('无法访问所选文件夹，请重新选择') }
  }

  async function exportBatch() {
    if (!batchLogos.length || saving) return
    const directory = outputDirectoryRef.current
    setSaving(true); setError(''); setProgress({ current: 0, total: batchLogos.length })
    try {
      const zip = directory ? null : new JSZip()
      for (let index = 0; index < batchLogos.length; index += 1) {
        const item = batchLogos[index]
        const canvas = document.createElement('canvas')
        drawLogo(canvas, item.image)
        const blob = await pngBlob(canvas)
        const baseName = safeName(`logo-${item.label}`, `logo-${String(index + 1).padStart(4, '0')}`)
        if (directory) await saveToFolder(directory, await uniqueFileName(directory, `${baseName}.png`), blob)
        else zip.file(`${baseName}.png`, blob)
        setProgress({ current: index + 1, total: batchLogos.length })
      }
      if (zip) downloadBlob(await zip.generateAsync({ type: 'blob' }), 'logos-240x240.zip')
    } catch (exportError) { setError(exportError.message || '批量导出失败，请重试') }
    finally { setSaving(false) }
  }

  return <section className="workspace logo-tool-workspace">
    <div className="logo-tool-page more-tool-page">
      <header className="logo-tool-heading more-tool-heading"><span>LOGO PROCESSING</span><h1>Logo 处理</h1><p>单个调整后下载，或从表格中批量输出统一的白底 240 × 240 PNG。</p></header>
      <div className="logo-mode-tabs" role="tablist" aria-label="Logo 处理方式"><button type="button" role="tab" aria-selected={mode === 'single'} className={mode === 'single' ? 'active' : ''} onClick={() => { setMode('single'); setError('') }}>单个处理</button><button type="button" role="tab" aria-selected={mode === 'batch'} className={mode === 'batch' ? 'active' : ''} onClick={() => { setMode('batch'); setError('') }}>批量处理</button></div>
      {mode === 'single' ? <div className="logo-tool-layout">
        <main className="logo-preview-panel glass-strong"><div className={`logo-canvas-wrap${logo ? ' has-logo' : ''}`}><canvas ref={canvasRef} width={OUTPUT_SIZE} height={OUTPUT_SIZE} aria-label="Logo 输出预览" onPointerDown={beginDrag} onPointerMove={moveLogo} onPointerUp={stopDrag} onPointerCancel={stopDrag}/>{!logo && <button className="logo-empty-upload" type="button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={20}/><b>上传 Logo</b><small>PNG、JPG、WebP 或 SVG</small></button>}</div><p className="logo-preview-note">{logo ? '拖动 Logo 调整位置' : '输出画布：240 × 240，白色背景'}</p></main>
        <aside className="logo-tool-controls glass-strong"><div className="logo-control-heading"><b>{logo ? '调整 Logo' : '上传 Logo'}</b><small>{logo ? '已自动置于画布中心' : '建议上传清晰、留白适中的 Logo'}</small></div><input ref={uploadRef} className="logo-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={selectLogo}/><button className="logo-upload-button" type="button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={16}/>{logo ? '更换 Logo' : '选择图片'}</button><label className="logo-scale-control"><span><b>缩放</b><output>{Math.round(zoom * 100)}%</output></span><input aria-label="Logo 缩放" type="range" min="0.1" max="3" step="0.01" value={zoom} disabled={!logo} onChange={(event) => setZoom(Number(event.target.value))}/></label><div className="logo-output-info"><span>输出格式</span><b>240 × 240 PNG</b><small>白色背景</small></div>{error && <div className="logo-error" role="alert">{error}</div>}<div className="logo-actions"><button className="logo-reset-button" type="button" disabled={!logo} onClick={() => { setZoom(1); setPosition({ x: OUTPUT_SIZE / 2, y: OUTPUT_SIZE / 2 }) }}>还原位置</button><button className="logo-download-button" type="button" disabled={!logo} onClick={downloadSingle}><Icon name="download" size={16}/>下载 PNG</button></div></aside>
      </div> : <div className="logo-batch-layout">
        <main className="logo-batch-panel glass-strong"><div className="logo-batch-heading"><div><b>导入 Logo 表格</b><small>支持 Excel 中嵌入的图片，也支持单元格内的公开图片链接。</small></div><label className="logo-upload-button logo-table-upload"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectTable}/><Icon name="upload" size={16}/>{tableName || '上传 .xlsx 表格'}</label></div>{batchLogos.length ? <><div className="logo-batch-summary"><b>已识别 {batchLogos.length.toLocaleString()} 个 Logo</b><span>每个将自动居中并生成 240 × 240 白底 PNG</span></div><div className="logo-batch-grid">{batchLogos.slice(0, 24).map((item) => <div key={item.id}><canvas ref={(canvas) => { if (canvas) drawLogo(canvas, item.image) }} width={OUTPUT_SIZE} height={OUTPUT_SIZE}/><small>{item.label}</small></div>)}</div>{batchLogos.length > 24 && <p className="logo-batch-more">还有 {batchLogos.length - 24} 个 Logo 将一并导出</p>}</> : <div className="logo-batch-empty"><Icon name="image" size={28}/><b>上传包含 Logo 的 Excel 表格</b><span>可识别嵌入图片或图片链接</span></div>}</main>
        <aside className="logo-batch-controls glass-strong"><div className="logo-control-heading"><b>批量输出</b><small>所有成品固定为白色背景 240 × 240 PNG。</small></div><button type="button" className="logo-folder-button" disabled={!batchLogos.length || saving} onClick={chooseOutputFolder}>{outputFolderName ? `输出文件夹：${outputFolderName}` : '选择输出文件夹'}</button><small className="logo-folder-note">选择后会将每个 Logo 直接保存到该文件夹；未选择时下载 ZIP 压缩包。</small>{progress.total > 0 && <div className="logo-progress"><span><b>{saving ? '正在输出' : '输出完成'}</b><output>{progress.current}/{progress.total}</output></span><i><em style={{ transform: `scaleX(${progress.total ? progress.current / progress.total : 0})` }}/></i></div>}{error && <div className="logo-error" role="alert">{error}</div>}<button className="logo-download-button logo-batch-download" type="button" disabled={!batchLogos.length || saving} onClick={exportBatch}><Icon name="download" size={16}/>{saving ? `正在输出 ${progress.current}/${progress.total}` : outputFolderName ? `输出 ${batchLogos.length} 个 Logo 到文件夹` : `下载 ${batchLogos.length || 0} 个 Logo 的 ZIP`}</button></aside>
      </div>}
    </div>
  </section>
}
