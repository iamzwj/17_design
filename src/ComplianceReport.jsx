import { reviewLogoAssets } from './complianceLogoAssets.js'
import { parseComplianceReport } from './complianceReport.js'
import './complianceReport.css'

function Finding({ item, pending, brand }) {
  const logos = pending ? [] : reviewLogoAssets(brand, item)
  const standaloneText = item.title && !item.location && !item.problem && !item.fix && !item.extra.length && !item.basis.length
  return <article className={`review-finding${pending ? ' is-pending' : ''}`}>
    {standaloneText ? <p className="review-standalone">{item.title}</p> : <h4>{item.title || (pending ? '需要补充确认' : '发现硬性问题')}</h4>}
    {item.location && <p className="review-location">{item.location}</p>}
    {item.problem && <div className="review-finding-row"><b>{pending ? '待核验原因' : '问题'}</b><p>{item.problem}</p></div>}
    {item.fix && <div className="review-finding-row review-fix"><b>{pending ? '需确认' : '怎么改'}</b><p>{item.fix}</p></div>}
    {logos.length > 0 && <section className="review-logo-assets" aria-label="标准 Logo 下载">
      <header><b>{logos[0].brand}标准 Logo</b><a href={`?module=assets&type=logo&brand=${encodeURIComponent(logos[0].brand)}`} target="_blank" rel="noopener noreferrer">前往素材库 ↗</a></header>
      <div className="review-logo-grid">{logos.map((asset) => <article key={asset.id}>
        <div className={`review-logo-preview${asset.variant === '反白' ? ' is-reversed' : ''}`}><img src={asset.file} alt={asset.name} loading="lazy"/></div>
        <div><span>{asset.variant} · 透明底 PNG</span><a href={asset.file} download={`${asset.name}.png`}>下载{asset.variant} Logo</a></div>
      </article>)}</div>
    </section>}
    {item.extra.map((line, i) => <p className="review-extra" key={i}>{line}</p>)}
    {item.basis.length > 0 && <details className="review-evidence"><summary>查看依据</summary>{item.basis.map((line, i) => <p key={i}>{line}</p>)}</details>}
  </article>
}
export default function ComplianceReport({ content, brand }) {
  const report = parseComplianceReport(content)
  const blocked = report.conclusion.includes('禁止发布'), needsChange = report.issues.length > 0
  return <div className="compliance-report review-report">
    <header className={`review-verdict${blocked ? ' is-blocked' : needsChange ? ' needs-change' : ''}`}><span>审核结论</span><strong>{report.conclusion}</strong>{report.summary.length > 0 && <p>{report.summary.join(' ')}</p>}</header>
    {report.issues.length > 0 && <section className="review-section" aria-label="硬性问题"><h3>硬性问题 <span>{report.issues.length} 项</span></h3>{report.issues.map((item, i) => <Finding item={item} brand={brand} key={i}/>)}</section>}
    {report.pending.length > 0 && <section className="review-section review-pending" aria-label="待核验"><h3>待核验 <span>{report.pending.length} 项</span></h3><p className="review-section-hint">以下项目证据不足，尚不能判定为错误。</p>{report.pending.map((item, i) => <Finding item={item} pending key={i}/>)}</section>}
    {report.suggestions.length > 0 && <aside className="review-recommendations" aria-label="参考建议（非必改）"><b>参考建议（非必改）</b>{report.suggestions.slice(0, 3).map((item, i) => <p key={i}>{[item.title, item.fix || item.problem, ...item.extra].filter(Boolean).join('：')}</p>)}</aside>}
    {report.notes.length > 0 && <div className="review-notes">{report.notes.map((line, i) => <p key={i}>{line}</p>)}</div>}
    {report.passed.length > 0 && <details className="review-checked"><summary>已检查且未发现明确问题的项目 · {report.passed.length} 项</summary>{report.passed.map((item, i) => <Finding item={item} key={i}/>)}</details>}
  </div>
}
