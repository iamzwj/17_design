import { useEffect, useState } from 'react'
import { knowledgeKey, knowledgeRequest } from './knowledgeApi.js'
import { Icon } from './icons.jsx'

export default function KnowledgeMaterials({ brand, canPublish, initialAssetId, onClose, onComplete }) {
  const key = knowledgeKey(`material-link:${brand.id}`)
  const [assets, setAssets] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [selected, setSelected] = useState(() => { try { return initialAssetId ? [initialAssetId] : JSON.parse(localStorage.getItem(key)) || [] } catch { return [] } })
  useEffect(() => { localStorage.setItem(key, JSON.stringify(selected)) }, [key, selected])
  useEffect(() => { let live = true; knowledgeRequest(`/materials?brandId=${brand.id}`).then((r) => { if (live) setAssets(r.assets) }).catch((e) => { if (live) setError(e.message) }).finally(() => { if (live) setLoading(false) }); return () => { live = false } }, [brand.id])
  async function link(publish) {
    setBusy(true); setError('')
    try { const r = await knowledgeRequest('/material-links', { brandId: brand.id, assetIds: valid, publish }); localStorage.removeItem(key); await onComplete(r, publish) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const valid = selected.filter((id) => assets.some((a) => a.id === id && a.available))
  return <section className="kb-material-panel" aria-label="关联素材库"><header><div><h2>关联素材库 · {brand.name}</h2><p>复用已上传的 Logo 和 IP 形象，不用重复上传。每次使用的文件版本会保留，便于追溯。</p></div><button aria-label="关闭素材关联" onClick={onClose}><Icon name="x" size={16}/></button></header>{error && <div className="kb-alert" role="alert">{error}</div>}{loading ? <p>正在读取素材库…</p> : <>{!assets.length && <p>此品牌暂无可关联的Logo或IP文件。素材库中只有占位、未上传的项目不能关联。</p>}{[['logo', '本品牌Logo'], ['ip', 'IP形象 · 可跨品牌关联']].map(([type, label]) => <div key={type}><h3>{label}</h3><div className="kb-material-grid">{assets.filter((a) => a.type === type).sort((a, b) => Number(b.recommended) - Number(a.recommended)).map((a) => <label className={`kb-material-card${a.variant === '反白' ? ' reversed' : ''}`} key={a.id}><input type="checkbox" disabled={busy || !a.available} checked={selected.includes(a.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))}/><span className="kb-material-thumb"><img src={a.file} alt={a.name}/></span><span><b>{a.name}</b><small>{a.type === 'logo' ? a.variant : a.note}{a.recommended ? ' · 本品牌' : ''}</small><small>{!a.available ? '文件暂不可用' : a.linkedDocumentId ? a.sourceUpdated ? '素材库有更新 · 可重新关联' : a.published ? '已关联并发布' : '已关联 · 草稿或处理中' : '尚未关联'}</small></span></label>)}</div></div>)}<p className="kb-caption">彩色Logo关联并发布后默认用于生图，反白版可在生图参数中手动选择。IP以原始素材传入模型，用于保持角色特征；生成结果仍需检查。</p><div className="kb-actions"><span>已选 {valid.length} 项</span>{canPublish && <button className="kb-primary" disabled={busy || !valid.length} onClick={() => link(true)}>{busy ? '正在关联…' : '关联并发布'}</button>}<button disabled={busy || !valid.length} onClick={() => link(false)}>仅关联为草稿</button></div></>}
  </section>
}
