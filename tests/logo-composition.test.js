import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { composeBrandLogo } from '../server/knowledge/compose.js'
import { reviewLogo, validateLogoReview } from '../server/knowledge/logoReview.js'

test('replace two overlapping header marks once, preserve all pixels outside the detected region', async () => {
  const logo = await sharp({ create: { width: 200, height: 60, channels: 4, background: '#10ac91' } }).png().toBuffer()
  const old = await sharp({ create: { width: 220, height: 64, channels: 3, background: '#226644' } }).png().toBuffer()
  const plate = await sharp({ create: { width: 215, height: 70, channels: 3, background: 'white' } }).composite([{ input: await sharp(logo).resize(190, 57).toBuffer(), left: 10, top: 7 }]).png().toBuffer()
  const source = await sharp({ create: { width: 1000, height: 1500, channels: 3, background: '#ddd' } }).composite([{ input: old, left: 40, top: 40 }, { input: plate, left: 24, top: 60 }]).png().toBuffer()
  const { buffer, placement } = await composeBrandLogo(source, logo, { boxes: [{ left: 40, top: 40, width: 220, height: 64 }, { left: 24, top: 60, width: 215, height: 70 }] })
  assert.equal(placement.left, 55); assert.equal(placement.top, 55); assert.ok(placement.clearedRegion); assert.equal(placement.backdrop, null)
  const a = await sharp(source).removeAlpha().raw().toBuffer(), b = await sharp(buffer).removeAlpha().raw().toBuffer(), r = placement.clearedRegion
  for (let y = 0; y < 1500; y++) for (let x = 0; x < 1000; x++) if (!(x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height)) { const n = (y * 1000 + x) * 3; assert.equal(a[n], b[n]); assert.equal(a[n + 1], b[n + 1]); assert.equal(a[n + 2], b[n + 2]) }
  const residual = await sharp(buffer).extract(r).removeAlpha().raw().toBuffer()
  for (let i = 0; i < residual.length; i += 3) assert.ok(residual[i] === 221 || residual[i] === 16, 'only the background and single confirmed Logo remain')
})
test('no logo uses transparent source without a white rectangle; complex background and unsafe boxes refuse blind overlay', async () => {
  const logo = await sharp({ create: { width: 100, height: 40, channels: 4, background: '#10ac91' } }).png().toBuffer()
  const base = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#ddd' } }).png().toBuffer()
  const composed = await composeBrandLogo(base, logo)
  assert.equal(composed.placement.backdrop, null); assert.equal(composed.placement.clearedRegion, null)
  await assert.rejects(composeBrandLogo(base, logo, { boxes: [{ left: 0, top: 400, width: 100, height: 50 }] }), /安全处理区域/)
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><defs><linearGradient id="g"><stop stop-color="black"/><stop offset="1" stop-color="white"/></linearGradient></defs><rect width="800" height="1200" fill="url(#g)"/></svg>')
  await assert.rejects(composeBrandLogo(await sharp(svg).png().toBuffer(), logo, { boxes: [{ left: 100, top: 40, width: 220, height: 70 }] }), /复杂画面/)
})
test('Logo review validates boxes and uses high-quality fallback rather than blocking on one model failure', async () => {
  const image = await sharp({ create: { width: 1000, height: 1500, channels: 3, background: '#ddd' } }).png().toBuffer()
  const patterned = await sharp(image).composite([{ input: await sharp({ create: { width: 80, height: 30, channels: 3, background: 'black' } }).png().toBuffer(), left: 40, top: 60 }]).png().toBuffer()
  const models = []
  const review = await reviewLogo(patterned, image, '测试品牌', { request: async (body) => { models.push(body.model); if (models.length === 1) throw new Error('timeout'); return { choices: [{ message: { content: JSON.stringify({ boxes: [[100, 100, 500, 400]], uncertain: false }) } }] } } })
  assert.deepEqual(models, ['gemini-3.1-pro', 'gemini-2.5-pro']); assert.equal(review.boxes[0].left, 36)
  assert.throws(() => validateLogoReview({ boxes: [], uncertain: true }), /无法确认/)
  assert.throws(() => validateLogoReview({ boxes: [[1, 2, 0, 4]], uncertain: false }), /无效位置/)
})

test('a canceled Logo check never launches a fallback request', async () => {
  const image = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ddd' } }).png().toBuffer()
  const patterned = await sharp(image).composite([{ input: await sharp({ create: { width: 10, height: 5, channels: 3, background: 'black' } }).png().toBuffer(), left: 5, top: 5 }]).png().toBuffer()
  const controller = new AbortController(); let calls = 0
  await assert.rejects(reviewLogo(patterned, image, '测试品牌', { signal: controller.signal, request: async () => { calls++; controller.abort(); throw new Error('canceled') } }), /canceled/)
  assert.equal(calls, 1)
})

test('a clean corner skips vision even when a large brand headline is on the right; placement uses a smaller mark with equal pixel margins', async () => {
  const title = await sharp({ create: { width: 480, height: 120, channels: 3, background: '#10ac91' } }).png().toBuffer()
  const image = await sharp({ create: { width: 1000, height: 1800, channels: 3, background: '#eee' } }).composite([{ input: title, left: 420, top: 180 }]).png().toBuffer()
  const logo = await sharp({ create: { width: 400, height: 100, channels: 4, background: '#10ac91' } }).png().toBuffer()
  const review = await reviewLogo(image, logo, '测试品牌', { request: async () => { throw new Error('must not call a model for an empty corner') } })
  assert.equal(review.model, 'uniform-background-check'); assert.deepEqual(review.boxes, [])
  const result = await composeBrandLogo(image, logo, review)
  assert.equal(result.placement.left, 55); assert.equal(result.placement.top, 55); assert.equal(result.placement.width, 180)
  const before = await sharp(image).extract({ left: 420, top: 180, width: 480, height: 120 }).removeAlpha().raw().toBuffer()
  const after = await sharp(result.buffer).extract({ left: 420, top: 180, width: 480, height: 120 }).removeAlpha().raw().toBuffer()
  assert.ok(after.equals(before), "headline pixels must remain unchanged")
})

test('moving an old mark uses equal margins measured from visible pixels, strips only transparent padding and preserves the poster', async () => {
  const logo = await sharp({ create: { width: 300, height: 120, channels: 4, background: '#00000000' } }).composite([{ input: await sharp({ create: { width: 200, height: 60, channels: 4, background: '#10ac91' } }).png().toBuffer(), left: 70, top: 20 }]).png().toBuffer()
  for (const [width, height] of [[1000, 1800], [1800, 1000], [1000, 1000]]) {
    const old = { left: Math.floor(width * .22), top: Math.floor(height * .075), width: 160, height: 45 }
    const source = await sharp({ create: { width, height, channels: 3, background: '#ddd' } }).composite([{ input: await sharp({ create: { width: old.width, height: old.height, channels: 3, background: '#336644' } }).png().toBuffer(), left: old.left, top: old.top }]).png().toBuffer()
    const result = await composeBrandLogo(source, logo, { boxes: [old] }), m = Math.floor(width * .055)
    assert.equal(result.placement.left, m); assert.equal(result.placement.top, m)
    const { data, info } = await sharp(result.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let visibleLeft = width, visibleTop = height
    const r = result.placement.clearedRegion, p = result.placement
    const before = await sharp(source).removeAlpha().raw().toBuffer()
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * info.channels
      if (data[i] < 40 && data[i + 1] > 150 && data[i + 2] > 100) { visibleLeft = Math.min(visibleLeft, x); visibleTop = Math.min(visibleTop, y) }
      if (!(x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height) && !(x >= p.left && x < p.left + p.width && y >= p.top && y < p.top + p.height)) assert.ok(data.subarray(i, i + 3).equals(before.subarray(i, i + 3)))
    }
    assert.equal(visibleLeft, m); assert.equal(visibleTop, m)
  }
})
test('repositioning never covers text at the equal-margin anchor', async () => {
  const logo = await sharp({ create: { width: 200, height: 60, channels: 4, background: '#10ac91' } }).png().toBuffer()
  const old = { left: 300, top: 100, width: 150, height: 45 }
  const source = await sharp({ create: { width: 1000, height: 1800, channels: 3, background: '#ddd' } }).composite([{ input: logo, left: 55, top: 60 }, { input: await sharp(logo).resize(150, 45).png().toBuffer(), left: old.left, top: old.top }]).png().toBuffer()
  await assert.rejects(composeBrandLogo(source, logo, { boxes: [old] }), /等距Logo位置包含文字/)
})
