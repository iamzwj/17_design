import test from 'node:test'
import assert from 'node:assert/strict'
import { readKnowledgeResponse } from '../src/knowledgeResponse.js'

test('knowledge response parser reports gateway upload failures and preserves application errors', async () => {
  const html = '<html><head><title>413 Request Entity Too Large</title></head><body>nginx</body></html>'
  await assert.rejects(readKnowledgeResponse(new Response(html, { status: 413, headers: { 'Content-Type': 'text/html' } })), (error) => error.status === 413 && error.message.includes('100MB') && !error.message.includes('Unexpected token'))
  for (const status of [502, 503, 504]) await assert.rejects(readKnowledgeResponse(new Response('<html>gateway error</html>', { status })), (error) => error.status === status && error.message.includes('暂时不可用'))
  await assert.rejects(readKnowledgeResponse(new Response('{"error":"无权发布此品牌资料"}', { status: 403 })), /无权发布此品牌资料/)
  await assert.rejects(readKnowledgeResponse(new Response('<html>app shell</html>', { status: 200 })), /异常响应/)
  await assert.rejects(readKnowledgeResponse(new Response('{"ok":', { status: 200 })), /异常响应/)
  await assert.rejects(readKnowledgeResponse(new Response('null', { status: 200 })), /异常响应/)
  assert.deepEqual(await readKnowledgeResponse(new Response('{"documents":[],"jobs":[]}', { status: 200 })), { documents: [], jobs: [] })
  assert.deepEqual(await readKnowledgeResponse(new Response(null, { status: 204 })), {})
})
