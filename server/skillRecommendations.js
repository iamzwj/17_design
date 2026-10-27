import fs from 'node:fs'
const QUERIES = ['poster', 'photography', 'storyboard', 'logo', 'image-prompt', 'cinematography', 'video-plan', 'video-poster-design']
export function createSkillRecommendations({ cacheFile, search, inspect, seedFile, now = Date.now }) {
  let cache = null, running = null, error = '', failedAt = 0
  for (const file of [cacheFile, seedFile].filter(Boolean)) {
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (data.version === 1 && Array.isArray(data.skills) && data.skills.length) { cache = data; break } } catch { /* Try the last verified catalog bundled with this release. */ }
  }
  async function build() {
    const searches = await Promise.allSettled(QUERIES.map(search))
    const candidates = [...new Map(searches.flatMap((result) => result.status === 'fulfilled' ? result.value : []).filter((item) => item.fit?.targets?.length).map((item) => [`${item.source}/${item.name}`, item])).values()].sort((a, b) => b.installs - a.installs)
    if (!candidates.length) throw new Error('热门 Skill 来源暂时不可用，请稍后重试，也可以先搜索。')
    const skills = []
    // Check each query's leaders as well as the overall popular candidates.
    const leaders = searches.flatMap((r) => r.status === 'fulfilled' ? r.value.filter((s) => s.fit?.targets?.length).slice(0, 3) : [])
    const previous = (cache?.skills || []).map((skill) => candidates.find((candidate) => candidate.source === skill.source && candidate.name === skill.name) || skill)
    const queue = [...new Map([...previous, ...leaders, ...candidates].map((s) => [`${s.source}/${s.name}`, s])).values()].slice(0, 36)
    for (let offset = 0; offset < queue.length && skills.length < 8; offset += 3) {
      const checked = await Promise.allSettled(queue.slice(offset, offset + 3).map(async (candidate) => {
        const preview = await inspect(candidate)
        if (!preview.compatibility.usable || !preview.fit.targets.length) return null
        const metadata = { ...preview }; delete metadata.markdown
        return { ...metadata, installs: candidate.installs, url: candidate.url, verifiedAt: new Date(now()).toISOString() }
      }))
      skills.push(...checked.flatMap((r) => r.status === 'fulfilled' && r.value ? [r.value] : []))
    }
    if (!skills.length) throw new Error('暂未找到通过当前工具检查的热门 Skill，可先使用搜索或稍后重试。')
    const next = { version: 1, updatedAt: new Date(now()).toISOString(), skills: skills.sort((a, b) => b.installs - a.installs).slice(0, 8) }
    fs.writeFileSync(`${cacheFile}.next`, JSON.stringify(next), { mode: 0o600 }); fs.renameSync(`${cacheFile}.next`, cacheFile)
    cache = next
  }
  function get() {
    const expired = !cache || now() - Date.parse(cache.updatedAt) > 12 * 3600000
    if (expired && !running && (!failedAt || now() - failedAt > 60000)) {
      error = ''; running = build().catch((e) => { error = e.message; failedAt = now() }).finally(() => { running = null })
    }
    return { status: cache ? 'ready' : running ? 'running' : 'failed', skills: cache?.skills || [], updatedAt: cache?.updatedAt || null, stale: Boolean(cache && expired), error }
  }
  return { get, peek: () => cache?.skills || [], async wait() { get(); await running; return get() } }
}
