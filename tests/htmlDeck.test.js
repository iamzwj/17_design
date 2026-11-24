import test from 'node:test'
import assert from 'node:assert/strict'
import { formatHtmlDeckPlan, parseHtmlDeck, readHtmlDeckPlan, renderHtmlDeck } from '../server/htmlDeck.js'
import { extractPresentation, presentationPreview } from '../src/htmlPresentation.js'

const deck = {
  audience: '提案评委',
  goal: '汇报试点进展',
  theme: 'editorial',
  slides: [
    { title: '阶段成果', layout: 'cover', points: ['累计注册 391 人'], visual: '封面' },
    { title: '成本', layout: 'metrics', points: ['试点成本 < 4,000 元', '<script>alert(1)</script>'], visual: '指标' },
  ],
}

test('confirmed deck preserves the exact sections, order, and claims shown in the plan', () => {
  const plan = formatHtmlDeckPlan(deck)
  assert.match(plan, /第 2 页 · 成本/)
  assert.deepEqual(readHtmlDeckPlan(plan), deck)
  const html = renderHtmlDeck(readHtmlDeckPlan(plan))
  assert.equal(extractPresentation(html), html)
  assert.match(html, /阶段成果[\s\S]*累计注册 391 人[\s\S]*试点成本 &lt; 4,000 元/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(presentationPreview(html), /Content-Security-Policy/)
  assert.equal((html.match(/<section /g) || []).length, 2)
})

test('rejects malformed plans and leaves existing unstructured plans compatible', () => {
  assert.equal(parseHtmlDeck('不完整'), null)
  assert.equal(parseHtmlDeck(JSON.stringify({ ...deck, slides: [] })), null)
  assert.equal(readHtmlDeckPlan('[HTML演示稿规划]\n旧规划'), null)
})
