import { useEffect, useState } from 'react'
import { createWeeklyReport, readWeeklyReports } from './api.js'
import { Icon } from './icons.jsx'
import './adminStudio.css'
import './weeklyReports.css'

export default function WeeklyReports({ copyLink }) {
  const [reports, setReports] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    readWeeklyReports(controller.signal).then(setReports).catch(err => {
      if (!controller.signal.aborted) setError(err.message)
    })
    return () => controller.abort()
  }, [])

  async function generate() {
    setBusy(true)
    setError('')
    try {
      const { report } = await createWeeklyReport()
      setReports(current => [report, ...(current || []).filter(item => item.id !== report.id)])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return <section className="workspace admin-workspace weekly-reports">
    <header className="admin-heading">
      <div><p>每周五 09:00（北京时间）生成，汇总上周五至本周四的主分支更新。持有分享链接的人可以查看报告。</p></div>
      <button type="button" disabled={busy} onClick={generate}>{busy ? '生成中…' : '生成最新一期'}</button>
    </header>
    {error && <p role="alert" className="admin-error">{error}</p>}
    {reports === null && !error && <p role="status">正在加载报告…</p>}
    {reports?.length === 0 && <p>暂无迭代报告。</p>}
    {reports?.map(report => {
      const url = '/api/weekly-reports/' + report.shareId
      return <article key={report.id}>
        <div><h2>{report.from} 至 {report.to}</h2><p>{report.summary}</p></div>
        <div className="weekly-report-actions">
          <a href={url} target="_blank" rel="noreferrer">查看报告</a>
          <button type="button" onClick={async () => {
            try { await copyLink(new URL(url, location.origin).href); setCopied(report.id); setError('') }
            catch { setError('复制失败，请打开报告后复制地址栏链接') }
          }}><Icon name={copied === report.id ? 'check' : 'copy'} size={15}/>{copied === report.id ? '已复制' : '复制链接'}</button>
        </div>
      </article>
    })}
  </section>
}
