import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { embeddedImageAssetsFromWorkbook } from './excelEmbeddedImages.js'
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

function imageMimeType(path) {
  const extension = String(path || '').split('.').pop()?.toLowerCase()
  return ['jpg', 'jpeg'].includes(extension) ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png'
}

function imageBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片导出失败，请重试')), type, type === 'image/jpeg' ? .94 : undefined))
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
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const assets = await embeddedImageAssetsFromWorkbook(buffer, sheetName, sheet)
    for (const asset of assets.sort((first, second) => first.row - second.row)) {
      const image = await imageFromBlob(asset.blob, urls)
      logos.push({ id: `${sheetName}-${asset.row}-${logos.length}`, image, label: `${sheetName}-${asset.row}`, path: asset.path })
    }
  }
  if (!logos.length) throw new Error('未在表格中发现嵌入的 Logo 图片。请上传含有内嵌 Logo 图片的 .xlsx 表格')
  return { buffer, logos }
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
  const [batchWorkbook, setBatchWorkbook] = useState(null)
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
    if (!/\.xlsx$/i.test(file.name)) { setError('请上传含有内嵌 Logo 图片的 .xlsx 表格'); return }
    batchUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    batchUrlsRef.current = []
    setBatchLogos([]); setBatchWorkbook(null); setTableName(file.name); setOutputFolderName(''); outputDirectoryRef.current = null; setProgress({ current: 0, total: 0 }); setError('')
    try {
      const { buffer, logos } = await readableBatchLogos(file, batchUrlsRef.current)
      setBatchWorkbook(buffer)
      setBatchLogos(logos)
    } catch (loadError) { setError(loadError.message || '表格读取失败') }
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
    imageBlob(canvasRef.current).then((blob) => downloadBlob(blob, 'logo-240x240.png')).catch((downloadError) => setError(downloadError.message))
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
    if (!batchLogos.length || !batchWorkbook || saving) return
    const directory = outputDirectoryRef.current
    const assets = [...new Map(batchLogos.map((item) => [item.path, item])).values()]
    setSaving(true); setError(''); setProgress({ current: 0, total: assets.length })
    try {
      const zip = await JSZip.loadAsync(batchWorkbook)
      for (let index = 0; index < assets.length; index += 1) {
        const item = assets[index]
        const canvas = document.createElement('canvas')
        drawLogo(canvas, item.image)
        zip.file(item.path, await imageBlob(canvas, imageMimeType(item.path)))
        setProgress({ current: index + 1, total: assets.length })
      }
      const workbookBlob = await zip.generateAsync({ type: 'blob' })
      const baseName = safeName(tableName.replace(/\.xlsx$/i, ''), 'logo表格')
      const outputName = `${baseName}-Logo处理.xlsx`
      if (directory) await saveToFolder(directory, await uniqueFileName(directory, outputName), workbookBlob)
      else downloadBlob(workbookBlob, outputName)
    } catch (exportError) { setError(exportError.message || '批量导出失败，请重试') }
    finally { setSaving(false) }
  }

  return <section className="workspace logo-tool-workspace">
    <div className="logo-tool-page more-tool-page">
      <header className="logo-tool-heading more-tool-heading"><span>LOGO PROCESSING</span><h1>Logo 处理</h1><p>单个调整后下载，或在原表格中批量替换为统一的白底 240 × 240 Logo。</p></header>
      <div className="logo-mode-tabs" role="tablist" aria-label="Logo 处理方式"><button type="button" role="tab" aria-selected={mode === 'single'} className={mode === 'single' ? 'active' : ''} onClick={() => { setMode('single'); setError('') }}>单个处理</button><button type="button" role="tab" aria-selected={mode === 'batch'} className={mode === 'batch' ? 'active' : ''} onClick={() => { setMode('batch'); setError('') }}>批量处理</button></div>
      {mode === 'single' ? <div className="logo-tool-layout">
        <main className="logo-preview-panel glass-strong"><div className={`logo-canvas-wrap${logo ? ' has-logo' : ''}`}><canvas ref={canvasRef} width={OUTPUT_SIZE} height={OUTPUT_SIZE} aria-label="Logo 输出预览" onPointerDown={beginDrag} onPointerMove={moveLogo} onPointerUp={stopDrag} onPointerCancel={stopDrag}/>{!logo && <button className="logo-empty-upload" type="button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={20}/><b>上传 Logo</b><small>PNG、JPG、WebP 或 SVG</small></button>}</div><p className="logo-preview-note">{logo ? '拖动 Logo 调整位置' : '输出画布：240 × 240，白色背景'}</p></main>
        <aside className="logo-tool-controls glass-strong"><div className="logo-control-heading"><b>{logo ? '调整 Logo' : '上传 Logo'}</b><small>{logo ? '已自动置于画布中心' : '建议上传清晰、留白适中的 Logo'}</small></div><input ref={uploadRef} className="logo-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={selectLogo}/><button className="logo-upload-button" type="button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={16}/>{logo ? '更换 Logo' : '选择图片'}</button><label className="logo-scale-control"><span><b>缩放</b><output>{Math.round(zoom * 100)}%</output></span><input aria-label="Logo 缩放" type="range" min="0.1" max="3" step="0.01" value={zoom} disabled={!logo} onChange={(event) => setZoom(Number(event.target.value))}/></label><div className="logo-output-info"><span>输出格式</span><b>240 × 240 PNG</b><small>白色背景</small></div>{error && <div className="logo-error" role="alert">{error}</div>}<div className="logo-actions"><button className="logo-reset-button" type="button" disabled={!logo} onClick={() => { setZoom(1); setPosition({ x: OUTPUT_SIZE / 2, y: OUTPUT_SIZE / 2 }) }}>还原位置</button><button className="logo-download-button" type="button" disabled={!logo} onClick={downloadSingle}><Icon name="download" size={16}/>下载 PNG</button></div></aside>
      </div> : <div className="logo-batch-layout">
        <main className="logo-batch-panel glass-strong"><div className="logo-batch-heading"><div><b>导入 Logo 表格</b><small>表格内容和格式会保留，只替换其中嵌入的 Logo 图片。</small></div><label className="logo-upload-button logo-table-upload"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectTable}/><Icon name="upload" size={16}/>{tableName || '上传 .xlsx 表格'}</label></div>{batchLogos.length ? <><div className="logo-batch-summary"><b>已识别 {batchLogos.length.toLocaleString()} 个 Logo</b><span>原表格会保持不变，只替换为 240 × 240 白底图片</span></div><div className="logo-batch-grid">{batchLogos.slice(0, 24).map((item) => <div key={item.id}><canvas ref={(canvas) => { if (canvas) drawLogo(canvas, item.image) }} width={OUTPUT_SIZE} height={OUTPUT_SIZE}/><small>{item.label}</small></div>)}</div>{batchLogos.length > 24 && <p className="logo-batch-more">还有 {batchLogos.length - 24} 个 Logo 将一并写入同一个表格</p>}</> : <div className="logo-batch-empty"><Icon name="image" size={28}/><b>上传包含内嵌 Logo 的 Excel 表格</b><span>处理后会下载或保存一份同结构的新表格</span></div>}</main>
        <aside className="logo-batch-controls glass-strong"><div className="logo-control-heading"><b>导出处理后表格</b><small>保留原工作表、文字、格式与结构，只替换 Logo。</small></div><button type="button" className="logo-folder-button" disabled={!batchLogos.length || saving} onClick={chooseOutputFolder}>{outputFolderName ? `输出文件夹：${outputFolderName}` : '选择输出文件夹'}</button><small className="logo-folder-note">选择后保存处理后的 Excel；未选择时直接下载处理后的 Excel。</small>{progress.total > 0 && <div className="logo-progress"><span><b>{saving ? '正在替换图片' : '处理完成'}</b><output>{progress.current}/{progress.total}</output></span><i><em style={{ transform: `scaleX(${progress.total ? progress.current / progress.total : 0})` }}/></i></div>}{error && <div className="logo-error" role="alert">{error}</div>}<button className="logo-download-button logo-batch-download" type="button" disabled={!batchLogos.length || saving} onClick={exportBatch}><Icon name="download" size={16}/>{saving ? `正在处理 ${progress.current}/${progress.total}` : outputFolderName ? '保存处理后表格到文件夹' : '下载处理后表格'}</button></aside>
      </div>}
    </div>
  </section>
}
