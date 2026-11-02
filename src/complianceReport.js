const sections = { '硬性问题': 'issues', '问题清单': 'issues', '店招规则结果': 'issues', '待核验': 'pending', '人工核验项': 'pending', '待核验项': 'pending', '已检查': 'passed', '通过项': 'passed' }
export function readableReviewText(value) {
  return String(value || '').replace(/PULIN-SIGN-\d+/gi, '').replace(/\bNOT_APPLICABLE\b/g, '不适用').replace(/\bUNCERTAIN\b/g, '待核验').replace(/\bFAIL\b/g, '不符合').replace(/\bPASS\b/g, '符合').replace(/\bS1\b/g, '严重硬伤').replace(/\bS2\b/g, '明确问题').replace(/\bS3\b/g, '一般问题').replace(/^[：:｜|\s]+|[｜|\s]+$/g, '').trim()
}
export function parseComplianceReport(content) {
  const report = { conclusion: '', summary: [], issues: [], pending: [], passed: [], notes: [], suggestions: [] }
  let section = '', item = null
  const flush = () => {
    if (!item) return
    const target = item.severity.startsWith('一般问题') ? 'suggestions' : item.status === '待核验' ? 'pending' : ['符合', '不适用'].includes(item.status) ? 'passed' : section || 'issues'
    if (!item.title && item.extra.length && !item.problem) item.title = item.extra.shift()
    if (item.title || item.problem || item.fix || item.location || item.basis.length) report[target].push(item)
    item = null
  }
  const start = (title = '') => { flush(); item = { title, location: '', problem: '', fix: '', basis: [], status: '', severity: '', extra: [] } }
  for (const raw of String(content || '').split(/\r?\n/)) {
    const line = raw.replace(/^#{1,6}\s*|^>\s?/g, '').replace(/\*\*/g, '').trim()
    if (!line) continue
    const heading = line.replace(/[：:]$/, '')
    if (sections[heading]) { flush(); section = sections[heading]; continue }
    if (/^(?:审核)?摘要[：:]?/.test(line)) { flush(); section = 'summary'; const text = line.replace(/^(?:审核)?摘要[：:]?\s*/, ''); if (text) report.summary.push(readableReviewText(text)); continue }
    if (/^审核结论[：:]/.test(line)) { report.conclusion = readableReviewText(line.replace(/^审核结论[：:]\s*/, '')); continue }
    if (/^(?:合规)?得分[：:]|^(?:材料类型|店招类型)[：:]/.test(line)) continue
    if (/^(?:我先|我会先|下面先)/.test(line)) continue
    const numbered = line.match(/^(?:\d+[.、．)]|[-•])\s*(.*)$/)
    if (numbered && !['summary', ''].includes(section)) {
      if (/^(?:无|暂无|无明确问题)[。.]?$/.test(numbered[1])) continue
      const title = numbered[1].replace(/^(?:问题|项目|检查项)[：:]\s*/, '')
      start(/^(?:规则编号|严重度)[：:]/.test(title) ? '' : readableReviewText(title))
      // Old reports start each item with a rule identifier or severity instead of a title.
      if (/^严重度[：:]/.test(title)) item.severity = readableReviewText(title.replace(/^严重度[：:]\s*/, ''))
      continue
    }
    if (section === 'summary') { report.summary.push(readableReviewText(line)); continue }
    if (/^(?:无|暂无|没有)[。.]?$|^未发现(?:明确|明显)?(?:硬性)?(?:问题|错误)[。.]?$|^无明确问题[。.]?$/.test(line)) continue
    if (!item && ['issues', 'pending', 'passed'].includes(section)) start()
    if (item) {
      const field = line.match(/^([^：:]+)[：:]\s*(.*)$/)
      if (field) {
        const [, key, rawValue] = field, value = readableReviewText(rawValue)
        if (key === '规则编号') continue
        if (key === '状态') item.status = ['待核验', '不适用', '不符合', '符合'].find((s) => value.startsWith(s)) || value
        else if (key === '严重度' || key === '风险等级') item.severity = value
        else if (['问题', '项目', '检查项'].includes(key)) item.title = value
        else if (['位置', '触发原文/画面位置', '原文', '画面位置'].includes(key)) item.location += (item.location ? '\n' : '') + value
        else if (['错误', '问题原因', '观察/数据'].includes(key)) item.problem += (item.problem ? '\n' : '') + value
        else if (['修改', '怎么改', '修改建议', '整改提示', '需确认', '可直接替换/补充建议', '可直接替换建议'].includes(key)) item.fix += (item.fix ? '\n' : '') + value
        else if (['依据', '规则依据', '规范要求', '来源'].includes(key)) item.basis.push(value)
        else item.extra.push(readableReviewText(line))
      } else item.extra.push(readableReviewText(line))
    } else report.notes.push(readableReviewText(line))
  }
  flush()
  if (report.issues.some((i) => i.severity.startsWith('严重硬伤'))) report.conclusion = '禁止发布'
  if (report.conclusion !== '禁止发布') {
    if (report.issues.length && report.conclusion === '通过') report.conclusion = '修改后复审'
    else if (!report.issues.length && report.pending.length) report.conclusion = '部分项目待核验'
  }
  report.conclusion ||= '审核完成'
  return report
}

export function formatComplianceReport(content) {
  const report = parseComplianceReport(content)
  const lines = [`审核结论：${report.conclusion}`, ...(report.summary.length ? [`摘要：${report.summary.join(' ')}`] : [])]
  for (const [key, title] of [['issues', '硬性问题'], ['pending', '待核验']]) {
    if (!report[key].length) continue
    lines.push('', title)
    report[key].forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title || (key === 'issues' ? '发现硬性问题' : '需要补充确认')}`)
      if (item.location) lines.push(`位置：${item.location}`)
      if (item.problem) lines.push(`${key === 'issues' ? '问题' : '待核验原因'}：${item.problem}`)
      if (item.fix) lines.push(`${key === 'issues' ? '怎么改' : '需确认'}：${item.fix}`)
      lines.push(...item.extra)
      if (item.basis.length) lines.push(`依据：${item.basis.join('；')}`)
      lines.push('')
    })
  }
  lines.push(...report.notes)
  return lines.join('\n').trim()
}
