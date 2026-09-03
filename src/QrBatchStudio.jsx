import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { fetchBatchImage, fetchBatchSpreadsheet } from './api.js'
import { Icon } from './icons.jsx'
import './qrBatch.css'

const URL_KEYS = ['二维码图片链接', 'qr_image_url', 'qr_url', '二维码链接', '二维码图片', '二维码', '链接', 'url']
const NAME_KEYS = ['项目码名称', '项目名称', '项目码', '项目编码', '项目码名', 'output_name', 'name', '文件名', '名称', '编号', 'id']
const MAX_BATCH_ROWS = 5_000
const PROCESSING_CHUNK_SIZE = 100
const EXCEL_ROW_KEY = '__excel_row__'
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function reportBlob(report) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report), '处理结果')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function safeName(value, fallback) {
  const clean = String(value ?? '').replace(/[\\/:*?"<>|]/g, '_').replace(/\.+$/g, '')
  return clean || fallback
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片无法读取'))
    image.src = source
  })
}

async function fileImage(file) {
  const url = URL.createObjectURL(file)
  try { return await loadImage(url) } finally { URL.revokeObjectURL(url) }
}

function relationshipId(node, name = 'id') {
  return node.getAttributeNS(RELATIONSHIP_NS, name) || node.getAttribute(`r:${name}`) || node.getAttribute(name)
}

function relationshipFilePath(filePath) {
  const parts = filePath.split('/')
  const fileName = parts.pop()
  return [...parts, '_rels', `${fileName}.rels`].join('/')
}

function resolveZipPath(filePath, target) {
  const parts = filePath.split('/').slice(0, -1)
  for (const part of String(target || '').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function relationshipTarget(xml, sourceFilePath, id) {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const relationship = [...document.getElementsByTagName('Relationship')].find((node) => node.getAttribute('Id') === id)
  return relationship ? resolveZipPath(sourceFilePath, relationship.getAttribute('Target')) : ''
}

function imageMimeType(path) {
  const extension = path.split('.').pop()?.toLowerCase()
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' })[extension] || 'image/png'
}

async function embeddedImagesFromWorkbook(buffer, sheetName, sheetData) {
  const zip = await JSZip.loadAsync(buffer)
  const readText = async (path) => {
    const entry = zip.file(path)
    return entry ? entry.async('text') : ''
  }
  const images = new Map()
  const mediaBlob = async (path) => {
    const media = path ? zip.file(path) : null
    return media ? new Blob([await media.async('uint8array')], { type: imageMimeType(path) }) : null
  }
  const workbookXml = await readText('xl/workbook.xml')
  const workbookRelationships = await readText('xl/_rels/workbook.xml.rels')
  if (workbookXml && workbookRelationships) {
    const workbook = new DOMParser().parseFromString(workbookXml, 'application/xml')
    const sheet = [...workbook.getElementsByTagNameNS('*', 'sheet')].find((node) => node.getAttribute('name') === sheetName)
    const sheetPath = sheet ? relationshipTarget(workbookRelationships, 'xl/workbook.xml', relationshipId(sheet)) : ''
    const sheetXml = sheetPath ? await readText(sheetPath) : ''
    const sheetRelationships = sheetPath ? await readText(relationshipFilePath(sheetPath)) : ''
    if (sheetXml && sheetRelationships) {
      const sheetDocument = new DOMParser().parseFromString(sheetXml, 'application/xml')
      const drawing = sheetDocument.getElementsByTagNameNS('*', 'drawing')[0]
      const drawingPath = drawing ? relationshipTarget(sheetRelationships, sheetPath, relationshipId(drawing)) : ''
      const drawingXml = drawingPath ? await readText(drawingPath) : ''
      const drawingRelationships = drawingPath ? await readText(relationshipFilePath(drawingPath)) : ''
      if (drawingXml && drawingRelationships) {
        const drawingDocument = new DOMParser().parseFromString(drawingXml, 'application/xml')
        const anchors = [...drawingDocument.getElementsByTagNameNS('*', 'twoCellAnchor'), ...drawingDocument.getElementsByTagNameNS('*', 'oneCellAnchor')]
        for (const anchor of anchors) {
          const from = anchor.getElementsByTagNameNS('*', 'from')[0]
          const row = Number(from?.getElementsByTagNameNS('*', 'row')[0]?.textContent)
          const blip = anchor.getElementsByTagNameNS('*', 'blip')[0]
          const mediaPath = blip ? relationshipTarget(drawingRelationships, drawingPath, relationshipId(blip, 'embed')) : ''
          const blob = await mediaBlob(mediaPath)
          if (Number.isInteger(row) && blob) images.set(row + 1, blob)
        }
      }
    }
  }
  const cellImageRows = new Map()
  for (const [address, cell] of Object.entries(sheetData)) {
    if (address.startsWith('!')) continue
    const match = String(cell?.f || '').match(/(?:DISPIMG|CELLIMAGE)\("([^"]+)"/i)
    if (match) cellImageRows.set(match[1], XLSX.utils.decode_cell(address).r + 1)
  }
  const cellImagesXml = await readText('xl/cellimages.xml')
  const cellImageRelationships = await readText('xl/_rels/cellimages.xml.rels')
  if (cellImagesXml && cellImageRelationships && cellImageRows.size) {
    const cellImagesDocument = new DOMParser().parseFromString(cellImagesXml, 'application/xml')
    for (const cellImage of cellImagesDocument.getElementsByTagNameNS('*', 'cellImage')) {
      const identityNode = cellImage.getElementsByTagNameNS('*', 'cNvPr')[0]
      const identity = identityNode?.getAttribute('name') || identityNode?.getAttribute('descr')
      const row = cellImageRows.get(identity)
      const blip = cellImage.getElementsByTagNameNS('*', 'blip')[0]
      const mediaPath = blip ? relationshipTarget(cellImageRelationships, 'xl/cellimages.xml', relationshipId(blip, 'embed')) : ''
      const blob = await mediaBlob(mediaPath)
      if (Number.isInteger(row) && blob) images.set(row, blob)
    }
  }
  return images
}

function applyMergedQrImages(images, merges) {
  const expanded = new Map(images)
  for (const merge of merges || []) {
    let image = null
    for (let row = merge.s.r + 1; row <= merge.e.r + 1; row += 1) {
      if (images.has(row)) { image = images.get(row); break }
    }
    if (!image) continue
    for (let row = merge.s.r + 1; row <= merge.e.r + 1; row += 1) expanded.set(row, image)
  }
  return expanded
}

async function directImageBlob(url) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || !String(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) return null
    return await response.blob()
  } catch { return null } finally { window.clearTimeout(timeout) }
}

async function remoteImage(url) {
  let blob = await directImageBlob(url)
  if (!blob) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 32_000)
    try {
      blob = await fetchBatchImage(url, { signal: controller.signal })
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('二维码图片下载超时，请检查链接是否可从公网访问')
      throw error
    } finally { window.clearTimeout(timeout) }
  }
  const objectUrl = URL.createObjectURL(blob)
  try { return await loadImage(objectUrl) } finally { URL.revokeObjectURL(objectUrl) }
}

async function qrImageForRow(row, imageColumn, images) {
  const embedded = images.get(row[EXCEL_ROW_KEY])
  if (embedded) return fileImage(embedded)
  const source = String(row[imageColumn] || '').trim()
  if (!source) throw new Error('二维码图片为空')
  return remoteImage(source)
}

function canvasBlob(canvas, format, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片导出失败')), format === 'jpg' ? 'image/jpeg' : 'image/png', quality))
}

function fitSquare(image, x, y, width, height, padding) {
  const innerWidth = Math.max(1, width - padding * 2)
  const innerHeight = Math.max(1, height - padding * 2)
  const scale = Math.min(innerWidth / image.naturalWidth, innerHeight / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  return { x: x + (width - drawWidth) / 2, y: y + (height - drawHeight) / 2, width: drawWidth, height: drawHeight }
}

function compose(base, qrLayers, format, quality) {
  const canvas = document.createElement('canvas')
  canvas.width = base.naturalWidth
  canvas.height = base.naturalHeight
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(base, 0, 0)
  for (const { qr, rect } of qrLayers) {
    const target = {
      x: Math.round(rect.x * canvas.width),
      y: Math.round(rect.y * canvas.height),
      width: Math.round(rect.width * canvas.width),
      height: Math.round(rect.width * canvas.width),
    }
    context.fillStyle = '#fff'
    context.fillRect(target.x, target.y, target.width, target.height)
    const padding = Math.max(4, Math.round(Math.min(target.width, target.height) * .055))
    const fitted = fitSquare(qr, target.x, target.y, target.width, target.height, padding)
    context.imageSmoothingEnabled = false
    context.drawImage(qr, fitted.x, fitted.y, fitted.width, fitted.height)
  }
  return canvasBlob(canvas, format, quality)
}

function Step({ number, title, done, children }) {
  return <section className={`batch-step ${done ? 'done' : ''}`}>
    <header><span>{done ? <Icon name="check" size={14}/> : number}</span><div><b>{title}</b>{done && <small>已完成</small>}</div></header>
    {children}
  </section>
}

function newQrSlot(index) {
  return { id: `qr-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`, file: null, sourceName: '', onlineUrl: '', importing: false, rows: [], columns: [], qrColumn: '', embeddedImages: new Map(), rect: { x: .69, y: .67, width: .22 } }
}

function hasQrImage(slot, row) {
  return slot.embeddedImages.has(row[EXCEL_ROW_KEY]) || Boolean(String(row[slot.qrColumn] || '').trim())
}

export default function QrBatchStudio() {
  const [baseFile, setBaseFile] = useState(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [baseSize, setBaseSize] = useState(null)
  const [slots, setSlots] = useState(() => [newQrSlot(1)])
  const [nameSource, setNameSource] = useState('')
  const [format, setFormat] = useState('png')
  const [outputFolderName, setOutputFolderName] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [imageBox, setImageBox] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, success: 0, failed: 0 })
  const [activity, setActivity] = useState('')
  const [failures, setFailures] = useState([])
  const [packages, setPackages] = useState([])
  const [error, setError] = useState('')
  const dragRef = useRef(null)
  const cancelledRef = useRef(false)
  const imageRef = useRef(null)
  const stageRef = useRef(null)
  const outputDirectoryRef = useRef(null)

  const nameOptions = useMemo(() => slots.flatMap((slot, index) => slot.columns.map((column) => ({ value: `${slot.id}::${column}`, label: `二维码框 ${index + 1} · ${column}` }))), [slots])
  const selectedName = useMemo(() => {
    const [slotId, ...columnParts] = nameSource.split('::')
    const slot = slots.find((item) => item.id === slotId)
    return slot ? { slot, column: columnParts.join('::') } : null
  }, [nameSource, slots])
  const rowCount = slots[0]?.rows.length || 0
  const rowsAligned = slots.every((slot) => slot.rows.length === rowCount)
  const validRows = useMemo(() => rowsAligned ? Array.from({ length: rowCount }, (_, index) => index).filter((index) => slots.every((slot) => hasQrImage(slot, slot.rows[index])) && String(selectedName?.slot.rows[index]?.[selectedName.column] || '').trim()) : [], [rowCount, rowsAligned, selectedName, slots])
  const ready = Boolean(baseFile && slots.length && slots.every((slot) => slot.sourceName && slot.qrColumn) && selectedName?.column && rowsAligned && validRows.length)

  function syncImageBox() {
    const image = imageRef.current
    const stage = stageRef.current
    if (!image || !stage || !image.clientWidth || !image.clientHeight) return
    const imageBounds = image.getBoundingClientRect()
    const stageBounds = stage.getBoundingClientRect()
    setImageBox({ left: imageBounds.left - stageBounds.left, top: imageBounds.top - stageBounds.top, width: imageBounds.width, height: imageBounds.height })
  }

  useEffect(() => {
    if (!baseUrl || !imageRef.current || !stageRef.current) return undefined
    syncImageBox()
    const observer = new ResizeObserver(syncImageBox)
    observer.observe(imageRef.current)
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [baseUrl])

  async function selectBase(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const image = await fileImage(file)
      if (baseUrl) URL.revokeObjectURL(baseUrl)
      setBaseFile(file)
      setBaseUrl(URL.createObjectURL(file))
      setBaseSize({ width: image.naturalWidth, height: image.naturalHeight })
      setImageBox(null)
      outputDirectoryRef.current = null
      setOutputFolderName('')
      setPreviewUrl(''); setPackages([]); setFailures([]); setError('')
    } catch (requestError) { setError(requestError.message) }
  }

  function applySpreadsheet(slotId, { sourceName, rows, columns, embeddedImages = new Map() }) {
    if (!rows.length) throw new Error('表格没有数据')
    if (rows.length > MAX_BATCH_ROWS) throw new Error(`单次最多支持 ${MAX_BATCH_ROWS.toLocaleString()} 条，请拆分表格后再处理`)
    const guessed = URL_KEYS.find((candidate) => columns.some((key) => key.toLowerCase() === candidate.toLowerCase()))
    const resolved = columns.find((key) => key.toLowerCase() === guessed?.toLowerCase()) || columns.find((key) => rows.some((row) => /^https?:\/\//i.test(String(row[key] || '').trim()))) || ''
    const nameKey = NAME_KEYS.find((candidate) => columns.some((key) => key.toLowerCase() === candidate.toLowerCase()))
    const resolvedName = columns.find((key) => key.toLowerCase() === nameKey?.toLowerCase()) || ''
    setSlots((current) => current.map((slot) => slot.id === slotId ? { ...slot, sourceName, rows, columns, qrColumn: resolved, embeddedImages, importing: false } : slot))
    setNameSource((current) => current || (resolvedName ? `${slotId}::${resolvedName}` : ''))
    outputDirectoryRef.current = null
    setOutputFolderName('')
    setPackages([]); setFailures([]); setError(!resolved ? '请手动选择“二维码”所在列' : !resolvedName ? '请手动选择“项目码名称”所在列，用于生成文件名' : '')
  }

  async function selectExcel(event, slotId) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }).map((row, index) => ({ ...row, [EXCEL_ROW_KEY]: range.s.r + index + 2 }))
      const keys = [...new Set(data.flatMap((row) => Object.keys(row)))].filter((key) => key !== EXCEL_ROW_KEY)
      const sourceImages = file.name.toLowerCase().endsWith('.xlsx') ? await embeddedImagesFromWorkbook(buffer, workbook.SheetNames[0], sheet) : new Map()
      const images = applyMergedQrImages(sourceImages, sheet['!merges'])
      applySpreadsheet(slotId, { sourceName: file.name, rows: data, columns: keys, embeddedImages: images })
    } catch (requestError) { setError(requestError.message || 'Excel 解析失败') }
  }

  async function importOnlineSpreadsheet(slotId) {
    const slot = slots.find((item) => item.id === slotId)
    const sourceUrl = String(slot?.onlineUrl || '').trim()
    if (!sourceUrl) { setError('请先粘贴公开腾讯文档链接'); return }
    setSlots((current) => current.map((item) => item.id === slotId ? { ...item, importing: true } : item))
    setError('')
    try {
      const spreadsheet = await fetchBatchSpreadsheet(sourceUrl)
      const rows = (spreadsheet.rows || []).map((row, index) => ({ ...row, [EXCEL_ROW_KEY]: index + 2 }))
      const columns = (spreadsheet.columns || []).filter(Boolean)
      applySpreadsheet(slotId, { sourceName: spreadsheet.title || '在线表格', rows, columns })
    } catch (requestError) {
      setSlots((current) => current.map((item) => item.id === slotId ? { ...item, importing: false } : item))
      setError(requestError.message || '在线表格读取失败')
    }
  }

  function addQrSlot() {
    if (slots.length >= 2) return
    setSlots((current) => [...current, newQrSlot(current.length + 1)])
    setPreviewUrl(''); setPackages([]); setFailures([]); setError('')
  }

  function removeQrSlot(slotId) {
    if (slots.length <= 1) return
    setSlots((current) => current.filter((slot) => slot.id !== slotId))
    if (nameSource.startsWith(`${slotId}::`)) setNameSource('')
    setPreviewUrl(''); setPackages([]); setFailures([]); setError('')
  }

  function updateSlot(slotId, patch) {
    setSlots((current) => current.map((slot) => slot.id === slotId ? { ...slot, ...patch } : slot))
  }

  function beginDrag(event, mode, slot) {
    if (!imageRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { mode, x: event.clientX, y: event.clientY, slotId: slot.id, rect: slot.rect }
  }

  function moveRect(event) {
    const drag = dragRef.current
    if (!drag || !imageRef.current) return
    const bounds = imageRef.current.getBoundingClientRect()
    const dx = (event.clientX - drag.x) / bounds.width
    const dy = (event.clientY - drag.y) / bounds.height
    const heightWidthRatio = bounds.height / bounds.width
    if (drag.mode === 'move') {
      const targetHeight = drag.rect.width / heightWidthRatio
      const rect = { ...drag.rect, x: Math.max(0, Math.min(1 - drag.rect.width, drag.rect.x + dx)), y: Math.max(0, Math.min(1 - targetHeight, drag.rect.y + dy)) }
      setSlots((current) => current.map((slot) => slot.id === drag.slotId ? { ...slot, rect } : slot))
    } else {
      const sizeChange = Math.max(event.clientX - drag.x, event.clientY - drag.y) / bounds.width
      const size = Math.max(.04, Math.min(1 - drag.rect.x, (1 - drag.rect.y) * heightWidthRatio, drag.rect.width + sizeChange))
      const rect = { ...drag.rect, width: size }
      setSlots((current) => current.map((slot) => slot.id === drag.slotId ? { ...slot, rect } : slot))
    }
  }

  async function makePreview() {
    if (!ready || previewing) return
    setPreviewing(true); setError('')
    try {
      const [base, ...qrs] = await Promise.all([fileImage(baseFile), ...slots.map((slot) => qrImageForRow(slot.rows[validRows[0]], slot.qrColumn, slot.embeddedImages))])
      const blob = await compose(base, slots.map((slot, index) => ({ qr: qrs[index], rect: slot.rect })), format, .92)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (requestError) { setError(`预览失败：${requestError.message}`) }
    finally { setPreviewing(false) }
  }

  async function chooseOutputFolder() {
    if (!window.showDirectoryPicker) {
      setError('当前浏览器不支持直接保存到文件夹。请使用 Chrome 或 Edge，或将表格拆分为每份不超过 500 条。')
      return
    }
    try {
      const directory = await window.showDirectoryPicker({ mode: 'readwrite' })
      outputDirectoryRef.current = directory
      setOutputFolderName(directory.name || '已选择文件夹')
      setError('')
    } catch (requestError) {
      if (requestError?.name !== 'AbortError') setError('无法访问所选文件夹，请重新选择')
    }
  }

async function saveToFolder(directory, name, blob) {
    if (!directory) return false
    const fileHandle = await directory.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
  return true
}

async function availableFileName(directory, name) {
  const extensionIndex = name.lastIndexOf('.')
  const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : ''
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = index ? `${stem}_副本${index}${extension}` : name
    try { await directory.getFileHandle(candidate) }
    catch (error) {
      if (error?.name === 'NotFoundError') return candidate
      throw error
    }
  }
  throw new Error(`无法为 ${name} 创建不重复的文件名`)
}

  async function startBatch() {
    if (!ready || running) return
    if (!outputDirectoryRef.current) {
      setError('请先选择输出文件夹。每张成品会按项目码名称单独保存为图片文件')
      return
    }
    cancelledRef.current = false
    setRunning(true); setActivity('正在读取底图…'); setError(''); setFailures([]); setPackages((current) => { current.forEach((item) => { if (item.url) URL.revokeObjectURL(item.url) }); return [] })
    setProgress({ current: 0, total: validRows.length, success: 0, failed: 0 })
    const validIndexSet = new Set(validRows)
    const results = Array.from({ length: rowCount }, (_, index) => index).filter((index) => !validIndexSet.has(index)).map((index) => ({ 行号: index + 2, status: '跳过', error_message: !String(selectedName?.slot.rows[index]?.[selectedName.column] || '').trim() ? '命名列为空' : '二维码图片为空', output_file: '' }))
    let success = 0
    let failed = 0
    let completed = 0
    let started = 0
    const outputNames = new Set()
    let destination = null
    let destinationName = ''
    try {
      const base = await fileImage(baseFile)
      setActivity(`正在下载并合成二维码（并行处理，0/${validRows.length}）…`)
      if (outputDirectoryRef.current) {
        destination = outputDirectoryRef.current
        destinationName = outputDirectoryRef.current.name || '已选文件夹'
        setOutputFolderName(destinationName)
      }
      for (let start = 0; start < validRows.length && !cancelledRef.current; start += PROCESSING_CHUNK_SIZE) {
        const batch = validRows.slice(start, start + PROCESSING_CHUNK_SIZE)
        let nextOffset = 0
        async function worker() {
          while (!cancelledRef.current) {
            const offset = nextOffset
            nextOffset += 1
            if (offset >= batch.length) return
          const rowIndex = batch[offset]
          const index = start + offset
          started += 1
          setActivity(`正在下载并合成二维码（并行处理，已启动 ${started}/${validRows.length}）…`)
          const fallbackName = String(index + 1).padStart(4, '0')
            const originalName = safeName(selectedName?.slot.rows[rowIndex]?.[selectedName.column], fallbackName)
            let outputName = originalName
            let duplicateIndex = 1
            while (outputNames.has(outputName)) outputName = `${originalName}_副本${duplicateIndex++}`
            outputNames.add(outputName)
          try {
            const qrs = await Promise.all(slots.map((slot) => qrImageForRow(slot.rows[rowIndex], slot.qrColumn, slot.embeddedImages)))
            const blob = await compose(base, slots.map((slot, qrIndex) => ({ qr: qrs[qrIndex], rect: slot.rect })), format, .92)
            const outputFile = await availableFileName(destination, `${outputName}.${format}`)
            await saveToFolder(destination, outputFile, blob)
            success += 1
            results.push({ 行号: rowIndex + 2, status: '成功', error_message: '', output_file: outputFile })
          } catch (requestError) {
            failed += 1
            const reason = requestError.message || '处理失败'
            results.push({ 行号: rowIndex + 2, status: '失败', error_message: reason, output_file: '' })
            setFailures((current) => current.length < 5 ? [...current, { name: safeName(selectedName?.slot.rows[rowIndex]?.[selectedName.column], fallbackName), reason }] : current)
          }
            completed += 1
            setProgress({ current: completed, total: validRows.length, success, failed })
          }
        }
        await Promise.all(Array.from({ length: Math.min(4, batch.length) }, () => worker()))
      }
    } catch (requestError) { setError(requestError.message || '批量任务异常终止') }
    finally {
      if (destination) {
        try {
          if (results.length) await saveToFolder(destination, await availableFileName(destination, '二维码套图处理结果.xlsx'), reportBlob(results))
        } catch { /* The generated images remain available even if the report cannot be written. */ }
        setPackages((current) => [...current, { name: destinationName, count: success, saved: true }])
      }
      setActivity('')
      setRunning(false)
    }
  }

  return <section className="workspace batch-workspace">
    <div className="batch-page more-tool-page">
      <div className="batch-heading more-tool-heading"><div><span>BATCH COMPOSER</span><h1>批处理二维码</h1><p>上传一张底图和 Excel，框选替换位置，一次生成全部成品。</p></div></div>
      <div className="batch-layout">
        <aside className="batch-controls glass-strong">
          <Step number="1" title="上传底图" done={Boolean(baseFile)}><label className="batch-upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectBase}/><Icon name="upload" size={17}/><span>{baseFile ? baseFile.name : '选择 PNG / JPG / WebP'}</span></label>{baseSize && <small>{baseSize.width} × {baseSize.height} px</small>}</Step>
          <Step number="2" title="导入二维码表格" done={slots.every((slot) => slot.sourceName && slot.qrColumn)}>{slots.map((slot, index) => <div className="batch-slot" key={slot.id}><div className="batch-slot-title"><b>二维码框 {index + 1}</b>{index > 0 && <button type="button" onClick={() => removeQrSlot(slot.id)}>移除</button>}</div><label className="batch-upload"><input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => selectExcel(event, slot.id)}/><Icon name="upload" size={17}/><span>{slot.sourceName || `上传二维码框 ${index + 1} 的 Excel`}</span></label><div className="batch-online-import"><input type="url" value={slot.onlineUrl} onChange={(event) => updateSlot(slot.id, { onlineUrl: event.target.value })} placeholder="或粘贴公开腾讯文档链接"/><button type="button" disabled={slot.importing} onClick={() => importOnlineSpreadsheet(slot.id)}>{slot.importing ? '读取中…' : '读取'}</button></div><small>支持本地 Excel，或公开的腾讯文档智能表格链接。</small>{slot.columns.length > 0 && <div className="batch-fields"><label><span>二维码列（支持嵌入图片或链接）</span><select value={slot.qrColumn} onChange={(event) => updateSlot(slot.id, { qrColumn: event.target.value })}><option value="">请选择</option>{slot.columns.map((column) => <option key={column}>{column}</option>)}</select></label></div>}{slot.rows.length > 0 && <small>{slot.rows.length.toLocaleString()} 行{slot.embeddedImages.size ? `，识别到 ${slot.embeddedImages.size.toLocaleString()} 张嵌入二维码` : ''}</small>}</div>)}{slots.length < 2 && <button type="button" className="batch-add-slot" onClick={addQrSlot}><Icon name="plus" size={15}/>增加二维码框</button>}{nameOptions.length > 0 && <div className="batch-fields batch-name-field"><label><span>生成文件名列</span><select value={nameSource} onChange={(event) => setNameSource(event.target.value)}><option value="">请选择</option>{nameOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>}{slots.length === 2 && !rowsAligned && <div className="batch-error">两个表格的行数不一致，无法按行组合二维码</div>}{rowCount > 0 && rowsAligned && <small>共 {rowCount.toLocaleString()} 行，{validRows.length.toLocaleString()} 条可生成；每一行会同时合成所有二维码框。</small>}</Step>
          <Step number="3" title="输出设置" done={Boolean(outputFolderName)}><div className="batch-fields"><label><span>格式</span><select value={format} onChange={(event) => setFormat(event.target.value)}><option value="png">PNG</option><option value="jpg">JPG</option></select></label></div><button type="button" className="batch-folder" onClick={chooseOutputFolder}>{outputFolderName ? `已选择：${outputFolderName}` : '选择输出文件夹'}</button><small>必选。成品会严格按项目码名称逐张保存；仅重名时追加“_副本1”。</small></Step>
          {error && <div className="batch-error">{error}</div>}
          <div className="batch-actions"><button className="batch-secondary" disabled={!ready || previewing || running} onClick={makePreview}>{previewing ? '预览生成中…' : '生成首张预览'}</button><button className="batch-primary" disabled={!ready || running} onClick={startBatch}>{running ? `正在处理 ${progress.current}/${progress.total}` : `开始生成 ${validRows.length || 0} 张`}</button>{running && <button className="batch-stop" onClick={() => { cancelledRef.current = true }}>完成当前张后停止</button>}</div>
        </aside>
        <main className="batch-canvas-panel glass-strong">
          <header><div><b>替换位置</b><small>拖动二维码框定位，拖右下角调整大小</small></div>{baseSize && <span>已设置 {slots.length} 个二维码框</span>}</header>
          <div className={`batch-stage ${baseUrl ? 'has-image' : ''}`} ref={stageRef}>
            {baseUrl ? <><img className="batch-base-image" ref={imageRef} src={baseUrl} alt="底图预览" onLoad={syncImageBox}/>{imageBox && slots.map((slot, index) => <div className="qr-target" key={slot.id} style={{ left: `${imageBox.left + slot.rect.x * imageBox.width}px`, top: `${imageBox.top + slot.rect.y * imageBox.height}px`, width: `${slot.rect.width * imageBox.width}px`, height: `${slot.rect.width * imageBox.width}px` }} onPointerDown={(event) => beginDrag(event, 'move', slot)} onPointerMove={moveRect} onPointerUp={() => { dragRef.current = null }}><span>二维码 {index + 1}</span><i onPointerDown={(event) => { event.stopPropagation(); beginDrag(event, 'resize', slot) }} onPointerMove={moveRect} onPointerUp={() => { dragRef.current = null }}/></div>)}</> : <div className="batch-placeholder"><Icon name="image" size={32}/><b>先上传底图</b><span>图片会在这里显示</span></div>}
          </div>
          {previewUrl && <div className="batch-preview"><div><b>首张预览</b><small>请用手机扫码确认后再批量生成</small></div><a href={previewUrl} download={`二维码套图_预览.${format}`}><img src={previewUrl} alt="首张合成预览"/><span><Icon name="download" size={14}/>下载预览</span></a></div>}
        </main>
      </div>
      {(running || progress.current > 0 || packages.length > 0) && <section className="batch-results glass-strong"><header><div><b>{running ? '正在生成' : cancelledRef.current ? '任务已停止' : '生成完成'}</b><small>{running ? `${activity || '正在启动…'} · 成功 ${progress.success} · 失败 ${progress.failed}` : `成功 ${progress.success} · 失败 ${progress.failed} · 共 ${progress.total}`}</small></div><strong>{progress.total ? Math.round(progress.current / progress.total * 100) : 0}%</strong></header><div className="batch-progress" role="progressbar" aria-valuemin="0" aria-valuemax={progress.total} aria-valuenow={progress.current}><span style={{ transform: `scaleX(${progress.total ? progress.current / progress.total : 0})` }}/></div>{failures.length > 0 && <div className="batch-failures"><b>失败原因（最多显示 5 条）</b>{failures.map((item, index) => <span key={`${item.name}-${index}`}><strong>{item.name}</strong>{item.reason}</span>)}</div>}{packages.length > 0 && <div className="batch-packages">{packages.map((item) => <div className="batch-saved" key={item.name}><Icon name="check" size={15}/><span><b>{item.name}</b><small>已保存 · {item.count} 张图片</small></span></div>)}</div>}</section>}
    </div>
  </section>
}
