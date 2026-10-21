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
  if (requireFlat && Math.max(...noise) > 18) throw new Error('已有Logo周围包含复杂画面或文字，未自动覆盖，请人工核对')
  return { r: rgb[0], g: rgb[1], b: rgb[2] }
}
// Remove only fully transparent source padding; preserve every nontransparent pixel.
async function tightLogo(logo) {
  const oriented = await sharp(logo).rotate().png().toBuffer()
  const { data, info } = await sharp(oriented).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width, top = info.height, right = -1, bottom = -1
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * info.channels + info.channels - 1] > 0) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error('Logo原图完全透明，无法合成')
  return sharp(oriented).extract({ left, top, width: right - left + 1, height: bottom - top + 1 }).png().toBuffer()
}
// Change only the old mark's confirmed footprint and the new mark's footprint.
export async function composeBrandLogo(image, logo, { boxes = [] } = {}) {
  const base = await sharp(image).metadata(), region = unionRegion(boxes, base)
  const margin = Math.floor(base.width * 0.055)
  const maxWidth = Math.max(1, Math.floor(base.width * 0.18))
  const maxHeight = Math.min(Math.max(1, Math.floor(base.height * 0.065)), base.height - margin)
  if (maxHeight < 1) throw new Error('画布高度不足以保留Logo等距边距')
  const mark = await sharp(await tightLogo(logo)).resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  const meta = await sharp(mark).metadata(), stats = await sharp(mark).stats()
  const white = stats.channels.slice(0, 3).every((c) => c.mean > 225)
  const left = margin, top = margin
  let cleaned = image
  if (region) {
    const background = await backgroundAt(image, region, base, true)
    cleaned = await sharp(image).composite([{ input: await sharp({ create: { width: region.width, height: region.height, channels: 3, background } }).png().toBuffer(), left: region.left, top: region.top }]).png().toBuffer()
    // Moving an old mark must not cover a title or subject at the new anchor.
    const area = await sharp(cleaned).extract({ left, top, width: meta.width, height: meta.height }).removeAlpha().stats()
    if (area.channels.slice(0, 3).some((c) => c.max - c.min > 18)) throw new Error('等距Logo位置包含文字或复杂画面，未自动覆盖，请人工核对')
  }
  const background = await backgroundAt(cleaned, { left, top, width: meta.width, height: meta.height }, base, false)
  const layers = []
  // A white mark on a light background needs a compact charcoal plate; colored marks stay transparent.
  const backdrop = white && (background.r + background.g + background.b) / 3 > 120 ? '#24222a' : null
  if (backdrop) layers.push({ input: await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: backdrop } }).png().toBuffer(), left, top })
  layers.push({ input: mark, left, top })
  return { buffer: await sharp(cleaned).composite(layers).png().toBuffer(), placement: { left, top, width: meta.width, height: meta.height, backdrop, clearedRegion: region } }
}
