export async function vibbitApi(pathname, { signal, ...options } = {}) {
  const base = (process.env.VIBBIT_OPENAPI_BASE_URL || 'https://openapi.vibbit.cn/openapi/v1').replace(/\/+$/, '')
  const key = String(process.env.VIBBIT_OPENAPI_KEY || '').trim()
  if (!key) throw Object.assign(new Error('服务端尚未配置 VIBBIT_OPENAPI_KEY'), { status: 500 })
  const response = await fetch(base + pathname, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.any([AbortSignal.timeout(50_000), ...(signal ? [signal] : [])]),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.code !== 200) {
    const message = String(body.message || `Vibbit 返回 HTTP ${response.status}`).replaceAll(key, '[redacted]')
    throw Object.assign(new Error(message), { status: response.status >= 400 ? response.status : 502 })
  }
  return body.data || {}
}

export function normalizeVibbitTask(task, id, outputField = 'image_url') {
  const raw = task.task_result?.result
  let result = raw
  if (typeof raw === 'string') {
    try { result = JSON.parse(raw) } catch { result = null }
  }
  const url = result?.[outputField]
  const state = String(task.status || 'PENDING').toLowerCase()
  const status = state === 'completed' && url ? 'succeeded'
    : ['pending', 'running', 'processing', 'queued', 'in_progress'].includes(state) ? 'pending' : 'failed'
  return {
    id: task.task_id || id,
    status,
    results: url ? [{ url }] : [],
    error: result?.error_message || task.error_message || (status === 'failed' ? 'Vibbit 任务未返回生成文件' : ''),
  }
}

export async function submitVibbitImage({ model, prompt, size, images = [] }, signal) {
  const input = { model, prompt, size, ...(images.length ? { reference_image_urls: images } : {}) }
  const task = await vibbitApi('/tasks', {
    method: 'POST',
    body: JSON.stringify({ task_type: 'AIGC_IMAGE_GENERATION', input_info: { input } }),
    signal,
  })
  if (!task.task_id) throw new Error('Vibbit 未返回生图任务编号')
  return normalizeVibbitTask(task)
}

export async function pollVibbitImage(id, signal) {
  return normalizeVibbitTask(await vibbitApi(`/tasks/${encodeURIComponent(id)}`, { signal }), id)
}
