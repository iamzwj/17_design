import { appendFile, readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'

const key = process.env.GRSAI_API_KEY
if (!key) throw new Error('GRSAI_API_KEY is missing')

const images = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
  const file = new URL('./fixtures/image-latency/ref-' + (index + 1) + '.png', import.meta.url)
  return 'data:image/png;base64,' + (await readFile(file)).toString('base64')
}))
const models = ['gpt-image-2', 'gpt-image-2.5']
const deadline = 5 * 60_000

async function request(path, body, signal) {
  const response = await fetch('https://grsaiapi.com' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  if (!response.ok) throw new Error('GRSAI returned HTTP ' + response.status)
  return response.json()
}

function fields(response) {
  const payload = [response, response?.data, response?.result]
  return {
    id: payload.find((item) => item?.id)?.id,
    status: String(payload.find((item) => item?.status)?.status || '').toLowerCase(),
    url: payload.flatMap((item) => [
      ...(Array.isArray(item?.results) ? item.results.map((result) => result?.url) : []),
      item?.url,
    ]).find((url) => typeof url === 'string' && /^https:\/\//i.test(url)),
  }
}

async function benchmark(model) {
  const signal = AbortSignal.timeout(deadline)
  const start = performance.now()
  const submitted = await request('/v1/api/generate', {
    model, images, aspectRatio: '1024x1024', quality: 'high', replyType: 'async',
    prompt: 'Create one square minimalist poster on an off-white background. Arrange six circles in a 3 by 2 grid, matching the colors of the six references in their order. No text.',
  }, signal)
  const accepted = (performance.now() - start) / 1000
  let result = fields(submitted)
  const id = result.id
  while (!result.url) {
    if (['failed', 'error', 'cancelled', 'canceled'].includes(result.status)) {
      throw new Error('GRSAI task ' + result.status)
    }
    if (!id) throw new Error('GRSAI did not return a task ID')
    await sleep(2000, undefined, { signal })
    result = fields(await request('/v1/api/result?id=' + encodeURIComponent(id), null, signal))
  }
  const ready = (performance.now() - start) / 1000
  const download = await fetch(result.url, { signal })
  if (!download.ok || !(await download.arrayBuffer()).byteLength) {
    throw new Error('Image download failed (HTTP ' + download.status + ')')
  }
  return [accepted, ready, (performance.now() - start) / 1000]
}

const lines = [
  'Six identical PNG references per model, 1024×1024, high, one output. Sequential runs. Result polling every 2 s.',
  '',
  '| Model | Accepted (s) | First URL (s) | Downloaded (s) |',
  '| --- | ---: | ---: | ---: |',
]
for (const model of models) {
  try {
    const times = await benchmark(model)
    lines.push('| ' + model + ' | ' + times.map((time) => time.toFixed(2)).join(' | ') + ' |')
  } catch (error) {
    console.error(model + ': ' + error.message)
    lines.push('| ' + model + ' | — | — | Failed |')
    process.exitCode = 1
  }
}
const report = lines.join('\n') + '\n'
console.log(report)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report)
