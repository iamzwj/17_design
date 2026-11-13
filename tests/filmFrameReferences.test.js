import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { prepareFilmFrameReferences } from '../server/filmFrameReferences.js'

test('first-frame inputs preserve reference order and originals while bounding the image dimensions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'film-frame-input-'))
  try {
    const red = await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#ff0000' } }).png().toBuffer()
    const blue = await sharp({ create: { width: 320, height: 640, channels: 3, background: '#0000ff' } }).png().toBuffer()
    await fs.writeFile(path.join(dir, 'red.png'), red)
    await fs.writeFile(path.join(dir, 'blue.png'), blue)
    const images = await prepareFilmFrameReferences(dir, [{ file: 'red.png' }, { file: 'blue.png' }])
    assert.ok(images.every(url => url.startsWith('data:image/jpeg;base64,')))
    const decoded = images.map(url => sharp(Buffer.from(url.split(',')[1], 'base64')))
    const sizes = await Promise.all(decoded.map(async image => {
      const { width, height } = await image.metadata()
      return [width, height]
    }))
    assert.deepEqual(sizes, [[1280, 640], [320, 640]])
    assert.deepEqual(await fs.readFile(path.join(dir, 'red.png')), red)
    assert.deepEqual(await fs.readFile(path.join(dir, 'blue.png')), blue)
    await assert.rejects(prepareFilmFrameReferences(dir, [{ file: 'missing.png' }]))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
