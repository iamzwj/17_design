import fs from 'node:fs'
import path from 'node:path'

const models = [
  { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
  { value: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { value: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
]
const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format()

export function startTextModelHealth({ dataDir, complete, readText }) {
  const file = path.join(dataDir, 'text-model-health.json')
  let snapshot
  try { snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* First run. */ }
  let running = false

  async function check() {
    const day = dayKey()
    // Retry failed probes instead of freezing a transient outage for the whole day.
    const completeSnapshot = snapshot?.available?.length === models.length
    const retryAfter = completeSnapshot ? 24 * 60 * 60_000 : 60_000
    if (running || (snapshot?.day === day && Date.now() - Date.parse(snapshot.checkedAt) < retryAfter)) return
    running = true
    try {
      const results = await Promise.all(models.map(async ({ value }) => {
        try {
          const reply = await complete({ model: value, stream: false, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] })
          return Boolean(readText(reply)?.trim())
        } catch {
          return false
        }
      }))
      const next = { day, checkedAt: new Date().toISOString(), available: models.filter((_, index) => results[index]).map(({ value }) => value) }
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(file + '.next', JSON.stringify(next), { mode: 0o600 })
      fs.renameSync(file + '.next', file)
      snapshot = next
    } catch (error) {
      console.error('Could not save text model availability:', error.message)
    } finally {
      running = false
    }
  }

  setImmediate(check)
  setInterval(check, 60_000).unref()
  return () => ({
    models: models.filter(({ value }) => snapshot?.available?.includes(value)),
    allModels: models.map(model => ({ ...model, disabled: !snapshot?.available?.includes(model.value), status: snapshot?.available?.includes(model.value) ? '' : '维护中' })),
    checkedAt: snapshot?.checkedAt || null,
  })
}
