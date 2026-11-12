export const ACTIVITY_ANSWER_INSTRUCTIONS = [
  '如需说明建议、参考依据、分析判断或待确认事项，先用「## 分析与建议」单独写在正文之前，并简洁呈现。',
  '另起一行写「## 正式答案」，下方只写用户可直接使用的正文。交付策略方案时，正文第一行用一级 Markdown 标题写活动名称与交付物类型，例如「# 社区年终焕新季活动执行方案」。不要以「方案概览」「正式答案」等通用词作为方案名。',
  '方案正文在标题后直接写目标与策略，再按需要分列执行步骤、负责人、时间节点和验收指标。执行所需的前提可放在对应步骤内，未确认的数字和资源保持待定。简单问题直接回答，无需另起标题。',
  '如任务要求输出图片脚本 JSON 或演示稿 HTML，仍按指定格式把代码块放在最后。',
].join('\n')

function heading(text, label) {
  return new RegExp(`^[ \\t]*(?:#{1,6}[ \\t]+)?(?:\\*\\*)?${label}(?:\\*\\*)?[：:]?[ \\t]*$`, 'm').exec(text)
}

export function splitActivityAnswer(content) {
  const text = content.replace(/\r\n?/g, '\n').trim()
  const formal = heading(text, '正式答案')
  const beforeFormal = formal ? text.slice(0, formal.index).trim() : ''
  const afterFormal = formal ? text.slice(formal.index + formal[0].length).trim() : text
  const notes = heading(afterFormal, '(?:建议与说明|分析与建议)')
  const after = notes ? afterFormal.slice(notes.index + notes[0].length).trim() : ''
  const body = (notes ? afterFormal.slice(0, notes.index) : afterFormal).trim()
  const before = beforeFormal.replace(/^(?:#{1,6}[ \t]+)?(?:\*\*)?分析与建议(?:\*\*)?[：:]?[ \t]*\n+/, '').trim()

  // Match older replies with plain, bold, or Markdown headings, including
  // replies already wrapped in the former generic formal-answer heading.
  const reference = heading(body, '参考与边界')
  const overview = heading(body, '方案概览')
  if (reference && overview && reference.index < overview.index) {
    const analysis = body.slice(0, overview.index).trim()
    const plan = body.slice(overview.index + overview[0].length).trim()
    const topic = /^[ \t]*(?:[-*•][ \t]+)?(?:\*\*)?活动主题(?:\*\*)?[：:](?:\*\*)?[ \t]*(.+)$/m.exec(plan)
    const name = topic?.[1].trim().replace(/^\*\*|\*\*$/g, '').replace(/^[“「《]|[”」》]$/g, '').trim() || ''
    const title = name && !/(?:方案|计划|策略)$/.test(name) ? `${name}活动执行方案` : name
    return { before: [before, analysis].filter(Boolean).join('\n\n'), title, answer: plan, after }
  }

  const titleLine = /^#[ \t]+([^\n]+)(?:\n+|$)/.exec(body)
  const title = titleLine?.[1].trim().replace(/^\*\*|\*\*$/g, '') || ''
  if (title && !['方案概览', '正式答案'].includes(title)) {
    return { before, title, answer: body.slice(titleLine[0].length).trim(), after }
  }
  if (body) return { before, title: '', answer: body, after }
  return { before: '', title: '', answer: text, after: '' }
}
