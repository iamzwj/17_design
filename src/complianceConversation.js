import { buildComplianceSystemPrompt, COMPLIANCE_BRANDS } from './complianceRules.js'

export function complianceConversationTitle(brand, attachments, date = new Date()) {
  const name = COMPLIANCE_BRANDS.find((item) => item.value === brand)?.label || '项目'
  const kind = attachments.some((file) => file.kind === 'image') ? '图文审核' : attachments.length ? '文件审核' : '文本审核'
  const day = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).format(date)
  return `${name}${kind} ${day}`
}

// Each submission owns its messages, task ID and runtime. Completion must never
// append to whichever conversation happens to be open later.
export async function runComplianceConversation({ brand, content, attachments, startedAt, requestId }, { onSave, createRuntime, generate, basePrompt }) {
  const id = crypto.randomUUID()
  const message = { role: 'user', content, ...(attachments.length ? { attachments } : {}) }
  const runtime = createRuntime(id, [message])
  runtime.active.set(requestId, startedAt)
  const save = (extra = {}) => onSave({
    id, type: 'compliance', brand, messages: runtime.messages.current, webSearch: false,
    status: runtime.active.size ? 'running' : 'idle',
    runningStartedAt: runtime.active.size ? startedAt : null,
    textTasks: [...runtime.active].map(([id, startedAt]) => ({ id, startedAt })), ...extra,
  })
  save({ title: complianceConversationTitle(brand, attachments, new Date(startedAt)), activate: true, openNew: true })
  const images = attachments.filter((file) => file.kind === 'image' && file.src)
  const files = attachments.filter((file) => file.kind === 'text')
  const text = [content, images.length ? `\n\n当前消息附带 ${images.length} 张待审核图片。请直接查看图片中的文字、Logo和可见内容并完成审核。` : '', ...files.map((file) => `\n\n--- 文件：${file.name} ---\n${file.content}`)].join('')
  let succeeded = false
  try {
    const result = await generate('compliance', requestId, {
      complianceBrand: brand, systemPrompt: buildComplianceSystemPrompt(brand, basePrompt), webSearch: false, searchQuery: content,
      messages: [{ role: 'user', content: [{ type: 'text', text }, ...images.map((file) => ({ type: 'image_url', image_url: { url: file.src, detail: 'high' } }))] }],
    })
    runtime.messages.current = [...runtime.messages.current, { role: 'assistant', taskId: requestId, complianceBrand: brand, content: result.content, sources: result.sources || [], elapsedMs: Date.now() - new Date(startedAt).getTime() }]
    succeeded = true
  } catch (error) {
    runtime.messages.current = [...runtime.messages.current, { role: 'error', taskId: requestId, content: error.message, failedAt: new Date().toISOString() }]
  } finally {
    runtime.active.delete(requestId)
    save({ unreadComplete: succeeded })
  }
}
