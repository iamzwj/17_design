import * as XLSX from 'xlsx'
import JSZip from 'jszip'

const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

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

export async function embeddedImageAssetsFromWorkbook(buffer, sheetName, sheetData) {
  const zip = await JSZip.loadAsync(buffer)
  const readText = async (path) => {
    const entry = zip.file(path)
    return entry ? entry.async('text') : ''
  }
  const images = []
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
          if (Number.isInteger(row) && blob) images.push({ row: row + 1, path: mediaPath, blob })
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
      if (Number.isInteger(row) && blob) images.push({ row, path: mediaPath, blob })
    }
  }
  return images
}

export async function embeddedImagesFromWorkbook(buffer, sheetName, sheetData) {
  const assets = await embeddedImageAssetsFromWorkbook(buffer, sheetName, sheetData)
  return new Map(assets.map(({ row, blob }) => [row, blob]))
}
