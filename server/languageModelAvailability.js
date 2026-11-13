import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
export function createLanguageModelAvailability({ dataDir = process.env.DIEFA_DATA_DIR || defaultDir, now = Date.now } = {}) {
  const dir = path.join(dataDir, 'language-model-availability')
  const file = model => path.join(dir, encodeURIComponent(model) + '.json')
  function state(model) { try { return JSON.parse(fs.readFileSync(file(model), 'utf8')) } catch { return null } }
  function available(model) { return !(state(model)?.retryAt > now()) }
  async function request(call, endpoint, body, timeout) {
    const model = body.model
    if (!available(model)) throw Object.assign(new Error(`${model} 暂停调用，等待故障冷却结束`), { code: 'MODEL_COOLDOWN' })
    try {
      const result = await call(endpoint, body, timeout)
      if (result?.error) throw new Error(result.error.message || JSON.stringify(result.error))
      fs.rmSync(file(model), { force: true })
      return result
    } catch (error) {
      const message = String(error?.message || '')
      const maintenance = /维护|maintenance|model.*(?:unavailable|not found|does not exist)/i.test(message)
      const transient = /超时|timeout|timed.out|aborted|fetch failed|capacity|overload|too many|rate.?limit|429|502|503|504/i.test(message) || ['TimeoutError', 'AbortError'].includes(error?.name) || [429, 502, 503, 504].includes(error?.status)
      if (maintenance || transient) {
        const previous = state(model)
        const failures = (previous?.failures || 0) + 1
        const cooldown = maintenance ? 30 * 60_000 : Math.min(15 * 60_000, 60_000 * 2 ** Math.min(failures, 4))
        fs.mkdirSync(dir, { recursive: true })
        const target = file(model), temp = `${target}.${process.pid}.next`
        fs.writeFileSync(temp, JSON.stringify({ failures, retryAt: now() + cooldown, reason: maintenance ? 'maintenance' : 'temporary' }), { mode: 0o600 })
        fs.renameSync(temp, target)
      }
      throw error
    }
  }
  return { available, request }
}
export const languageModelAvailability = createLanguageModelAvailability()
