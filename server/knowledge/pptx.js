import JSZip from 'jszip'

const decode = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, value) => {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  if (value[0] !== '#') return named[value] ?? match
  const code = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1))
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
})
const attrs = (xml) => Object.fromEntries([...xml.matchAll(/([\w:]+)\s*=\s*(["'])(.*?)\2/gs)].map((m) => [m[1], decode(m[3])]))
export async function pptxSections(buffer) {
  let zip
  try { zip = await JSZip.loadAsync(buffer) } catch { throw new Error('PPTX 文件损坏或已加密，请另存为标准 PPTX 后上传') }
  const read = async (name) => {
    const entry = zip.file(name)
    if (!entry) throw new Error('PPTX 结构不完整，请另存为标准 PPTX 后上传')
    // Reject oversized XML before inflation as well as after decoding.
    if (entry._data?.uncompressedSize > 2 * 1024 * 1024) throw new Error('PPTX 单页文字结构过大，请拆分后上传')
    const xml = await entry.async('string')
    if (xml.length > 2 * 1024 * 1024) throw new Error('PPTX 单页文字结构过大，请拆分后上传')
    return xml
  }
  const presentation = await read('ppt/presentation.xml')
  const relations = await read('ppt/_rels/presentation.xml.rels')
  const targets = new Map([...relations.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map((m) => attrs(m[0])).filter((a) => a.Type?.endsWith('/slide') && a.TargetMode !== 'External').map((a) => [a.Id, a.Target]))
  const slides = [...presentation.matchAll(/<(?:\w+:)?sldId\b[^>]*>/g)].map((m) => attrs(m[0])['r:id'])
  if (!slides.length) throw new Error('PPTX 没有可读取的幻灯片')
  if (slides.length > 100) throw new Error('单份 PPTX 最多 100 页，请拆分后上传')
  const sections = []
  for (const [index, id] of slides.entries()) {
    const target = targets.get(id)
    if (!target) throw new Error('PPTX 幻灯片引用无效')
    const parts = target.startsWith('/') ? target.slice(1).split('/') : ['ppt', ...target.split('/')]
    const normalized = []
    for (const part of parts) { if (part === '..') normalized.pop(); else if (part && part !== '.') normalized.push(part) }
    const filename = normalized.join('/')
    if (!/^ppt\/slides\/[^/]+\.xml$/.test(filename)) throw new Error('PPTX 幻灯片路径无效')
    const xml = await read(filename)
    const paragraphs = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) => [...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1])).join(''))
    sections.push({ text: paragraphs.join('\n'), source: `第 ${index + 1} 页` })
  }
  if (!sections.some((s) => s.text.trim())) throw new Error('PPTX 未提取到文字，可能是图片型幻灯片。请导出 PDF 后上传并使用图文解析。')
  return sections
}
