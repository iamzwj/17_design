import assert from 'node:assert/strict'
import test from 'node:test'
import { filmOutputDimensions, filmVideoResolution, SEEDANCE_MODELS } from '../shared/filmVideoModels.js'
import { pollSeedanceShot, submitSeedanceShot } from '../server/vibbitVideos.js'

test('film Seedance shots send the selected resolution and resume via Vibbit task IDs', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    const data = options.method === 'POST'
      ? { task_id: 'task-42' }
      : { status: 'COMPLETED', task_result: { result: '{"video_url":"https://example.test/shot.mp4"}' } }
    return Response.json({ code: 200, data })
  })
  const oldKey = process.env.VIBBIT_OPENAPI_KEY
  process.env.VIBBIT_OPENAPI_KEY = 'test-vibbit-key'
  t.after(() => {
    if (oldKey === undefined) delete process.env.VIBBIT_OPENAPI_KEY
    else process.env.VIBBIT_OPENAPI_KEY = oldKey
  })
  const frame = 'https://example.test/frame.png'
  const character = 'https://example.test/character.png'
  for (const model of SEEDANCE_MODELS) {
    const resolution = model.resolutions.at(-1)
    const images = model.seedance25 ? [frame, character] : [frame]
    const { id } = await submitSeedanceShot({ model: model.value, prompt: 'test', images, duration: 2, resolution, aspectRatio: '16:9' })
    const { task_type, input_info } = JSON.parse(requests.at(-1).options.body)
    const payload = JSON.parse(input_info.input)
    assert.equal(task_type, 'SEEDANCE_VIDEO_GENERATION')
    assert.equal(payload.model, model.value)
    assert.equal(payload.resolution, resolution)
    assert.equal(payload.duration_seconds, 4)
    if (model.seedance25) {
      assert.deepEqual(payload.reference_image_urls, images)
      assert.equal(payload.omni_reference_task_type, 'reference')
    } else {
      assert.equal(payload.first_frame_image_url, frame)
    }
    const result = await pollSeedanceShot(id)
    assert.match(requests.at(-1).url, /\/tasks\/task-42$/)
    assert.equal(result.status, 'succeeded')
    assert.deepEqual(result.results, [{ url: 'https://example.test/shot.mp4' }])
  }
  assert.equal(filmVideoResolution('minimax-h3', '720p'), '480p')
  assert.equal(filmVideoResolution('wan-3.0', '1080p'), '1080p')
  assert.deepEqual(filmOutputDimensions({ ratio: '9:16', videoResolution: '4k' }), [2160, 3840])
  assert.deepEqual(filmOutputDimensions({ ratio: '16:9' }), [1280, 720])
})
