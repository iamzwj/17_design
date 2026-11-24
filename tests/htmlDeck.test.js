import test from 'node:test'
import assert from 'node:assert/strict'
import { applyHtmlDeckDesign, formatHtmlDeckPlan, htmlPresentationPhase, isCurrentWeatherQuery, parseHtmlDeck, readHtmlDeckPlan, renderHtmlDeck } from '../server/htmlDeck.js'
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
  assert.doesNotMatch(formatHtmlDeckPlan(approved), /高对比暗色科技风/)
  assert.equal(parseHtmlDeck(JSON.stringify(deck), { requireDesign: true }), null)
  assert.equal(parseHtmlDeck(JSON.stringify({ ...input, design: { ...design, paper: '</style>' } })), null)
  assert.equal(parseHtmlDeck(JSON.stringify({ ...input, slides: [{ ...deck.slides[0], focus: '1000 万' }] })), null)
})

test('content planning preserves original hierarchy and styling cannot rewrite approved content', () => {
  const raw = {
    version: 2, audience: '评委', goal: '核对原文', design: { name: '杂志风' },
    slides: [
      { section: '现状', title: '试点积累', takeaway: '需求已验证', points: ['2026 年累计 391 人'], layout: 'cover' },
      { section: '投入与局限', title: '试点成本', takeaway: '统计仅含 API 成本', points: ['不足 4,000 元'] },
    ],
  }
  const plan = parseHtmlDeck(JSON.stringify(raw), { contentOnly: true })
  const saved = formatHtmlDeckPlan(plan)
  assert.match(saved, /现状[\s\S]*需求已验证[\s\S]*391 人[\s\S]*投入与局限[\s\S]*统计仅含 API 成本/)
  assert.doesNotMatch(saved, /杂志风|视觉建议/)
  assert.equal(plan.slides[0].layout, undefined)
  assert.deepEqual(readHtmlDeckPlan(saved), plan)
  const style = {
    theme: 'editorial',
    design: { name: '杂志风', paper: '#F2F5F8', ink: '#0F172A', accent: '#155EEF', secondary: '#008B74', heading: 'serif', align: 'left', surface: 'rules', density: 'airy', weight: 'regular' },
    slides: [{ layout: 'cover', title: '被篡改的标题', focus: '391 人' }, { layout: 'metrics', points: ['无关数字'] }],
  }
  const imperfectStyle = { ...style, slides: [
    { layout: 'cover', focus: ' 391 人 ' },
    { layout: 'metrics', focus: '模型改写的重点' },
  ] }
  const recovered = applyHtmlDeckDesign(plan, JSON.stringify(imperfectStyle))
  assert.deepEqual(recovered.slides.map(({ title, points }) => ({ title, points })),
    plan.slides.map(({ title, points }) => ({ title, points })))
  assert.deepEqual(recovered.slides.map(slide => slide.focus), ['391 人', undefined])
  const html = renderHtmlDeck(applyHtmlDeckDesign(plan, JSON.stringify(style)))
  assert.match(html, /现状[\s\S]*试点积累[\s\S]*需求已验证[\s\S]*投入与局限[\s\S]*统计仅含 API 成本/)
  assert.doesNotMatch(html, /被篡改|无关数字/)
  assert.equal(applyHtmlDeckDesign(plan, JSON.stringify({ ...style, slides: [style.slides[0]] })), null)
})

test('ordinary questions stay in chat even after an HTML plan', () => {
  const plan = { role: 'assistant', content: formatHtmlDeckPlan(deck) }
  const route = (history, content, format) => htmlPresentationPhase([...history, { role: 'user', content }], content, format)
  assert.equal(route([], '深圳天气').needsPlan, false)
  assert.equal(route([plan], '深圳天气').needsPlan, false)
  assert.equal(route([plan], '修改第三页').needsPlan, true)
  assert.equal(route([plan], '确认规划').confirmedPlan, plan)
  assert.equal(route([plan, { role: 'user', content: '确认规划' }], '确认规划').confirmedPlan, plan)
  assert.equal(route([plan, { role: 'assistant', content: '天气答复' }], '确认规划').confirmedPlan, null)
  assert.equal(route([], '生成 HTML 演示稿').needsPlan, true)
  assert.equal(route([], '整理一下', 'slides').needsPlan, true)
})

test('current weather lookup excludes forecasts and historical requests', () => {
  for (const query of ['深圳天气', '深圳现在的天气如何？', '帮我查一下深圳今天的天气']) assert.equal(isCurrentWeatherQuery(query), true)
  for (const query of ['深圳明天天气', '深圳去年天气', '深圳天气做成 HTML', '解释天气预报']) assert.equal(isCurrentWeatherQuery(query), false)
})
