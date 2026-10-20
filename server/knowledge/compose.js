import sharp from 'sharp'

function unionRegion(boxes, base) {
  if (!boxes.length) return null
  if (boxes.some((b) => ![b.left, b.top, b.width, b.height].every(Number.isFinite) || b.left < 0 || b.top < 0 || b.width < 1 || b.height < 1 || b.left + b.width > base.width * 0.56 || b.top + b.height > base.height * 0.19)) throw new Error('已有Logo超出安全处理区域，未继续叠加')
  const x1 = Math.min(...boxes.map((b) => b.left)), y1 = Math.min(...boxes.map((b) => b.top)), x2 = Math.max(...boxes.map((b) => b.left + b.width)), y2 = Math.max(...boxes.map((b) => b.top + b.height))
  if (x2 - x1 > base.width * 0.45 || y2 - y1 > base.height * 0.14) throw new Error('疑似标识范围过大，未覆盖正文或画面')
  const margin = Math.max(6, Math.ceil(Math.min(x2 - x1, y2 - y1) * 0.16))
  const left = Math.max(0, x1 - margin), top = Math.max(0, y1 - margin)
  const right = Math.min(base.width, x2 + margin), bottom = Math.min(base.height, y2 + margin)
  return { left, top, width: right - left, height: bottom - top }
}
async function backgroundAt(image, region, base, requireFlat) {
  const outer = { left: Math.max(0, region.left - 4), top: Math.max(0, region.top - 4) }
  outer.width = Math.min(base.width, region.left + region.width + 4) - outer.left
  outer.height = Math.min(base.height, region.top + region.height + 4) - outer.top
  const { data, info } = await sharp(image).extract(outer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const samples = [[], [], []]
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const gx = x + outer.left, gy = y + outer.top
    if (gx >= region.left && gx < region.left + region.width && gy >= region.top && gy < region.top + region.height) continue
    const n = (y * info.width + x) * info.channels
    for (let c = 0; c < 3; c++) samples[c].push(data[n + Math.min(c, info.channels - 1)])
  }
  if (!samples[0].length) throw new Error('无法读取Logo周围背景，未继续叠加')
  const rgb = samples.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)])
  const noise = samples.map((values, c) => values.map((v) => Math.abs(v - rgb[c])).sort((a, b) => a - b)[Math.floor(values.length * 0.9)])
  if (requireFlat && Math.max(...noise) > 18) throw new Error('已有Logo周围包含复杂画面或文字，未自动覆盖，请重新生成')
  return { r: rgb[0], g: rgb[1], b: rgb[2] }
}
// Only the confirmed Logo and, when safe, its detected existing footprint are changed.
export async function composeBrandLogo(image, logo, { boxes = [] } = {}) {
  const base = await sharp(image).metadata(), region = unionRegion(boxes, base)
  const safeLeft = region ? Math.max(region.left + 3, Math.floor(base.width * 0.04)) : 0
  const safeTop = region ? Math.max(region.top + 3, Math.floor(base.height * 0.04)) : 0
  const safeWidth = region ? region.left + region.width - safeLeft - 3 : 0
  const safeHeight = region ? region.top + region.height - safeTop - 3 : 0
  if (region && (safeWidth < 8 || safeHeight < 8)) throw new Error('现有Logo区域无法保留安全边距，未继续叠加')
  const maxWidth = region ? safeWidth : Math.max(1, Math.floor(base.width * 0.24))
  const maxHeight = region ? safeHeight : Math.max(1, Math.floor(base.height * 0.09))
  const mark = await sharp(logo).rotate().resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  const meta = await sharp(mark).metadata(), stats = await sharp(mark).stats()
  const white = stats.channels.slice(0, 3).every((c) => c.mean > 225)
  const left = region ? safeLeft + Math.floor((safeWidth - meta.width) / 2) : Math.floor(base.width * 0.04)
  const top = region ? safeTop + Math.floor((safeHeight - meta.height) / 2) : Math.floor(base.height * 0.04)
  const footprint = region || { left, top, width: meta.width, height: meta.height }
  const background = await backgroundAt(image, footprint, base, Boolean(region))
  const layers = []
  if (region) layers.push({ input: await sharp({ create: { width: region.width, height: region.height, channels: 3, background } }).png().toBuffer(), left: region.left, top: region.top })
  // A white mark on a light background needs a compact charcoal plate; colored marks stay transparent.
  const backdrop = white && (background.r + background.g + background.b) / 3 > 120 ? '#24222a' : null
  if (backdrop) layers.push({ input: await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: backdrop } }).png().toBuffer(), left, top })
  layers.push({ input: mark, left, top })
  return { buffer: await sharp(image).composite(layers).png().toBuffer(), placement: { left, top, width: meta.width, height: meta.height, backdrop, clearedRegion: region } }
}
