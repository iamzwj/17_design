import test from 'node:test'
import assert from 'node:assert/strict'
import { COMPLIANCE_BRANDS, buildComplianceSystemPrompt } from '../src/complianceRules.js'

test('all current and future brands inherit general compliance without a separate general option', () => {
  assert.ok(!COMPLIANCE_BRANDS.some((item) => item.value === 'general'))
  for (const brand of [...COMPLIANCE_BRANDS, { value: 'future-brand' }]) {
    const prompt = buildComplianceSystemPrompt(brand.value)
    assert.match(prompt, /通用基础文字审核/)
    assert.ok(prompt.indexOf('通用基础文字审核') < prompt.indexOf('通用广告法规硬伤审核'))
    assert.match(prompt, /漏字、多字、重复字/)
    assert.match(prompt, /确认的错别字等可修正文字错误列为 S2/)
    assert.match(prompt, /不猜字、不自行补字后判错/)
    assert.match(prompt, /已经按品牌规则报告的相同文字错误不再重复列项/)
    assert.match(prompt, /通用广告法规硬伤审核/)
    assert.match(prompt, /绝对化用语/)
    assert.match(prompt, /引证内容/)
    if (brand.label) assert.ok(prompt.includes(`当前审核类型：${brand.label}`))
  }
  assert.ok(!buildComplianceSystemPrompt('future-brand').includes('PULIN-SIGN-001'))
})
