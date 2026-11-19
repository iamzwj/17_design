// Collect the OpenAI-compatible event stream into the response shape used by existing callers.
export async function collectMaiziStream(response) {
  if (!response.body) throw new Error('模型未返回响应流')
  const decoder = new TextDecoder(), reader = response.body.getReader()
  let buffer = '', content = '', reasoning = '', model = '', usage = null, finished = false
  function line(value) {
    const text = value.trim()
    if (!text.startsWith('data:')) return
    const data = text.slice(5).trim()
    if (data === '[DONE]') { finished = true; return }
    let event
    try { event = JSON.parse(data) } catch { throw new Error('模型响应流格式无效') }
    if (event.error) throw new Error('模型响应失败，请稍后重试')
    const choice = event.choices?.[0]
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content
    if (typeof choice?.delta?.reasoning_content === 'string') reasoning += choice.delta.reasoning_content
    if (choice?.finish_reason) finished = true
    if (typeof event.model === 'string') model = event.model
    if (event.usage) usage = event.usage
    if (content.length + reasoning.length > 2_000_000) throw new Error('模型响应过长')
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > 2_000_000) throw new Error('模型响应过长')
      const lines = buffer.split('\n'); buffer = lines.pop()
      for (const item of lines) line(item)
    }
    buffer += decoder.decode(); if (buffer.trim()) line(buffer)
    if (!finished || (!content && !reasoning)) throw new Error('模型响应未完成，请重试')
    return { model, usage, choices: [{ message: { content, reasoning_content: reasoning } }] }
  } finally { reader.releaseLock() }
}
