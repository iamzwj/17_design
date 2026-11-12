import { LANGUAGE_MODELS } from './languageModels.js'
import { normalizeSkillResult } from './skills.js'
export function createSkillCompletion({ request, text }) {
  return async (messages, mode) => {
    let lastError
    for (const model of LANGUAGE_MODELS) {
      try {
        const data = await request('/v1/chat/completions', { model, stream: false, messages }, undefined, 90_000)
        const content = text(data)
        normalizeSkillResult(mode, content)
        return { content, model: data.model || model }
      } catch (error) { lastError = error }
    }
    throw lastError
  }
}
