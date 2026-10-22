export const MAIZI_IMAGE_MODELS = new Set(['gpt-image-2.5-flare-t', 'gpt-image-2.5-sunburst-t'])
export const BANANA_IMAGE_MODEL = 'nano-banana-2.1'
const BANANA_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'])

export const STANDARD_IMAGE_MODEL = 'gpt-image-2'
export const VIP_IMAGE_MODEL = 'gpt-image-2-vip'
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5'
export const DEFAULT_IMAGE_RESOLUTION = '1k'
export const DEFAULT_IMAGE_QUALITY = 'high'
const EXTREME_RATIO_MODELS = new Set([VIP_IMAGE_MODEL, 'gpt-image-2.5-sunburst', 'image-2.5-sunburst'])
const EXTENDED_QUALITY_MODELS = new Set(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'image-2.5-flare', 'image-2.5-sunburst'])

export const IMAGE_QUALITY_OPTIONS = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
]

export function supportsImageResolution(model) {
  return [...MAIZI_IMAGE_MODELS, BANANA_IMAGE_MODEL, VIP_IMAGE_MODEL, 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'image-2.5-flare', 'image-2.5-sunburst'].includes(model)
}

// The upstream accepts the two 3:1 canvases only from the 2K tier onward.
// Keeping this rule alongside the model metadata prevents the picker from
// advertising a size that would be silently substituted by the provider.
export function supportsImageRatio(model, resolution, ratio) {
  if (model === BANANA_IMAGE_MODEL || MAIZI_IMAGE_MODELS.has(model)) return BANANA_RATIOS.has(ratio)
  if (!['1:3', '3:1'].includes(ratio)) return true
  return EXTREME_RATIO_MODELS.has(model) && ['2k', '4k'].includes(String(resolution).toLowerCase())
}

export function imageQualityOptions(model) {
  if (MAIZI_IMAGE_MODELS.has(model)) return IMAGE_QUALITY_OPTIONS.slice(0, 1)
  if (model === BANANA_IMAGE_MODEL) return []
  return EXTENDED_QUALITY_MODELS.has(model) ? IMAGE_QUALITY_OPTIONS : IMAGE_QUALITY_OPTIONS.slice(0, 3)
}

export function imageQualityForModel(model, quality) {
  const available = imageQualityOptions(model)
  return available.some((item) => item.value === quality) ? quality : available.some((item) => item.value === DEFAULT_IMAGE_QUALITY) ? DEFAULT_IMAGE_QUALITY : available[0]?.value || DEFAULT_IMAGE_QUALITY
}

export function imageCreditCost(model, count = 1) {
  const creditsPerImage = {
    [VIP_IMAGE_MODEL]: 4,
    'gpt-image-2.5-flare': 4,
    'gpt-image-2.5-sunburst': 5,
  }[model] || 1
  return creditsPerImage * Math.max(1, Number(count) || 1)
}

export const IMAGE_MODEL_OPTIONS = [
  { value: STANDARD_IMAGE_MODEL, label: 'GPT Image 2' },
  { value: VIP_IMAGE_MODEL, label: 'GPT Image 2 VIP' },
  { value: 'gpt-image-2.5', label: 'GPT Image 2.5' },
  { value: BANANA_IMAGE_MODEL, label: 'nano-banana-2.1' },
  ...[...MAIZI_IMAGE_MODELS].map((value) => ({ value, label: value })),
]

export const VIP_IMAGE_RESOLUTION_OPTIONS = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]

export function imageResolutionForModel(model, resolution) {
  if (!supportsImageResolution(model)) return '1k'
  return VIP_IMAGE_RESOLUTION_OPTIONS.some((item) => item.value === resolution) ? resolution : '2k'
}

export function availableImageModel(model) {
  return IMAGE_MODEL_OPTIONS.some((item) => item.value === model) ? model : DEFAULT_IMAGE_MODEL
}
