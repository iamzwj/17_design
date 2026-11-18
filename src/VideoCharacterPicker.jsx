import { useEffect, useRef, useState } from 'react'
import { getAuthToken, fileToDataUrl } from './api.js'
import { knowledgeRequest } from './knowledgeApi.js'
import { userError } from './userErrors.js'
import './videoCharacterPicker.css'

const apiBase = () => String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
async function readAsset(path) {
  const response = await fetch(apiBase() + path, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: 'no-store' })
  if (!response.ok) throw Error('图片读取失败，请重试')
  return response.blob()
}
function AssetImage({ item }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true, objectUrl
    readAsset(item.path).then((blob) => { objectUrl = URL.createObjectURL(blob); if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl) }).catch(() => {})
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [item.path])
  return url ? <img src={url} alt=""/> : <span className="video-character-loading">图片读取中…</span>
}
export default function VideoCharacterPicker({ onClose, onLocal, onSelect }) {
  const dialog = useRef(null)
  const [section, setSection] = useState('source')
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { dialog.current.showModal() }, [])
  useEffect(() => {
    if (section !== 'library') return
    let active = true
    async function load() {
      const [response, bootstrap] = await Promise.all([
        fetch(apiBase() + '/api/films/characters', { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: 'no-store' }),
        knowledgeRequest('/bootstrap'),
      ])
      if (!response.ok) throw Error('角色库读取失败')
      const personal = (await response.json()).characters.map((item) => ({ id: item.id, name: item.name, group: '我的角色', path: `/api/films/characters/${encodeURIComponent(item.id)}/image` }))
      const brands = await Promise.all(bootstrap.brands.map(async (brand) => {
        const result = await knowledgeRequest(`/generation-assets?brandId=${encodeURIComponent(brand.id)}`)
        return result.assets.filter((asset) => asset.ipType).map((asset) => ({ id: `${brand.id}:${asset.id}`, name: asset.title, group: brand.name, path: `/api/knowledge/generation-assets/${encodeURIComponent(asset.id)}/image?brandId=${encodeURIComponent(brand.id)}` }))
      }))
      if (active) setItems([...personal, ...brands.flat()])
    }
    load().catch((err) => { if (active) setError(userError(err.message)) })
    return () => { active = false }
  }, [section])
  async function choose(item) {
    setBusy(true); setError('')
    try { const blob = await readAsset(item.path); await onSelect({ name: item.name, src: await fileToDataUrl(blob), kind: 'image' }); onClose() }
    catch (err) { setError(userError(err.message)) }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="video-character-sheet" aria-labelledby="video-character-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <header><div><h2 id="video-character-title">{section === 'source' ? '添加图片参考' : '选择角色形象'}</h2><p>{section === 'source' ? '选择图片来源' : '我的角色和品牌知识库中的 IP 形象'}</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="关闭">×</button></header>
    {section === 'source' ? <div className="video-character-sources"><button type="button" onClick={() => { onClose(); onLocal() }}><span>＋</span><b>上传本地图片</b><small>从设备选择图片</small></button><button type="button" onClick={() => setSection('library')}><span>◫</span><b>角色库</b><small>选择角色或品牌 IP</small></button></div> : <><button className="video-character-back" type="button" onClick={() => setSection('source')} disabled={busy}>← 返回</button>{error && <p role="alert">{error}</p>}{!items && !error && <p role="status">正在读取角色库…</p>}{items?.length === 0 && <p>暂无角色形象，可在角色库上传或在品牌知识库发布 IP 图片。</p>}<div className="video-character-items">{items?.map((item) => <button type="button" key={item.id} disabled={busy} onClick={() => void choose(item)}><AssetImage item={item}/><b>{item.name}</b><small>{item.group}</small></button>)}</div></>}
  </dialog>
}
