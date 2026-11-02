const statusLabel = { queued: '等待中', running: '处理中', processing: '处理中', indexing: '建立索引中', succeeded: '已完成', failed: '待重试', skipped: '已跳过' }
export default function KnowledgeProgress({ progress }) {
  if (!progress) return null
  return <section className="kb-overall-progress" aria-label="资料整体解析进度">
    <header><h3>整体解析进度</h3><strong>{progress.overall}%</strong></header>
    <progress aria-label="整体解析进度" value={progress.overall} max="100"/>
    <div className="kb-progress-stages">{[['foundation', '基础文字向量解析'], ['full', '完整图文解析']].map(([key, label]) => {
      const stage = progress[key]
      return <div className={`kb-progress-stage ${stage.status}`} key={key}><header><b>{label}</b><span>{key === 'full' && !progress.weights.full ? '未启用' : `${stage.percent}% · ${statusLabel[stage.status] || '处理中'}`}</span></header><progress aria-label={label} value={key === 'full' && !progress.weights.full ? 0 : stage.percent} max="100"/><small>{stage.label}</small></div>
    })}</div>
    <small>{progress.weights.full ? '整体按基础解析 20% + 完整解析 80% 计算；完成后仍需核对发布。' : '本任务仅包含基础文字解析；完成后仍需核对发布。'}</small>
  </section>
}
