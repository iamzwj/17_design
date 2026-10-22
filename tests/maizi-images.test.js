import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaiziImageClient, normalizeMaiziImageResult } from '../server/maiziImages.js'
import { imageQualityForModel, imageQualityOptions, supportsImageResolution, supportsImageRatio } from '../src/imageModels.js'
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })

test('Maizi preserves every partial result and v2 URL/base64 entry', () => {
  const task = normalizeMaiziImageResult({ task_id: 't', status: 'completed', batch_status: 'partial', result_urls: ['https://example.com/1.png', 'https://example.com/2.png'], requested_count: 3, succeeded_count: 2, failed_count: 1, pending_count: 0 })
  const wrapped = normalizeMaiziImageResult({ created: 1, data: [{ task_id: 'wrapped-task', status: 'pending' }] }); assert.equal(wrapped.id, 'wrapped-task'); assert.equal(wrapped.status, 'pending'); assert.equal(wrapped.results.length, 0)
  assert.equal(task.results.length, 2); assert.equal(task.batch_status, 'partial'); assert.equal(task.failed_count, 1)
  assert.deepEqual(normalizeMaiziImageResult({ data: [{ url: 'https://example.com/1.png' }, { b64_json: 'YWJj' }] }).results.map((x) => x.url), ['https://example.com/1.png', 'data:image/png;base64,YWJj'])
})
test('model contract fixes low quality and offers native 1K/2K/4K and supported ratios', () => {
  for (const model of ['gpt-image-2.5-flare-t', 'gpt-image-2.5-sunburst-t']) {
    assert.equal(imageQualityForModel(model, 'high'), 'low'); assert.deepEqual(imageQualityOptions(model).map((x) => x.value), ['low']); assert.equal(supportsImageResolution(model), true); assert.equal(supportsImageRatio(model, '4k', '9:21'), false)
  }
})
test('adapter routes async jobs, polling, edits and v2 without exposing inline sources publicly', async () => {
  const calls = []
  const client = createMaiziImageClient({ baseUrl: 'https://api.example.test/v1', apiKey: 'maizi-only', fetchImpl: async (url, options) => {
    if (url.startsWith('data:')) { assert.equal(options.headers, undefined); return fetch(url) }
    calls.push({ url, options }); return json(url.includes('/tasks/') ? { status: 'completed', result_urls: ['https://example.com/final.png'] } : url.includes('/v2/') ? { data: [{ url: 'https://example.com/sync.png' }] } : { task_id: 'provider-1', status: 'queued' })
  } })
  const input = { model: 'gpt-image-2.5-flare-t', prompt: 'test', ratio: '9:16', resolution: '4k' }
  assert.equal((await client.generate(input)).id, 'provider-1'); assert.equal(calls[0].url, 'https://api.example.test/v1/images/generations')
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: input.model, prompt: 'test', size: '9:16', resolution: '4K', quality: 'low', n: 1 }); assert.equal(calls[0].options.headers.Authorization, 'Bearer maizi-only')
  assert.equal((await client.poll('provider-1')).results.length, 1); assert.match(calls[1].url, /\/v1\/tasks\/provider-1$/)
  await client.generate({ ...input, images: ['data:image/png;base64,YWJj'] }); assert.match(calls[2].url, /\/v1\/images\/edits$/); assert.ok(calls[2].options.body instanceof FormData); assert.equal(calls[2].options.body.get('image').size, 3); assert.equal(calls[2].options.headers['Content-Type'], undefined)
  assert.equal((await client.generate(input, { sync: true })).results[0].url, 'https://example.com/sync.png'); assert.match(calls[3].url, /\/v2\/images\/generations$/)
})
test('invalid credentials fail once; polling transient errors retry the same task ID', async () => {
  let calls = 0
  const client = createMaiziImageClient({ apiKey: 'secret-test', fetchImpl: async () => { calls++; return calls === 1 ? json({ detail: 'temporarily unavailable' }, 503) : json({ status: 'completed', result_urls: ['https://example.com/a.png'] }) } })
  assert.equal((await client.poll('saved-task')).status, 'completed'); assert.equal(calls, 2)
  calls = 0
  const denied = createMaiziImageClient({ apiKey: 'secret-test', fetchImpl: async () => { calls++; return json({ detail: 'invalid secret-test' }, 401) } })
  await assert.rejects(denied.poll('saved-task'), (e) => e.status === 401 && !e.message.includes('secret-test')); assert.equal(calls, 1)
})
