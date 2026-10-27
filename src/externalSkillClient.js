import { getAuthToken } from './api.js'
import { readLocalSkill, writeLocalSkill, removeLocalSkill } from './localSkillFiles.js'
const base = () => String(window.XIAODIE_CONFIG?.API_BASE_URL || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
export async function externalRequest(path, body, method = body === undefined ? 'GET' : 'POST', token = getAuthToken()) {
  const response = await fetch(`${base()}/api/skills/external${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || '外部 Skill 服务暂时不可用，请重试'); return data
}
const owners = new Map()
export async function externalOwner(token = getAuthToken()) {
  if (!token) throw new Error('请先登录')
  if (!owners.has(token)) owners.set(token, fetch(`${base()}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).then(async (r) => { const data = await r.json(); if (!r.ok || !data.user?.id) throw new Error('登录已过期，请重新登录'); return data.user.id }).catch((error) => { owners.delete(token); throw error }))
  return owners.get(token)
}
export async function installedLocalSkills(token = getAuthToken()) {
  const [owner, data] = await Promise.all([externalOwner(token), externalRequest('/installed', undefined, 'GET', token)])
  return Promise.all(data.skills.map(async (record) => { try { await readLocalSkill(owner, record); return { ...record, external: true, localReady: true } } catch (error) { return { ...record, external: true, localReady: false, localError: error.message } } }))
}
export async function externalSkillPayload(id, token = getAuthToken()) {
  const [owner, data] = await Promise.all([externalOwner(token), externalRequest('/installed', undefined, 'GET', token)])
  const record = data.skills.find((item) => item.id === id)
  if (!record) throw new Error('此账号尚未安装所选 Skill，请到发现 Skill 重新下载')
  if (!record.compatibility.usable) throw new Error('此 Skill 需要适配，不能直接用于生成')
  const markdown = await readLocalSkill(owner, record)
  if (token !== getAuthToken()) throw new Error('账号已切换，请重新选择 Skill')
  return { markdown }
}
const key = (owner) => `dgen-discover-state:${owner}`
const initial = { tab: 'discover', query: '', results: [], preview: null, jobs: {}, error: '', notice: '' }
export function readDiscovery(owner) { try { return { ...initial, ...JSON.parse(localStorage.getItem(key(owner)) || 'null') } } catch { return { ...initial } } }
export function updateDiscovery(owner, patch) {
  const next = { ...readDiscovery(owner), ...patch }; localStorage.setItem(key(owner), JSON.stringify(next)); window.dispatchEvent(new CustomEvent('dgen-discovery-change', { detail: owner })); return next
}
const inFlight = new Map()
function job(owner, id, fn) {
  const jobKey = `${owner}:${id}`
  if (inFlight.has(jobKey)) return inFlight.get(jobKey)
  const token = getAuthToken()
  const promise = (async () => {
    updateDiscovery(owner, { error: '', jobs: { ...readDiscovery(owner).jobs, [id]: { status: 'running', at: Date.now() } } })
    try { if (await externalOwner(token) !== owner) throw new Error('账号已切换，请重新打开发现 Skill'); await fn(token); updateDiscovery(owner, { jobs: { ...readDiscovery(owner).jobs, [id]: { status: 'succeeded', at: Date.now() } } }); window.dispatchEvent(new Event('dgen-generation-skill')) }
    catch (error) { updateDiscovery(owner, { error: error.message, jobs: { ...readDiscovery(owner).jobs, [id]: { status: 'failed', error: error.message, at: Date.now() } } }) }
    finally { inFlight.delete(jobKey); window.dispatchEvent(new Event('dgen-generation-skill')) }
  })()
  inFlight.set(jobKey, promise); return promise
}
export function recoverDiscovery(owner) {
  const state = readDiscovery(owner), jobs = { ...state.jobs }; let changed = false
  for (const [id, value] of Object.entries(jobs)) if (value.status === 'running' && !inFlight.has(`${owner}:${id}`)) { jobs[id] = { ...value, status: 'failed', error: '上次操作已中断，请重新搜索或下载' }; changed = true }
  if (changed) updateDiscovery(owner, { jobs, error: '上次操作已中断；已完成的安装不会丢失，请重试未完成的操作。' })
}
export function searchExternal(owner, query) { return job(owner, 'search', async (token) => { const data = await externalRequest(`/search?q=${encodeURIComponent(query.trim())}`, undefined, 'GET', token); updateDiscovery(owner, { results: data.skills, notice: data.skills.length ? '' : '未找到匹配结果，可以换个关键词。' }) }) }
export function previewExternal(owner, record) { return job(owner, 'preview', async (token) => { const data = await externalRequest('/preview', { source: record.source, name: record.name }, 'POST', token); updateDiscovery(owner, { preview: data.preview }) }) }
export function installExternal(owner, preview) { return job(owner, `install:${preview.source}/${preview.name}`, async (token) => {
  const data = await externalRequest('/installed', { previewId: preview.previewId }, 'POST', token); await writeLocalSkill(owner, data.skill, data.markdown); updateDiscovery(owner, { tab: 'installed', preview: null, notice: '已保存到当前浏览器本地文件区，仅此账号可见。' })
}) }
export function redownloadExternal(owner, record) { return job(owner, `download:${record.id}`, async (token) => { const data = await externalRequest(`/${record.id}/download`, undefined, 'GET', token); await writeLocalSkill(owner, data.skill, data.markdown); updateDiscovery(owner, { notice: 'MD 已重新下载并校验，可以继续使用。' }) }) }
export function uninstallExternal(owner, record) { return job(owner, `remove:${record.id}`, async (token) => { await externalRequest(`/${record.id}`, undefined, 'DELETE', token); await removeLocalSkill(owner, record); updateDiscovery(owner, { notice: '已移除当前账号的安装记录和本机文件。' }) }) }
export async function localSkillText(owner, record) { return readLocalSkill(owner, record) }
export async function resumeLocalSkillTask(task) {
  if (!task.skillSnapshot?.external || !task.slots?.some((s) => s.status === 'running' && s.phase === 'needs-local-skill')) return
  const token = getAuthToken(), localSkill = await externalSkillPayload(task.skillSnapshot.id, token)
  const response = await fetch(`${base()}/api/waterfall/tasks/${encodeURIComponent(task.id)}/resume-skill`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ localSkill }) })
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '继续生成失败，请重试') }
}
