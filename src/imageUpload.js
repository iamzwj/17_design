export const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024

const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp|gif|heic|heif|avif|bmp|tiff?)$/i
// Keep reference fidelity first. A typical phone original can be re-encoded below
// 8MB at its native dimensions; resizing is only the last resort.
const MAX_CANVAS_EDGE = 6144
const MIN_CANVAS_EDGE = 2048
const QUALITY_STEPS = [0.98, 0.95, 0.92, 0.88]

export function isSupportedImageFile(file) {
  return Boolean(file) && (file.type.startsWith('image/') || IMAGE_FILE_PATTERN.test(file.name))
}

function fileNameForWebp(name) {
  const base = String(name || 'reference-image').replace(/\.[^/.]+$/, '') || 'reference-image'
  return `${base}.webp`
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('浏览器无法压缩这张图片')), 'image/webp', quality)
  })
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file)
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  }

  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('浏览器无法读取这张图片'))
      element.src = url
    })
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function dimensionsWithinLimit(width, height, scale = 1) {
  const initialScale = Math.min(1, MAX_CANVAS_EDGE / Math.max(width, height)) * scale
  return {
    width: Math.max(1, Math.round(width * initialScale)),
    height: Math.max(1, Math.round(height * initialScale)),
  }
}

// Reference images are sent as data URLs. Large camera originals would otherwise
// be rejected before they reach the generation API, so re-encode them locally.
export async function compressImageForUpload(file, maxBytes = MAX_REFERENCE_IMAGE_BYTES) {
  if (file.size <= maxBytes) return file

  let decoded
  try {
    decoded = await decodeImage(file)
    const canvas = document.createElement('canvas')
    let scale = 1

    while (true) {
      const { width, height } = dimensionsWithinLimit(decoded.width, decoded.height, scale)
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('浏览器无法压缩这张图片')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.drawImage(decoded.image, 0, 0, width, height)

      for (const quality of QUALITY_STEPS) {
        const blob = await canvasBlob(canvas, quality)
        if (blob.size <= maxBytes) return new File([blob], fileNameForWebp(file.name), { type: 'image/webp' })
      }

      if (Math.max(width, height) <= MIN_CANVAS_EDGE) break
      scale *= 0.82
    }
  } catch {
    throw new Error(`无法自动压缩“${file.name}”，请换用 PNG、JPG 或 WebP 图片`)
  } finally {
    decoded?.close()
  }

  throw new Error(`无法将“${file.name}”压缩到 8MB 以内`)
}
