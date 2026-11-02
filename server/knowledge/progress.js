const ratio = (done, total) => total > 0 ? Math.min(1, Math.max(0, (done || 0) / total)) : 0
const last = (items) => items.at(-1)
export function documentProgress(version, jobs = [], analyses = []) {
  const textJobs = jobs.filter((j) => j.versionId === version.id && j.kind !== 'vision')
  const automatic = last(analyses.filter((a) => a.versionId === version.id && a.automatic))
  const legacyJobs = textJobs.filter((j) => !j.phase)
  const foundationJob = last(textJobs.filter((j) => j.phase === 'foundation')) || (automatic?.textMerged ? legacyJobs[0] : last(legacyJobs))
  const indexJob = last(textJobs.filter((j) => j.phase === 'full-index')) || (automatic?.textMerged && textJobs.length > 1 && last(textJobs).id !== foundationJob?.id ? last(textJobs) : null)
  const recovered = indexJob?.status === 'succeeded'
  const noText = foundationJob?.status === 'failed' && /未提取到文字/.test(foundationJob.error || '')
  let foundationStatus = foundationJob?.status || (version.status === 'ready' ? 'succeeded' : 'queued')
  let foundationPercent = foundationStatus === 'succeeded' ? 100 : foundationJob?.total ? 20 + Math.floor(80 * ratio(foundationJob.completed, foundationJob.total)) : 0
  let foundationLabel = foundationStatus === 'succeeded' ? '文字提取、分段与向量索引已完成' : foundationStatus === 'failed' ? '基础解析失败，请查看错误或重试' : foundationJob?.total ? `已建立 ${foundationJob.completed || 0}/${foundationJob.total} 段向量索引` : '等待或正在提取文字'
  if (noText) { foundationStatus = 'skipped'; foundationPercent = 100; foundationLabel = '未发现可提取的文字层，转入完整图文解析' }
  else if (recovered) { foundationStatus = 'succeeded'; foundationPercent = 100; foundationLabel = '文字与向量索引已完成' }
  // A failed or still-running job must never report 100% for its own stage.
  if (!['succeeded', 'skipped'].includes(foundationStatus)) foundationPercent = Math.min(foundationPercent, 99)
  let fullStatus = 'skipped', fullPercent = 100, fullLabel = '此任务未开启完整解析（仅基础文字）'
  if (automatic) {
    const pages = automatic.pages || []
    const total = automatic.totalPages || (automatic.extractionComplete ? pages.length : 0)
    const completed = pages.filter((p) => p.result).length
    const prepared = automatic.extractionComplete ? 1 : ratio(pages.length, total)
    fullPercent = Math.floor(15 * prepared + 75 * ratio(completed, total) + 10 * (indexJob?.status === 'succeeded' ? 1 : ratio(indexJob?.completed, indexJob?.total)))
    fullStatus = automatic.status
    fullLabel = !automatic.extractionComplete ? `正在准备页面${total ? ` ${pages.length}/${total}` : ''}` : `图文已识别 ${completed}/${total || 0} 页`
    if (automatic.status === 'queued') fullLabel = '等待完整图文解析'
    if (automatic.status === 'succeeded') {
      const noIndexNeeded = automatic.indexRequired === false || (!indexJob && automatic.textMerged && version.status === 'ready')
      if (indexJob?.status === 'succeeded' || noIndexNeeded) { fullStatus = 'succeeded'; fullPercent = 100; fullLabel = '图文识别与补充向量索引已完成' }
      else { fullStatus = indexJob?.status === 'failed' ? 'failed' : 'indexing'; fullLabel = indexJob?.status === 'failed' ? '补充向量索引失败，请重试' : '图文识别已完成，正在补充向量索引' }
    }
    if (automatic.status === 'failed') fullLabel = `图文已识别 ${completed}/${total || pages.length} 页，未完成部分待重试`
    if (fullStatus === 'succeeded' && version.status === 'failed') { fullStatus = 'failed'; fullLabel = '未获得可入库文字，请检查识别结果或补充说明' }
    if (fullStatus !== 'succeeded') fullPercent = Math.min(99, fullPercent)
  }
  const overall = automatic ? Math.floor(foundationPercent * 0.2 + fullPercent * 0.8) : foundationPercent
  return { overall, weights: { foundation: automatic ? 20 : 100, full: automatic ? 80 : 0 }, foundation: { status: foundationStatus, percent: foundationPercent, label: foundationLabel }, full: { status: fullStatus, percent: fullPercent, label: fullLabel } }
}
