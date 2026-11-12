import assert from 'node:assert/strict'
import test from 'node:test'
import { requestLanguageModel } from '../server/languageModels.js'

test('language calls preserve their inputs and follow the requested order after timeout and maintenance', async () => {
  const seen = []
  const messages = [{ role: 'user', content: 'test' }]
  const result = await requestLanguageModel(async (endpoint, body, timeout) => {
    assert.equal(endpoint, '/v1/chat/completions')
    assert.equal(body.messages, messages)
    assert.equal(timeout, 50)
    seen.push(body.model)
    if (seen.length === 1) throw new DOMException('Timeout', 'TimeoutError')
    if (seen.length === 2) throw Object.assign(new Error('模型维护中'), { status: 400 })
    if (seen.length === 3) return {}
    if (seen.length === 4) throw new Error('模型过载')
    return { choices: [{ message: { content: 'OK' } }] }
  }, { messages }, { timeout: 50 })

  assert.deepEqual(seen, ['gpt-6.1-sol', 'gemini-3.1-pro', 'gpt-6.1-terra', 'gpt-5.6-sol', 'gpt-5.6-terra'])
  assert.equal(result.model, 'gpt-5.6-terra')
})

test('language calls do not try a backup after the caller cancels', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(requestLanguageModel(async () => {
    calls++
    controller.abort()
    throw new Error('request canceled')
  }, { messages: [] }, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 1)
})
