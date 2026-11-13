import { languageModelAvailability } from './languageModelAvailability.js'
export const availableLanguageModels = () => LANGUAGE_MODELS.filter(languageModelAvailability.available)
export const requestAvailableLanguageModel = (...args) => languageModelAvailability.request(...args)
export const LANGUAGE_MODELS = Object.freeze([
  'gpt-6.1-sol',
  'gemini-3.1-pro',
  'gpt-6.1-terra',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
])

export async function requestLanguageModel(request, body, { signal, timeout = 90_000 } = {}) {
  let lastError = new Error('所有语言模型均在故障冷却中，请稍后重试')
  for (const model of availableLanguageModels()) {
    signal?.throwIfAborted()
    try {
      const data = await requestAvailableLanguageModel(request, '/v1/chat/completions', { ...body, model }, timeout)
      if (data?.error) throw new Error(data.error.message || String(data.error))
      if (!data?.choices?.length && !data?.output_text) throw new Error('语言模型未返回结果')
      return { ...data, model: data.model || model }
    } catch (error) {
      signal?.throwIfAborted()
      if ([401, 403, 413].includes(error?.status)) throw error
      lastError = error
    }
  }
  throw lastError
}

export function languageImageParts(parts) {
  return parts.map(({ text, inline_data }) => inline_data
    ? { type: 'image_url', image_url: { url: `data:${inline_data.mime_type};base64,${inline_data.data}` } }
    : { type: 'text', text })
}
