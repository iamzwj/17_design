import test from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_MODEL_OPTIONS, supportsImageResolution, supportsImageRatio, imageQualityOptions } from '../src/imageModels.js'
import { imageModelInput } from '../server/imageModelInput.js'

test('available models replace Flare/Sunburst with the exact Banana provider ID', () => {
  assert.deepEqual(IMAGE_MODEL_OPTIONS.map((x) => x.value), ['gpt-image-2', 'gpt-image-2-vip', 'gpt-image-2.5', 'nano-banana-2.1', 'gpt-image-2.5-flare-t', 'gpt-image-2.5-sunburst-t'])
  assert.equal(supportsImageResolution('nano-banana-2.1'), true)
  assert.equal(supportsImageRatio('nano-banana-2.1', '4k', '9:21'), false)
  assert.equal(supportsImageRatio('nano-banana-2.1', '1k', '9:16'), true)
  assert.deepEqual(imageQualityOptions('nano-banana-2.1'), [])
})
test('Banana sends ratio and uppercase imageSize without GPT quality or pixel-size fields', () => {
  for (const resolution of ['1k', '2k', '4k']) assert.deepEqual(imageModelInput({ model: 'nano-banana-2.1', resolution, ratio: '9:16', size: '1440x2560', quality: 'high' }), { aspectRatio: '9:16', imageSize: resolution.toUpperCase() })
  assert.deepEqual(imageModelInput({ model: 'gpt-image-2.5', resolution: '1k', ratio: '9:16', size: '720x1280', quality: 'high' }), { aspectRatio: '720x1280', quality: 'high' })
})
