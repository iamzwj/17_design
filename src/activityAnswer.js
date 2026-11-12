export const ACTIVITY_ANSWER_INSTRUCTIONS = [
  '回答时在独立一行写「## 正式答案」，下方直接给出用户可使用的完整正文。',
  '策略类正文先写核心结论，再按任务需要组织目标、策略、执行步骤、负责人或时间节点及验收指标。复杂内容用简短小标题和列表，简单问题直接回答。未确认的数字和资源保持待定。',
  '只有需要补充建议、参考依据、假设或待确认事项时，才在正文后另起一行写「## 建议与说明」。不重复正文。正文必须包含执行所必需的限制或前提。',
  '如任务要求输出图片脚本 JSON 或演示稿 HTML，仍按指定格式把代码块放在最后。',
].join('\n')

export function splitActivityAnswer(content) {
  const text = content.trim()
  const formal = /^#{1,6}[ \t]+正式答案[ \t]*$/m.exec(text)
  if (formal) {
    const afterHeading = text.slice(formal.index + formal[0].length)
    const notes = /^#{1,6}[ \t]+建议与说明[ \t]*$/m.exec(afterHeading)
    const answer = (notes ? afterHeading.slice(0, notes.index) : afterHeading).trim()
    if (answer) {
      return {
        before: text.slice(0, formal.index).trim(),
        answer,
        after: notes ? afterHeading.slice(notes.index + notes[0].length).trim() : '',
      }
    }
  }

  // Earlier activity replies often introduced the proposal and its references
  // before the overview. Only split when both headings identify that layout.
  const reference = /^#{1,6}[ \t]+参考与边界[ \t]*$/m.exec(text)
  const overview = /^#{1,6}[ \t]+方案概览[ \t]*$/m.exec(text)
  if (reference && overview && reference.index < overview.index) {
    return { before: text.slice(0, overview.index).trim(), answer: text.slice(overview.index).trim(), after: '' }
  }
  return { before: '', answer: text, after: '' }
}
