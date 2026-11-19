import test from 'node:test'
import assert from 'node:assert/strict'
import { collectMaiziStream } from '../server/maiziStream.js'
const response = (text) => new Response(new ReadableStream({ start(c) { const b = new TextEncoder().encode(text); c.enqueue(b.slice(0, 47)); c.enqueue(b.slice(47)); c.close() } }))
test('collects split UTF-8 stream, ignores heartbeats and preserves usage', async () => {
  const result = await collectMaiziStream(response(': ping\n\ndata: {"model":"gemini-4-carbon","choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"delta":{"content":"！"},"finish_reason":"stop"}],"usage":{"total_tokens":5}}\n\ndata: [DONE]\n\n'))
  assert.equal(result.choices[0].message.content, '你好！'); assert.equal(result.usage.total_tokens, 5)
})
test('rejects incomplete and malformed streams', async () => {
  await assert.rejects(collectMaiziStream(response('data: {"choices":[{"delta":{"content":"partial"}}]}\n')), /未完成/)
  await assert.rejects(collectMaiziStream(response('data: invalid\n')), /格式/)
})
