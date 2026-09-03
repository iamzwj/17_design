export const STANDARD_IMAGE_MODEL = 'gpt-image-2'
export const VIP_IMAGE_MODEL = 'gpt-image-2-vip'

export const IMAGE_MODEL_OPTIONS = [
  { value: STANDARD_IMAGE_MODEL, label: 'GPT Image 2' },
  { value: VIP_IMAGE_MODEL, label: 'GPT Image 2 VIP' },
]

export const VIP_IMAGE_RESOLUTION_OPTIONS = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]

export function imageResolutionForModel(model, resolution) {
  if (model !== VIP_IMAGE_MODEL) return '1k'
  return VIP_IMAGE_RESOLUTION_OPTIONS.some((item) => item.value === resolution) ? resolution : '2k'
}
