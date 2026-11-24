import WorkspaceLoading from './WorkspaceLoading.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import './materialLibrary.css'

import { knowledgeDownload, knowledgeRequest } from './knowledgeApi.js'

const TYPE_LABELS = { all: '全部素材', ip: 'IP 形象', logo: '品牌 Logo' }

function MaterialImage({ asset, eager = false }) {
  const ref = useRef(null)
  const [url, setUrl] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl
    const load = () => {
      knowledgeDownload(asset.file, '', true, { signal: controller.signal }).then(result => {
        if (controller.signal.aborted) { URL.revokeObjectURL(result); return }
        objectUrl = result
        setUrl(result)
      }).catch(() => {})
    }
    const observer = eager ? null : new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      load()
    }, { rootMargin: '200px' })
    if (observer) observer.observe(ref.current)
    else load()
    return () => {
      observer?.disconnect()
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [asset.file, eager])
  return <img ref={ref} src={url || undefined} alt={asset.name} decoding="async"/>
}

function AssetCard({ asset, onPreview, onDownload }) {
  const available = Boolean(asset.file)
  return <article className={`material-card is-${asset.type}${available ? '' : ' is-pending'}${asset.variant === '反白' ? ' is-reversed' : ''}`}>
    <button className="material-thumb" type="button" disabled={!available} onClick={() => available && onPreview(asset)} aria-label={available ? `预览 ${asset.name}` : `${asset.name} 待上传`}>
      {available
        ? <MaterialImage asset={asset}/>
        : <span className="material-pending"><Icon name={asset.type === 'logo' ? 'library' : 'image'} size={24}/><b>待上传</b><small>素材位已预留</small></span>}
      {!available && <span className="material-status">待补充</span>}
    </button>
    <div className="material-card-copy">
      <span>{asset.kind || `${asset.brand} / ${asset.variant}`}</span>
      <b>{asset.name}</b>
      <small>{asset.note}</small>
    </div>
    {available && <a className="material-link-knowledge" href={`?module=brand-knowledge&material=${encodeURIComponent(asset.id)}`}>关联品牌知识库</a>}
    <button className="material-download" type="button" disabled={!available} onClick={() => onDownload(asset)} aria-label={`下载 ${asset.name}`}><Icon name="download" size={15}/>{available ? '下载 PNG' : '暂无文件'}</button>
  </article>
}

function MaterialPreview({ asset, onClose, onDownload }) {
  return <div className="material-preview" role="dialog" aria-modal="true" aria-label={`${asset.name} 预览`} onClick={onClose}>
    <div className="material-preview-panel" onClick={(event) => event.stopPropagation()}>
      <div className={`material-preview-image${asset.variant === '反白' ? ' is-reversed' : ''}`}><MaterialImage asset={asset} eager/></div>
      <div className="material-preview-meta"><div><span>{asset.kind || asset.variant}</span><h2>{asset.name}</h2><p>{asset.note} · PNG</p></div><div><button type="button" onClick={onClose}>关闭</button><a className="material-link-knowledge" href={`?module=brand-knowledge&material=${encodeURIComponent(asset.id)}`}>关联品牌知识库</a><button className="primary" type="button" onClick={() => onDownload(asset)}><Icon name="download" size={16}/>下载 PNG</button></div></div>
    </div>
  </div>
}

export default function MaterialLibrary({ user, onLogin }) {
  const [catalog, setCatalog] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  useEffect(() => {
    if (!user?.id) return
    const controller = new AbortController()
    knowledgeRequest('/material-library', undefined, 'GET', { signal: controller.signal })
      .then(({ assets }) => setCatalog(assets))
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message) })
    return () => controller.abort()
  }, [user?.id])

  async function downloadAsset(asset) {
    setDownloadError('')
    try { await knowledgeDownload(asset.file, `${asset.name}.png`) }
    catch (error) { setDownloadError(error.message) }
  }

  const brands = useMemo(() => [...new Set((catalog || []).filter(asset => asset.type === 'logo').map(asset => asset.brand))], [catalog])
  const ipCount = (catalog || []).filter(asset => asset.type === 'ip').length
  const logoCount = (catalog || []).filter(asset => asset.type === 'logo').length
  const [type, setType] = useState(() => { const value = new URLSearchParams(window.location.search).get('type'); return Object.hasOwn(TYPE_LABELS, value) ? value : 'all' })
  const [ipGroup, setIpGroup] = useState('cartoon')
  const [brand, setBrand] = useState(() => { const value = new URLSearchParams(window.location.search).get('brand'); return value || 'all' })
  const [variant, setVariant] = useState('all')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState(null)

  const activeBrand = brands.includes(brand) ? brand : 'all'
  const assets = useMemo(() => {
    const ipAssets = (catalog || []).filter(asset => asset.type === 'ip' && asset.group === ipGroup)
    const logos = (catalog || []).filter(asset => asset.type === 'logo' && (activeBrand === 'all' || asset.brand === activeBrand) && (variant === 'all' || asset.variant === variant))
    const pool = type === 'ip' ? ipAssets : type === 'logo' ? logos : [...ipAssets, ...logos]
    const normalizedQuery = query.trim().toLowerCase()
    return normalizedQuery ? pool.filter((asset) => `${asset.name} ${asset.kind || ''} ${asset.brand || ''} ${asset.variant || ''}`.toLowerCase().includes(normalizedQuery)) : pool
  }, [activeBrand, catalog, ipGroup, query, type, variant])

  const availableCount = assets.filter((asset) => asset.file).length

  return <section className="workspace material-library-workspace">
    <div className="material-library-page">
      <header className="material-library-header">
        <div><span>ASSET LIBRARY</span><h1>品牌素材</h1></div>
        <label className="material-search"><Icon name="search" size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、品牌或素材类型" aria-label="搜索素材"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="清除搜索"><Icon name="x" size={14}/></button>}</label>
      </header>

      {downloadError && <p role="alert">{downloadError}</p>}
      {!user ? <div className="material-empty"><b>登录后查看素材库</b><button type="button" className="primary-button" onClick={onLogin}>登录</button></div>
        : loadError ? <p role="alert">{loadError}</p>
        : !catalog ? <WorkspaceLoading>正在加载素材…</WorkspaceLoading>
        : <div className="material-library-layout">
        <aside className="material-categories" aria-label="素材类别">
          <div className="material-category-heading"><b>素材类别</b><span>{ipCount + logoCount}</span></div>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <button type="button" key={value} className={type === value ? 'active' : ''} onClick={() => setType(value)}><Icon name={value === 'logo' ? 'badge' : value === 'ip' ? 'person' : 'library'} size={17}/><span>{label}</span><small>{value === 'ip' ? ipCount : value === 'logo' ? logoCount : ipCount + logoCount}</small></button>)}
          <div className="material-guide"><Icon name="shield" size={17}/><b>使用提示</b><p>下载后请保持原始比例与透明背景，不拉伸、不改色。</p></div>
        </aside>

        <main className="material-results">
          <div className="material-filter-bar">
            <div className="material-filter-summary"><b>{TYPE_LABELS[type]}</b><span>{assets.length} 项素材 · {availableCount} 项可下载</span></div>
            {(type === 'all' || type === 'ip') && <div className="material-filter-group" aria-label="IP 类型"><span>IP 类型</span>{[['cartoon', '卡通'], ['real', '真人']].map(([value, label]) => <button type="button" key={value} className={ipGroup === value ? 'active' : ''} onClick={() => setIpGroup(value)}>{label}</button>)}</div>}
            {(type === 'all' || type === 'logo') && <div className="material-filter-group" aria-label="Logo 版本"><span>Logo</span>{[['all', '全部'], ['彩色', '彩色'], ['反白', '反白']].map(([value, label]) => <button type="button" key={value} className={variant === value ? 'active' : ''} onClick={() => setVariant(value)}>{label}</button>)}</div>}
          </div>
          {(type === 'all' || type === 'logo') && <div className="material-brand-row" aria-label="品牌筛选"><button type="button" className={activeBrand === 'all' ? 'active' : ''} onClick={() => setBrand('all')}>全部品牌</button>{brands.map((item) => <button type="button" key={item} className={activeBrand === item ? 'active' : ''} onClick={() => setBrand(item)}>{item}</button>)}</div>}
          {assets.length ? <div className="material-grid">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} onPreview={setPreview} onDownload={downloadAsset}/>)}</div> : <div className="material-empty"><Icon name="search" size={24}/><b>没有找到相关素材</b><span>试试其他关键词或筛选条件</span></div>}
        </main>
      </div>}
    </div>
    {preview && <MaterialPreview asset={preview} onDownload={downloadAsset} onClose={() => setPreview(null)}/>}
  </section>
}
