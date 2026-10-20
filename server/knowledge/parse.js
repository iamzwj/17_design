import fs from 'node:fs/promises'
import path from 'node:path'
import mammoth from 'mammoth'
import sharp from 'sharp'

export function splitSections(sections) {
  const chunks = []
  for (const section of sections) {
    const text = section.text.replace(/\r/g, '').trim()
    let offset = 0
    while (offset < text.length) {
      let end = Math.min(offset + 300, text.length)
      if (end < text.length) {
        const stop = Math.max(text.lastIndexOf('。', end), text.lastIndexOf('\n', end))
        if (stop > offset + 150) end = stop + 1
      }
      const content = text.slice(offset, end).trim()
      if (content) chunks.push({ text: content, source: section.source, enabled: true })
      if (end >= text.length) break
      offset = Math.max(end - 40, offset + 1)
    }
  }
  if (!chunks.length) throw new Error('未提取到文字。扫描件请先 OCR，图片请补充文字说明。')
  if (chunks.length > 2000) throw new Error('单份资料最多 2000 个分段，请拆分文档后上传')
  return chunks
}
export async function parseDocument(version, originalDir) {
  if (!version.file) return splitSections([{ text: version.content, source: '在线文字' }])
  const file = path.join(originalDir, version.file)
  const ext = version.ext
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const metadata = await sharp(file).metadata()
    if (metadata.width * metadata.height > 40_000_000) throw new Error('图片超过 4000 万像素，请缩小后上传')
    return splitSections([{ text: `${version.title}\n${version.content || '品牌图片素材，请编辑并补充用途和画面说明。'}`, source: '图片说明（非自动识图）' }])
  }
  const supplement = version.content ? [{ text: version.content, source: '补充说明' }] : []
  if (['.txt', '.md'].includes(ext)) return splitSections([...supplement, { text: await fs.readFile(file, 'utf8'), source: '文件正文' }])
  if (ext === '.docx') {
    const data = await mammoth.extractRawText({ path: file })
    return splitSections([...supplement, { text: data.value, source: '文档正文' }])
  }
  if (ext === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await getDocument({ data: new Uint8Array(await fs.readFile(file)), useSystemFonts: true, isEvalSupported: false }).promise
    try {
      if (pdf.numPages > 100) throw new Error('首版单份 PDF 最多 100 页，请拆分后上传')
      const sections = [...supplement]
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i), content = await page.getTextContent()
        sections.push({ text: content.items.map((item) => item.str || '').join(' '), source: `第 ${i} 页` })
      }
      return splitSections(sections)
    } finally { await pdf.destroy() }
  }
  throw new Error('首版支持 PDF、DOCX、TXT、Markdown、PNG、JPG、WebP')
}
