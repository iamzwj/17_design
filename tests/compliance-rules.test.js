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

test('side-sign reference dimensions and materials never become mandatory review failures', () => {
  const prompt = buildComplianceSystemPrompt('pulin')
  const rule = prompt.split('PULIN-SIGN-010｜')[1].split('PULIN-SIGN-011｜')[0]
  assert.match(rule, /参考尺寸和推荐材质工艺/)
  assert.match(rule, /不能据此判 FAIL、列为硬性问题/)
  assert.match(rule, /不得命令一律改成600×600mm或拉丝金属/)
  assert.match(rule, /类别和适用依据均已确认/)
  assert.match(prompt, /不得仅因此给出“修改后复审”或“禁止发布”/)
})

test('hard-error gate is open-ended and separates optional site adaptations from obvious dimension mistakes', () => {
  const prompt = buildComplianceSystemPrompt('pulin')
  assert.match(prompt, /不是穷尽清单/)
  assert.match(prompt, /单位、数量级、计算、尺寸标注相互矛盾/)
  assert.match(prompt, /推荐项不能升级为硬伤/)
  assert.match(prompt, /最多3条简短小字建议/)
})
