import { useEffect, useState } from 'react'
import { getAuthToken } from './api.js'
import { getKnowledgeSelection, knowledgeKey, knowledgeRequest } from './knowledgeApi.js'
import ComposerSelect from './ComposerSelect.jsx'
import './knowledge.css'
export default function KnowledgeContext({ tool }) {
  const [brands, setBrands] = useState([]), [assets, setAssets] = useState([]), [selection, setSelection] = useState(getKnowledgeSelection), [error, setError] = useState(''), [color, setColor] = useState(null), [loading, setLoading] = useState(false)
  const token = getAuthToken()
  useEffect(() => { if (!token) return; let live = true; knowledgeRequest('/bootstrap').then((d) => { if (live) setBrands(d.brands) }).catch(() => { if (live) setError('品牌知识库暂不可用') }); return () => { live = false } }, [token])
  useEffect(() => {
    if (!selection.brandId || tool !== 'image') return
    let live = true
    knowledgeRequest(`/generation-assets?brandId=${selection.brandId}`).then((d) => { if (live) { setAssets(d.assets); setColor(d); setLoading(false) } }).catch((e) => { if (live) { setError(e.message); setLoading(false) } })
    return () => { live = false }
  }, [selection.brandId, tool])
  useEffect(() => {
    if (tool === 'image' && selection.brandId && !selection.enforceBrandColors) {
      const next = { ...selection, enforceBrandColors: true }
      localStorage.setItem(knowledgeKey('context'), JSON.stringify(next))
    }
  }, [tool, selection])
  function save(value) { const next = { ...value, ...(tool === 'image' ? { enforceBrandColors: true } : {}) }; setSelection(next); localStorage.setItem(knowledgeKey('context'), JSON.stringify(next)); setError('') }
  const ipMode = selection.ipMode || 'none', ipChoices = assets.filter((a) => a.ipType === ipMode)
  const ipId = selection.ipAssetIds?.[0] || (ipChoices.length === 1 ? ipChoices[0].id : '')
  if (!token) return null
  return <ComposerSelect className="knowledge-picker" label="品牌知识库" icon="library" placeholder="知识库" value={selection.brandId || ''} options={[{ value: '', label: '不使用' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} onChange={(brandId) => { setAssets([]); setColor(null); setLoading(Boolean(brandId)); save({ brandId, assetIds: [], ipMode: 'none', ipAssetIds: [], logoVariant: 'color' }) }} footer={<>
    {selection.brandId && tool !== 'image' && <p>已发布强制规则固定加载，其他资料按任务检索。</p>}
    {selection.brandId && tool === 'image' && <div className="kb-generation-brand"><p>正式Logo自动加载，标准色固定以已发布品牌手册为准。</p>{loading && <p>正在读取品牌素材…</p>}<b>Logo</b><div className="kb-brand-options" role="group" aria-label="Logo版本">{[['color', '彩色'], ['white', '反白']].map(([value, label]) => <button key={value} type="button" aria-pressed={(selection.logoVariant || 'color') === value} disabled={!assets.some((a) => a.kind === 'logo' && (a.variant === (value === 'color' ? '彩色' : '反白') || (value === 'color' && !a.variant)))} onClick={() => save({ ...selection, logoVariant: value, assetIds: (selection.assetIds || []).filter((id) => assets.find((a) => a.id === id)?.kind !== 'logo') })}>{label}</button>)}</div>{!loading && !assets.some((a) => a.kind === 'logo') && <small>暂无正式Logo原图，请上传或关联素材库。</small>}<b>IP形象</b><div className="kb-brand-options" role="group" aria-label="IP类型">{[['none', '不使用'], ['cartoon', '卡通IP'], ['real', '真人IP']].map(([value, label]) => <button key={value} type="button" aria-pressed={ipMode === value} disabled={value !== 'none' && !assets.some((a) => a.ipType === value)} onClick={() => { const choices = assets.filter((a) => a.ipType === value); save({ ...selection, ipMode: value, ipAssetIds: choices.length === 1 ? [choices[0].id] : [] }) }}>{label}{value !== 'none' && !loading && !assets.some((a) => a.ipType === value) ? ' · 未上传' : ''}</button>)}</div>{ipMode !== 'none' && <div className="kb-ip-roles">{ipChoices.map((a) => <label key={a.id}><input type="radio" name="kb-ip-role" checked={ipId === a.id} onChange={() => save({ ...selection, ipAssetIds: [a.id] })}/>{a.title}</label>)}</div>}{color && <div className={`kb-brand-color-status${color.colorReady ? '' : ' missing'}`}><b>品牌标准色</b><p>{color.colorStatus}</p>{!color.colorReady && <a href={`?module=brand-knowledge&brand=${encodeURIComponent(selection.brandId)}`}>去知识库发布品牌手册</a>}</div>}<label className="kb-logo-overlay"><input type="checkbox" checked={selection.overlayLogo !== false} onChange={(e) => save({ ...selection, overlayLogo: e.target.checked })}/>使用Logo原图叠加到左上角</label>{assets.some((a) => a.kind !== 'logo' && !a.ipType) && <details><summary>其他参考素材</summary>{assets.filter((a) => a.kind !== 'logo' && !a.ipType).map((a) => <label key={a.id}><input type="checkbox" checked={selection.assetIds?.includes(a.id) || false} onChange={(e) => { const ids = selection.assetIds || []; save({ ...selection, assetIds: e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id) }) }}/>{a.title}</label>)}</details>}</div>}
    {!selection.brandId && <p>选择品牌后，为本次创作调用品牌Logo、<br/>可选IP和已发布资料。</p>}{error && <small role="alert">{error}</small>}
  </>}/>
}
