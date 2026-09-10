export const STANDARD_IMAGE_MODEL = 'gpt-image-2'
export const VIP_IMAGE_MODEL = 'gpt-image-2-vip'

export function supportsImageResolution(model) {
  return [VIP_IMAGE_MODEL, 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'image-2.5-flare', 'image-2.5-sunburst'].includes(model)
}

export function imageCreditCost(model, count = 1) {
  return (model === VIP_IMAGE_MODEL ? 4 : 1) * Math.max(1, Number(count) || 1)
}

export const IMAGE_MODEL_OPTIONS = [
  { value: STANDARD_IMAGE_MODEL, label: 'GPT Image 2' },
  { value: VIP_IMAGE_MODEL, label: 'GPT Image 2 VIP' },
  { value: 'gpt-image-2.5', label: 'GPT Image 2.5' },
  { value: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare' },
  { value: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
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
