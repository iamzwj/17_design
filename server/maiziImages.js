import { setTimeout as delay } from 'node:timers/promises'

// Standalone MaiziAI adapter: no D-Gen state or billing dependencies.
export const MAIZI_IMAGE_MODELS = new Set(['gpt-image-2.5-flare-t', 'gpt-image-2.5-sunburst-t'])
export const isMaiziImageModel = (model) => MAIZI_IMAGE_MODELS.has(model)

export function normalizeMaiziImageResult(value) {
  const entries = Array.isArray(value?.data) ? value.data : []
  const data = entries.find((item) => item?.task_id || (item?.id && item?.status)) || (value?.data && !Array.isArray(value.data) ? value.data : value)
  const results = [...(data?.result_urls || []), ...entries].map((item) => typeof item === 'string' ? item : item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : null)).filter(Boolean)
  return { id: data?.task_id || data?.id || value?.task_id || value?.id, status: data?.status || (Array.isArray(value?.data) ? 'completed' : 'pending'), results: results.map((url) => ({ url })), error: data?.error_msg || data?.error || null, batch_status: data?.batch_status, requested_count: data?.requested_count, succeeded_count: data?.succeeded_count, failed_count: data?.failed_count, pending_count: data?.pending_count, usage: value?.usage || data?.usage }
}

export function createMaiziImageClient({ baseUrl = 'https://api.maizitech.ai', apiKey, fetchImpl = fetch } = {}) {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/v[12]$/, '')
  async function request(endpoint, { method = 'GET', body, signal, timeout = 60000 } = {}) {
    if (!apiKey) throw new Error('MaiziAI API Key 未配置')
    const multipart = body instanceof FormData
    const response = await fetchImpl(base + endpoint, { method, headers: { Authorization: `Bearer ${apiKey}`, ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}), signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]) })
    const raw = await response.text(); let data
    try { data = JSON.parse(raw) } catch { throw new Error(`MaiziAI 返回无效响应（HTTP ${response.status}）`) }
    if (!response.ok) {
      const detail = data?.detail || data?.error?.message || data?.error || data?.message || `HTTP ${response.status}`
      const error = new Error(`MaiziAI：${(typeof detail === 'string' ? detail : JSON.stringify(detail)).replaceAll(apiKey, '[redacted]').slice(0, 500)}`)
      error.status = response.status; throw error
    }
    return normalizeMaiziImageResult(data)
  }
  async function generate({ model, prompt, images = [], ratio = '1:1', resolution = '1k', n = 1 }, { signal, sync = false } = {}) {
    if (!isMaiziImageModel(model)) throw new Error('不支持的 MaiziAI 图片型号')
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('出图数量必须是 1–10 的整数')
    if (images.length > 16) throw new Error('此型号最多支持 16 张参考图')
    const fields = { model, prompt, size: ratio, resolution: resolution.toUpperCase(), quality: 'low', n }
    let body = fields
    // Inline brand assets go directly to the edits API as files; never publish
    // private originals just to obtain publicly reachable reference URLs.
    if (images.some((source) => !/^https?:\/\//i.test(source))) {
      body = new FormData()
      for (const [key, value] of Object.entries(fields)) body.append(key, String(value))
      for (let i = 0; i < images.length; i++) {
        const response = await fetchImpl(images[i], { signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]) })
        if (!response.ok) throw new Error('读取编辑参考图失败')
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > 25 * 1024 * 1024) throw new Error('单张参考图超过 25MB')
        const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png'
        const extension = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
        body.append(images.length > 1 ? 'image[]' : 'image', new Blob([buffer], { type: mime }), `reference-${i}.${extension}`)
      }
    } else if (images.length) body = { ...fields, images }
    let result = await request(`/v${sync ? 2 : 1}/images/${images.length ? 'edits' : 'generations'}`, { method: 'POST', body, signal, timeout: sync ? 300000 : 60000 })
    // Some active channels wrap a v1 task inside OpenAI-style data[]. Preserve
    // its ID. Also tolerate such a queued response on the nominal v2 path.
    if (sync && result.id) {
      const deadline = Date.now() + 300000
      while (['pending', 'queued', 'processing', 'running'].includes(result.status)) {
        if (Date.now() >= deadline) throw new Error('MaiziAI 同步等待超时，任务可能仍在生成')
        await delay(5000, undefined, { signal }); result = await poll(result.id, signal)
      }
    }
    return result
  }
  async function poll(id, signal) {
    for (let attempt = 0; ; attempt++) {
      try { const result = await request(`/v1/tasks/${encodeURIComponent(id)}`, { signal }); return { ...result, id: result.id || id } }
      catch (error) {
        if (signal?.aborted || attempt >= 2 || (error.status && error.status < 500 && error.status !== 429)) throw error
        await delay((attempt + 1) * 1000, undefined, { signal })
      }
    }
  }
  return { generate, poll }
}
