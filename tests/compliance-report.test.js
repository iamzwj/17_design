import test from 'node:test'
import assert from 'node:assert/strict'
import { parseComplianceReport, readableReviewText, formatComplianceReport } from '../src/complianceReport.js'
import { buildComplianceSystemPrompt, COMPLIANCE_BRANDS } from '../src/complianceRules.js'

test('legacy store signage output separates confirmed errors from uncertain and passing checks', () => {
  const report = parseComplianceReport(`审核结论：修改后复审
审核摘要：侧招尺寸与工艺不符合规范，门店类型待核验。
店招规则结果
1. 规则编号：PULIN-SIGN-010
状态：FAIL
检查项：侧招尺寸及材质工艺
观察/数据：右侧标注“50x50cm”和“吸塑灯箱”。
规范要求：600mm×600mm，拉丝金属工艺。
整改提示：改为600mm×600mm及拉丝金属工艺。
来源：《朴邻门店店招标准2025》第24页
2. 规则编号：PULIN-SIGN-003
状态：UNCERTAIN
检查项：门店类型
整改提示：请确认是否为普通独立门店。
3. 规则编号：PULIN-SIGN-001
状态：PASS
检查项：已展示的品牌名
4. 规则编号：PULIN-SIGN-002
状态：NOT_APPLICABLE
检查项：联合门店规范`)
  assert.equal(report.issues.length, 1)
  assert.equal(report.pending.length, 1)
  assert.equal(report.passed.length, 2)
  assert.match(report.issues[0].fix, /600mm/)
  assert.ok(report.issues[0].basis.some((line) => line.includes('第24页')))
  assert.doesNotMatch(JSON.stringify(report), /PULIN-SIGN|UNCERTAIN|FAIL|PASS|NOT_APPLICABLE/)
})
test('plain Chinese report preserves arbitrary hard rules, evidence and required corrections', () => {
  const report = parseComplianceReport(`审核结论：修改后复审
摘要：两处明确错误，另有一项待核验。
硬性问题
1. 问题：二维码错误
位置：画面左下角
错误：使用了被明令禁用的个人联系方式。
修改：替换为项目小程序二维码。
依据：店招规范第25页
2. 问题：品牌名错别字
错误：将“朴邻”写成“朴领”。
修改：改为“朴邻”。
依据：通用基础文字审核
待核验
1. 项目：佣金报备
需确认：补充实际报备资料。`)
  assert.equal(report.issues.length, 2)
  assert.equal(report.pending.length, 1)
  assert.equal(report.issues[0].title, '二维码错误')
  assert.equal(report.pending[0].fix, '补充实际报备资料。')
})
test('all-clear, unstructured replies and severe legacy errors retain accurate conclusions', () => {
  assert.equal(parseComplianceReport('审核结论：通过\n摘要：未发现明确硬性错误。').issues.length, 0)
  const severe = parseComplianceReport('审核结论：修改后复审\n问题清单\n1. 严重度：S1\n问题原因：Logo被遮挡\n修改建议：移除遮挡')
  assert.equal(severe.conclusion, '禁止发布')
  assert.ok(parseComplianceReport('无法辨认当前图片，请上传清晰版本。').notes.length)
  assert.equal(readableReviewText('状态：UNCERTAIN'), '状态：待核验')
})
test('every brand keeps full review scope but shares the Chinese hard-error output contract', () => {
  for (const brand of COMPLIANCE_BRANDS) {
    const prompt = buildComplianceSystemPrompt(brand.value)
    assert.match(prompt, /完整检查所有适用于当前材料/)
    assert.match(prompt, /不限于任何几个示例类别/)
    assert.match(prompt, /主观审美、偏好、普通排版优化和润色建议不作为审核问题/)
    assert.match(prompt, /最终展示格式以本节为准/)
  }
  assert.match(buildComplianceSystemPrompt('pulin'), /600mm|600|600×600/)
})

test('uncertain results and subjective legacy suggestions never become hard errors', () => {
  const report = parseComplianceReport('审核结论：通过\n问题清单\n1. 严重度：S3\n问题原因：建议增加留白\n人工核验项\n1. 项目：门店类型\n需确认：请确认实际类型')
  assert.equal(report.issues.length, 0)
  assert.equal(report.conclusion, '部分项目待核验')
  assert.equal(parseComplianceReport('审核结论：通过\n问题清单\n未发现明确问题。').issues.length, 0)
  const copied = formatComplianceReport('审核结论：修改后复审\n店招规则结果\n1. 规则编号：PULIN-SIGN-010\n状态：FAIL\n检查项：尺寸错误\n整改提示：改为600mm\n来源：手册第24页')
  assert.match(copied, /尺寸错误/)
  assert.match(copied, /手册第24页/)
  assert.doesNotMatch(copied, /PULIN-SIGN|FAIL/)
})

test('inline severity fields from older replies preserve full-size problem and correction text', () => {
  const report = parseComplianceReport('审核结论：修改后复审\n问题清单\n1. 严重度：S2。所在位置：画面中部标题。问题原因：汉字被图形遮挡，文字显示不完整。规则依据：通用基础文字审核。修改建议：移开遮挡物。\n人工核验项\n1. 确认实际营业项目。')
  assert.equal(report.issues.length, 1)
  assert.equal(report.issues[0].severity, '明确问题')
  assert.equal(report.issues[0].location, '画面中部标题')
  assert.match(report.issues[0].problem, /文字显示不完整/)
  assert.match(report.issues[0].fix, /移开遮挡物/)
  assert.match(report.issues[0].basis[0], /通用基础文字审核/)
  assert.ok(report.issues[0].title)
  assert.equal(report.pending.length, 1)
})
