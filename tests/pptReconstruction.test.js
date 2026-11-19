import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePptReconstruction } from '../server/pptReconstruction.js'

const valid = { background: '#ffffff', text_boxes: [{ text: 'Hello', box_px: [10, 10, 80, 20], font_size: 18, color: '#112233' }], shapes: [], images: [] }
test('validates bounded editable objects and rejects untrusted paths', () => {
  const result = validatePptReconstruction({ ...valid, images: [{ box_px: [20, 40, 20, 20], path: '/etc/passwd' }] }, 100, 100)
  assert.deepEqual(result.images, [{ box_px: [20, 40, 20, 20] }])
  assert.throws(() => validatePptReconstruction({ ...valid, images: [{ box_px: [0, 0, 100, 100] }] }, 100, 100), /整页/)
  assert.throws(() => validatePptReconstruction({ ...valid, text_boxes: [{ ...valid.text_boxes[0], box_px: [90, 0, 20, 10] }] }, 100, 100), /超出/)
  assert.throws(() => validatePptReconstruction({ ...valid, shapes: [{ type: 'path', fill: '#000000', box_px: [0, 0, 5, 5] }] }, 100, 100), /图形/)
})

test('builds an openable slide with editable text and image assets', async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const JSZip = (await import('jszip')).default
  const sharp = (await import('sharp')).default
  const { reconstructPpt } = await import('../server/pptReconstruction.js')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ppt-test-'))
  try {
    const image = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const objects = { background: '#ffffff', text_boxes: [{ text: 'Editable 文字', box_px: [20, 20, 200, 40], font_size: 20, color: '#112233' }], shapes: [{ type: 'rect', box_px: [20, 80, 100, 50], fill: '#ff0000' }], images: [{ box_px: [250, 30, 80, 80] }] }
    const result = await reconstructPpt({ source: 'sample', directory: dir, loadImage: async () => image, request: async () => ({ choices: [{ message: { content: JSON.stringify(objects) } }] }), runBuilder: (manifest, output) => promisify(execFile)('python3', ['server/vendor/editppt/build_pptx_from_manifest.py', manifest, '--out', output]) })
    const zip = await JSZip.loadAsync(await fs.readFile(result.path))
    const slide = await zip.file('ppt/slides/slide1.xml').async('string')
    assert.match(slide, /Editable 文字/); assert.match(slide, /<p:sp>/); assert.match(slide, /<p:pic>/)
    assert.ok(zip.file('ppt/media/image1.png')); assert.equal(result.objects, 3)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('dispatches only the exact published image-to-editable-ppt skill name', async () => {
  const { isImageToPptSkill } = await import('../server/pptReconstruction.js')
  assert.equal(isImageToPptSkill({ markdown: '---\nname: image-to-editable-ppt\ndescription: test\n---\n# test' }), true)
  assert.equal(isImageToPptSkill({ markdown: '---\nname: image-to-editable-ppt-other\ndescription: test\n---\n# test' }), false)
})
