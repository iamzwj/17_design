import test from 'node:test'
import assert from 'node:assert/strict'
import { customImageEdgeBounds, normalizeCustomImageSize, validateCustomImageSize, supportsCustomImageSize } from '../shared/customImageSize.js'
import { supportsImageRatio } from '../src/imageModels.js'

test('custom size availability follows the VIP contract rather than size-tier availability', () => {
  assert.equal(supportsCustomImageSize('gpt-image-2-vip'), true)
  for (const model of ['nano-banana-2.1', 'gpt-image-2', 'gpt-image-2.5', 'gpt-image-2.5-flare-t']) {
    assert.equal(supportsCustomImageSize(model), false)
    assert.equal(supportsImageRatio(model, '4k', '2048x1024'), false)
  }
  assert.equal(supportsImageRatio('gpt-image-2-vip', '1k', '3840x1280'), true)
})
test('dependent ranges combine ratio, 4K edge and total-pixel restrictions', () => {
  assert.deepEqual(customImageEdgeBounds(3840), { min: 1280, max: 2160 })
  assert.deepEqual(customImageEdgeBounds(480), { min: 1376, max: 1440 })
  assert.deepEqual(customImageEdgeBounds(2880), { min: 960, max: 2880 })
  assert.equal(validateCustomImageSize('gpt-image-2-vip', '2880x2880'), '')
  assert.ok(validateCustomImageSize('gpt-image-2-vip', '4096x2048'))
  assert.ok(validateCustomImageSize('gpt-image-2-vip', '1024x256'))
})
test('editing either edge always yields a valid size including extremes, tiny and malformed input', () => {
  for (const edge of ['width', 'height']) {
    for (const value of ['', '-30', 'abc', '100000', '1025', 'Infinity', ...Array.from({ length: 211 }, (_, n) => 480 + n * 16)]) {
      const result = normalizeCustomImageSize(edge === 'width' ? value : 1024, edge === 'height' ? value : 1024, edge)
      assert.equal(validateCustomImageSize('gpt-image-2-vip', `${result.width}x${result.height}`), '', `${edge}=${value}`)
    }
  }
  assert.deepEqual(normalizeCustomImageSize(3840, 1024), { width: 3840, height: 1280 })
  assert.deepEqual(normalizeCustomImageSize(1024, 3840, 'height'), { width: 1280, height: 3840 })
})
