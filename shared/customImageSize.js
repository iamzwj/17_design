// GRSAI's current custom-pixel contract is explicitly limited to the VIP model.
export const CUSTOM_IMAGE_SIZE = Object.freeze({ step: 16, minEdge: 480, maxEdge: 3840, maxRatio: 3, minPixels: 655360, maxPixels: 8294400 })
export const supportsCustomImageSize = (model) => model === 'gpt-image-2-vip'
export function parseCustomImageSize(value) {
  const match = /^(\d+)x(\d+)$/.exec(String(value || ''))
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}
const up = (n) => Math.ceil(n / CUSTOM_IMAGE_SIZE.step) * CUSTOM_IMAGE_SIZE.step
const down = (n) => Math.floor(n / CUSTOM_IMAGE_SIZE.step) * CUSTOM_IMAGE_SIZE.step
export function customImageEdgeBounds(other) {
  const { minEdge, maxEdge, maxRatio, minPixels, maxPixels } = CUSTOM_IMAGE_SIZE
  return { min: up(Math.max(minEdge, other / maxRatio, minPixels / other)), max: down(Math.min(maxEdge, other * maxRatio, maxPixels / other)) }
}
export function validateCustomImageSize(model, value) {
  const size = parseCustomImageSize(value)
  if (!supportsCustomImageSize(model)) return '当前模型不支持自定义分辨率'
  if (!size) return '自定义分辨率格式应为宽x高'
  const { width, height } = size, { step, minEdge, maxEdge, maxRatio, minPixels, maxPixels } = CUSTOM_IMAGE_SIZE
  if (![width, height].every((n) => Number.isSafeInteger(n) && n >= minEdge && n <= maxEdge && n % step === 0)) return `宽高须为 ${step} 的倍数，且在 ${minEdge}–${maxEdge}px 之间`
  if (Math.max(width, height) > Math.min(width, height) * maxRatio) return '自定义比例须在 1:3～3:1 之间'
  if (width * height < minPixels || width * height > maxPixels) return `总像素须在 ${minPixels.toLocaleString('en-US')}～${maxPixels.toLocaleString('en-US')} 之间`
  return ''
}
// Commit the edited edge, then bring the other edge into its new legal interval.
export function normalizeCustomImageSize(width, height, edited = 'width') {
  const { minEdge, maxEdge, step } = CUSTOM_IMAGE_SIZE
  const round = (n) => Math.max(minEdge, Math.min(maxEdge, Math.round((Number(n) || minEdge) / step) * step))
  const fixed = round(edited === 'width' ? width : height)
  const bounds = customImageEdgeBounds(fixed)
  const other = Math.max(bounds.min, Math.min(bounds.max, round(edited === 'width' ? height : width)))
  return edited === 'width' ? { width: fixed, height: other } : { width: other, height: fixed }
}
