import sharp from 'sharp'
// This overlays the confirmed source pixels; it never redraws or recolors the mark.
export async function composeBrandLogo(image, logo) {
  const base = await sharp(image).metadata()
  const maxWidth = Math.max(1, Math.floor(base.width * 0.24)), maxHeight = Math.max(1, Math.floor(base.height * 0.09))
  const mark = await sharp(logo).rotate().resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  const meta = await sharp(mark).metadata(), stats = await sharp(mark).stats()
  const white = stats.channels.slice(0, 3).every((c) => c.mean > 225)
  const padding = Math.max(1, Math.floor(Math.min(base.width, base.height) * 0.012))
  const left = Math.max(0, Math.floor(base.width * 0.04)), top = Math.max(0, Math.floor(base.height * 0.04))
  const plate = await sharp({ create: { width: meta.width + padding * 2, height: meta.height + padding * 2, channels: 4, background: white ? '#24222a' : '#ffffff' } }).composite([{ input: mark, left: padding, top: padding }]).png().toBuffer()
  return { buffer: await sharp(image).composite([{ input: plate, left, top }]).png().toBuffer(), placement: { left, top, width: meta.width, height: meta.height, padding, backdrop: white ? '#24222a' : '#ffffff' } }
}
