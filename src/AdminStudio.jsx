import { userError } from './userErrors.js'
import { useEffect, useMemo, useState } from 'react'
import { getAdminOverview } from './api.js'
import { Icon } from './icons.jsx'
import './adminStudio.css'

function displayTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function ImageDetails({ item, onClose }) {
  if (!item) return null
  return <div className="admin-image-modal-scrim" role="presentation" onMouseDown={onClose}>
    <section className="admin-image-modal glass-strong" role="dialog" aria-modal="true" aria-label="图片详细信息" onMouseDown={(event) => event.stopPropagation()}>
      <button className="admin-modal-close" type="button" onClick={onClose} aria-label="关闭"><Icon name="x" size={18}/></button>
      <img src={item.url} alt="生成图片"/>
      <div className="admin-image-details">
        <div><span>生成时间</span><b>{displayTime(item.createdAt)}</b></div>
        <div><span>模型</span><b>{item.model || '—'}</b></div>
        <div><span>分辨率</span><b>{item.resolution || '—'}</b></div>
        <div><span>画面比例</span><b>{item.aspectRatio || '—'}</b></div>
        <label><span>提示词</span><p>{item.prompt || '—'}</p></label>
      </div>
    </section>
  </div>
}

export default function AdminStudio() {
  const [overview, setOverview] = useState(null)
  const [selectedImage, setSelectedImage] = useState(null)
  const [expandedUsers, setExpandedUsers] = useState(() => new Set())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true); setError('')
    try { setOverview(await getAdminOverview()) } catch (requestError) { setError(userError(requestError.message) || '后台数据加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])

  const imagesByUser = useMemo(() => {
    const grouped = new Map()
    for (const image of overview?.images || []) {
      const list = grouped.get(image.userId) || []
      list.push(image)
      grouped.set(image.userId, list)
    }
    return grouped
  }, [overview])

  const users = overview?.users || []
  const metrics = overview?.metrics || {}
  const number = (value) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value)
  const cards = [
    ['日活跃量', number(metrics.dailyActive)], ['月活跃量', number(metrics.monthlyActive)],
    ['总活跃量', number(metrics.totalActive)], ['周日均活', number(metrics.weeklyAverage)],
    ['白名单人数', number(metrics.whitelistCount)], ['注册用户', number(metrics.registeredUsers ?? users.length)],
    ['总生图数量', number(metrics.totalImages)], ['注册率', metrics.registrationRate == null ? '—' : `${metrics.registrationRate.toFixed(2)}%`],
    ['使用率', metrics.usageRate == null ? '—' : `${metrics.usageRate.toFixed(2)}%`],
  ]

  return <section className="workspace admin-workspace">
    <div className="admin-page">
      <header className="admin-heading"><div><span>ADMINISTRATION</span><h1>后台管理</h1><p>用户活跃、注册与图片生成数据概览。</p></div><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? '加载中…' : '刷新数据'}</button></header>
      {error ? <div className="admin-error" role="alert">{error}</div> : loading && !overview ? <div className="admin-loading"><i/><span>正在加载后台数据…</span></div> : <>
        <div className="admin-summary">{cards.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
        <p className="admin-metric-note">活跃指生成过图片的用户；周日均活为近 7 天平均值，日期按北京时间统计。使用率为活跃用户占注册用户比例。注册率为白名单中已注册用户比例。</p>
        <h2 className="admin-users-heading">用户与生成记录 <span>{users.length} 位用户</span></h2>
        <section className="admin-user-list">{users.map((user) => {
          const images = imagesByUser.get(user.id) || []
          const expanded = expandedUsers.has(user.id)
          return <article className="admin-user-card glass-strong" key={user.id}>
            <header><div><button className="admin-user-toggle" type="button" aria-expanded={expanded} aria-controls={`admin-images-${user.id}`} onClick={() => setExpandedUsers((current) => { const next = new Set(current); if (next.has(user.id)) next.delete(user.id); else next.add(user.id); return next })}><b>{user.email}</b><span aria-hidden="true">{expanded ? '⌄' : '›'}</span></button><small>注册于 {displayTime(user.createdAt)}</small></div><span><small>剩余积分</small><strong>{user.credits ?? 0}</strong></span></header>
            <div id={`admin-images-${user.id}`} hidden={!expanded}>{expanded && (images.length ? <div className="admin-image-grid">{images.map((image) => <button type="button" key={image.id} onClick={() => setSelectedImage(image)} title="查看图片详细信息"><img src={image.thumbnailUrl || image.url} alt="生成图片" loading="lazy"/></button>)}</div> : <div className="admin-images-empty">该账户暂未生成图片</div>)}</div>
          </article>
        })}</section>
      </>}
    </div>
    <ImageDetails item={selectedImage} onClose={() => setSelectedImage(null)}/>
  </section>
}
