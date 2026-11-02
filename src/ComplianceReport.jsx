import { parseComplianceReport } from './complianceReport.js'
import './complianceReport.css'

function Finding({ item, pending }) {
  return <article className={`review-finding${pending ? ' is-pending' : ''}`}>
    <h4>{item.title || (pending ? '需要补充确认' : '发现硬性问题')}</h4>
    {item.location && <p className="review-location">{item.location}</p>}
    {item.problem && <div className="review-finding-row"><b>{pending ? '待核验原因' : '问题'}</b><p>{item.problem}</p></div>}
    {item.fix && <div className="review-finding-row review-fix"><b>{pending ? '需确认' : '怎么改'}</b><p>{item.fix}</p></div>}
    {item.extra.map((line, i) => <p className="review-extra" key={i}>{line}</p>)}
    {item.basis.length > 0 && <details className="review-evidence"><summary>查看依据</summary>{item.basis.map((line, i) => <p key={i}>{line}</p>)}</details>}
  </article>
}
export default function ComplianceReport({ content }) {
  const report = parseComplianceReport(content)
  const blocked = report.conclusion.includes('禁止发布'), needsChange = report.issues.length > 0
  return <div className="compliance-report review-report">
    <header className={`review-verdict${blocked ? ' is-blocked' : needsChange ? ' needs-change' : ''}`}><span>审核结论</span><strong>{report.conclusion}</strong>{report.summary.length > 0 && <p>{report.summary.join(' ')}</p>}</header>
    {report.issues.length > 0 && <section className="review-section" aria-label="硬性问题"><h3>硬性问题 <span>{report.issues.length} 项</span></h3>{report.issues.map((item, i) => <Finding item={item} key={i}/>)}</section>}
    {report.pending.length > 0 && <section className="review-section review-pending" aria-label="待核验"><h3>待核验 <span>{report.pending.length} 项</span></h3><p className="review-section-hint">以下项目证据不足，尚不能判定为错误。</p>{report.pending.map((item, i) => <Finding item={item} pending key={i}/>)}</section>}
    {report.notes.length > 0 && <div className="review-notes">{report.notes.map((line, i) => <p key={i}>{line}</p>)}</div>}
    {report.passed.length > 0 && <details className="review-checked"><summary>已检查且未发现明确问题的项目 · {report.passed.length} 项</summary>{report.passed.map((item, i) => <Finding item={item} key={i}/>)}</details>}
  </div>
}
