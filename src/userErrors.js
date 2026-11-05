// Translate display text only; raw provider errors remain available on the server.
export function userError(value) {
  const text = String(value?.message || value || '').trim()
  if (!text) return ''
  const rules = [
    [/result not exist.*(?:valid for 2 hours)?/i, '生成结果不存在或已过期（服务商仅保留约两小时），请重新生成'],
    [/server[_ -]?timeout|timed?\s*out|timeout|超时/i, '服务响应超时，请稍后重试'],
    [/failed to fetch|network\s*(?:error|request failed)|load failed|ECONN|ENOTFOUND/i, '网络连接失败，请检查网络后重试'],
    [/rate.?limit|too many requests|\b429\b/i, '请求过于频繁，请稍后重试'],
    [/insufficient.*(?:balance|credit|quota)|quota exceeded/i, '服务额度不足，请检查余额或联系管理员'],
    [/unauthorized|invalid.*(?:key|token)|\b401\b/i, '身份验证失败，请重新登录；若仍失败，请联系管理员检查服务配置'],
    [/forbidden|permission denied|\b403\b/i, '当前操作无权限，请联系管理员'],
    [/content.*(?:policy|filter)|safety.*(?:check|system)|moderation/i, '内容未通过服务审核，请调整内容后重试'],
    [/not found|not exist|\b404\b/i, '请求的资源不存在或已失效，请刷新后重试'],
    [/service unavailable|bad gateway|internal server error|\b50[0234]\b/i, '服务暂时不可用，请稍后重试'],
    [/abort/i, '请求已中断，请重试'],
  ]
  for (const [pattern, message] of rules) if (pattern.test(text)) return message
  if (!/[\u3400-\u9fff]/.test(text)) return '操作未完成，请稍后重试；若持续失败，请联系管理员'
  return text.replace(/server_timeout/gi, '服务响应超时')
}

export function localizeErrors(value) {
  if (Array.isArray(value)) return value.map(localizeErrors)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    typeof item === 'string' && (/^(error|errorMessage|lastError|failureReason)$/i.test(key) || (key === 'message' && (value.type === 'error' || value.status === 'failed')))
      ? userError(item) : localizeErrors(item),
  ]))
}
