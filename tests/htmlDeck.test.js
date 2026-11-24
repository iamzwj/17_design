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
  assert.match(html, /阶段成果[\s\S]*累计注册 391 人[\s\S]*试点成本 <strong class="focus">&lt; 4,000 元<\/strong>/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(presentationPreview(html), /Content-Security-Policy/)
  assert.equal((html.match(/<section /g) || []).length, 2)
})

test('rejects malformed plans and leaves existing unstructured plans compatible', () => {
  assert.equal(parseHtmlDeck('不完整'), null)
  assert.equal(parseHtmlDeck(JSON.stringify({ ...deck, slides: [] })), null)
  assert.equal(readHtmlDeckPlan('[HTML演示稿规划]\n旧规划'), null)
})

test('renders a distinct custom visual system and rejects unsafe style values', () => {
  const design = {
    name: '高对比暗色科技风', paper: '#181620', ink: '#FFFFFF', accent: '#93EDFF', secondary: '#F1AFFE',
    heading: 'mono', align: 'center', surface: 'panels', density: 'compact', weight: 'bold',
  }
  const input = { ...deck, design }
  const approved = readHtmlDeckPlan(formatHtmlDeckPlan(parseHtmlDeck(JSON.stringify(input), { requireDesign: true })))
  const html = renderHtmlDeck(approved)
  assert.match(html, /--paper: #181620; --ink: #FFFFFF; --accent: #93EDFF/)
  assert.match(html, /heading-mono center panels compact bold/)
  assert.match(formatHtmlDeckPlan(approved), /高对比暗色科技风/)
  assert.equal(parseHtmlDeck(JSON.stringify(deck), { requireDesign: true }), null)
  assert.equal(parseHtmlDeck(JSON.stringify({ ...input, design: { ...design, paper: '</style>' } })), null)
  assert.equal(parseHtmlDeck(JSON.stringify({ ...input, slides: [{ ...deck.slides[0], focus: '1000 万' }] })), null)
})
