export const BANANA_IMAGE_MODEL = 'nano-banana-2.1'
export const BANANA_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'])

// Banana expects a named aspect ratio and a size tier, never GPT pixel dimensions.
export function imageModelInput({ model, resolution = '1k', ratio, size, quality }) {
  if (model === BANANA_IMAGE_MODEL) return { aspectRatio: ratio, imageSize: resolution.toUpperCase() }
  return { aspectRatio: size, quality }
}
