export const VIBBIT_FLARE_MODEL = 'gpt-image-2.5-flare'
export const VIBBIT_SUNBURST_MODEL = 'gpt-image-2.5-sunburst'
export const VIBBIT_IMAGE_MODELS = new Set([VIBBIT_FLARE_MODEL, VIBBIT_SUNBURST_MODEL])

export function canonicalImageModel(model) {
  if (typeof model !== 'string') return model
  const candidate = model.replace(/^image-2\.5/, 'gpt-image-2.5').replace(/-t$/, '')
  return VIBBIT_IMAGE_MODELS.has(candidate) || model === 'image-2.5' ? candidate : model
}
