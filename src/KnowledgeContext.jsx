import { useEffect, useState } from 'react'
import { getAuthToken } from './api.js'
import { getKnowledgeSelection, knowledgeKey, knowledgeRequest } from './knowledgeApi.js'
import ComposerSelect from './ComposerSelect.jsx'
import './knowledge.css'
export default function KnowledgeContext({ tool }) {
  const [brands, setBrands] = useState([]), [assets, setAssets] = useState([]), [selection, setSelection] = useState(getKnowledgeSelection), [error, setError] = useState('')
  const token = getAuthToken()
  useEffect(() => { if (!token) return; let live = true; knowledgeRequest('/bootstrap').then((d) => { if (live) setBrands(d.brands) }).catch(() => { if (live) setError('品牌知识库暂不可用') }); return () => { live = false } }, [token])
  useEffect(() => {
    if (!selection.brandId || tool !== 'image') return
    let live = true
    knowledgeRequest(`/documents?brandId=${selection.brandId}`).then((d) => { if (live) setAssets(d.documents.filter((x) => x.publishedVersion && ['.png', '.jpg', '.jpeg', '.webp'].includes(x.publishedVersion.ext))) }).catch((e) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [selection.brandId, tool])
  function save(value) { setSelection(value); localStorage.setItem(knowledgeKey('context'), JSON.stringify(value)); setError('') }
  if (!token) return null
  return <ComposerSelect className="knowledge-picker" label="品牌知识库" icon="library" placeholder="知识库" value={selection.brandId || ''} options={[{ value: '', label: '不使用' }, ...brands.map((b) => ({ value: b.id, label: b.name }))]} onChange={(brandId) => save({ brandId, assetIds: [] })} footer={<>
    {selection.brandId && <p>已发布强制规则固定加载，其他资料按任务检索。</p>}
    {selection.brandId && tool === 'image' && <div className="kb-inline-assets"><p>唯一已发布Logo会自动加载；多个Logo请明确选择。</p><label><input type="checkbox" checked={selection.overlayLogo !== false} onChange={(e) => save({ ...selection, overlayLogo: e.target.checked })}/>使用正式Logo原图叠加到左上角</label><b>图片素材（{selection.assetIds?.length || 0}/3）</b>{!assets.length && <p>先在知识库发布图片素材</p>}{assets.map((a) => <label key={a.id}><input type="checkbox" checked={selection.assetIds?.includes(a.id) || false} onChange={(e) => { const ids = selection.assetIds || []; if (e.target.checked && ids.length >= 3) { setError('最多选择 3 张品牌素材'); return }; save({ ...selection, assetIds: e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id) }) }}/>{a.publishedVersion.title}</label>)}</div>}
    {!selection.brandId && <p>选择品牌后，为本次创作调用已发布资料。</p>}{error && <small role="alert">{error}</small>}
  </>}/>
}
