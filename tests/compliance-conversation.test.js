import test from 'node:test'
import assert from 'node:assert/strict'
import { complianceConversationTitle, runComplianceConversation } from '../src/complianceConversation.js'

test('review titles use selected project, input kind and Shanghai calendar date', () => {
  const date = new Date('2026-11-01T16:30:00Z')
  assert.equal(complianceConversationTitle('yanxuanjia', [{ kind: 'image' }], date), '研选家图文审核 2026/11/2')
  assert.equal(complianceConversationTitle('vanke-property', [], date), '万科物业文本审核 2026/11/2')
  assert.equal(complianceConversationTitle('pulin', [{ kind: 'text' }], date), '朴邻文件审核 2026/11/2')
})

test('parallel reviews create independent conversations and complete without stealing focus or renaming history', async () => {
  const saves = [], runtimes = new Map(), pending = []
  const deps = {
    onSave: (value) => saves.push(structuredClone(value)),
    createRuntime(id, messages) { const value = { messages: { current: messages }, active: new Map() }; runtimes.set(id, value); return value },
    generate(kind, id, payload) { return new Promise((resolve) => pending.push({ kind, id, payload, resolve })) },
    basePrompt: '审核',
  }
  const args = { brand: 'yanxuanjia', attachments: [{ kind: 'image', src: '/api/waterfall/assets/_qa.png' }], startedAt: '2026-11-02T07:00:00Z' }
  const first = runComplianceConversation({ ...args, requestId: 'one', content: 'first' }, deps)
  const second = runComplianceConversation({ ...args, requestId: 'two', content: 'second' }, deps)
  assert.equal(saves.length, 2); assert.notEqual(saves[0].id, saves[1].id)
  assert.ok(saves.every((s) => s.openNew && s.activate && s.title === '研选家图文审核 2026/11/2'))
  assert.ok(pending.every((p) => p.payload.messages.length === 1))
  pending[1].resolve({ content: 'second result' }); await second
  pending[0].resolve({ content: 'first result' }); await first
  assert.equal(saves[2].id, saves[1].id); assert.equal(saves[3].id, saves[0].id)
  assert.equal(saves[2].messages[1].content, 'second result'); assert.equal(saves[3].messages[1].content, 'first result')
  for (const save of saves.slice(2)) {
    assert.equal(save.status, 'idle'); assert.equal(save.activate, undefined); assert.equal(save.title, undefined)
    assert.equal(save.textTasks.length, 0)
  }
})
