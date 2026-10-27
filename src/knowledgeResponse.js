function fallbackMessage(status) {
  if (status === 413) return '上传请求过大，服务器未能接收。单个文件最多 100MB；若文件未超限，请刷新后重试。'
  if (status === 401) return '登录已过期，请重新登录。'
  if (status === 404) return '知识库接口不存在，请刷新页面后重试。'
  if ([502, 503, 504].includes(status)) return '知识库服务暂时不可用，请稍后重试。'
  return '知识库返回了异常响应，请刷新后重试。'
}
export async function readKnowledgeResponse(response) {
  let data
  try { data = await response.json() } catch { /* Gateways can return HTML instead of application JSON. */ }
  if (response.status === 204 && response.ok) return {}
  if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) {
    const message = typeof data?.error === 'string' && data.error.trim() ? data.error : fallbackMessage(response.status)
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return data
}
