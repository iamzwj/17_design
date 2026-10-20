import { useMemo, useState } from 'react'
import { Icon } from './icons.jsx'
import './materialLibrary.css'

import { IP_ASSETS, BRANDS, LOGO_ASSETS } from '../shared/materialCatalog.js'

const TYPE_LABELS = { all: '全部素材', ip: 'IP 形象', logo: '品牌 Logo' }

function downloadAsset(asset) {
  if (!asset.file) return
  const anchor = document.createElement('a')
  anchor.href = asset.file
  anchor.download = `${asset.name}.png`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function AssetCard({ asset, onPreview }) {
  const available = Boolean(asset.file)
  return <article className={`material-card is-${asset.type}${available ? '' : ' is-pending'}${asset.variant === '反白' ? ' is-reversed' : ''}`}>
    <button className="material-thumb" type="button" disabled={!available} onClick={() => available && onPreview(asset)} aria-label={available ? `预览 ${asset.name}` : `${asset.name} 待上传`}>
      {available
        ? <img src={asset.file} alt={asset.name} loading="lazy" decoding="async"/>
        : <span className="material-pending"><Icon name={asset.type === 'logo' ? 'library' : 'image'} size={24}/><b>待上传</b><small>素材位已预留</small></span>}
      <span className={`material-status ${available ? 'ready' : ''}`}>{available ? '可下载' : '待补充'}</span>
    </button>
    <div className="material-card-copy">
      <span>{asset.kind || `${asset.brand} / ${asset.variant}`}</span>
      <b>{asset.name}</b>
      <small>{asset.note}</small>
    </div>
    {available && <a className="material-link-knowledge" href={`?module=brand-knowledge&material=${encodeURIComponent(asset.id)}`}>关联品牌知识库</a>}
    <button className="material-download" type="button" disabled={!available} onClick={() => downloadAsset(asset)} aria-label={`下载 ${asset.name}`}><Icon name="download" size={15}/>{available ? '下载 PNG' : '暂无文件'}</button>
  </article>
}

function MaterialPreview({ asset, onClose }) {
  return <div className="material-preview" role="dialog" aria-modal="true" aria-label={`${asset.name} 预览`} onClick={onClose}>
    <div className="material-preview-panel" onClick={(event) => event.stopPropagation()}>
      <div className={`material-preview-image${asset.variant === '反白' ? ' is-reversed' : ''}`}><img src={asset.file} alt={asset.name}/></div>
      <div className="material-preview-meta"><div><span>{asset.kind || asset.variant}</span><h2>{asset.name}</h2><p>{asset.note} · PNG</p></div><div><button type="button" onClick={onClose}>关闭</button><a className="material-link-knowledge" href={`?module=brand-knowledge&material=${encodeURIComponent(asset.id)}`}>关联品牌知识库</a><button className="primary" type="button" onClick={() => downloadAsset(asset)}><Icon name="download" size={16}/>下载 PNG</button></div></div>
    </div>
  </div>
}

export default function MaterialLibrary() {
  const [type, setType] = useState('all')
  const [ipGroup, setIpGroup] = useState('cartoon')
  const [brand, setBrand] = useState('all')
  const [variant, setVariant] = useState('all')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState(null)

  const assets = useMemo(() => {
    const ipAssets = IP_ASSETS.map((asset) => ({ ...asset, type: 'ip' })).filter((asset) => asset.group === ipGroup)
    const logos = LOGO_ASSETS.map((asset) => ({ ...asset, type: 'logo' })).filter((asset) => (brand === 'all' || asset.brand === brand) && (variant === 'all' || asset.variant === variant))
    const pool = type === 'ip' ? ipAssets : type === 'logo' ? logos : [...ipAssets, ...logos]
    const normalizedQuery = query.trim().toLowerCase()
    return normalizedQuery ? pool.filter((asset) => `${asset.name} ${asset.kind || ''} ${asset.brand || ''} ${asset.variant || ''}`.toLowerCase().includes(normalizedQuery)) : pool
  }, [brand, ipGroup, query, type, variant])

  const availableCount = assets.filter((asset) => asset.file).length

  return <section className="workspace material-library-workspace">
    <div className="material-library-page">
      <header className="material-library-header">
        <div><span>ASSET LIBRARY</span><h1>素材库</h1><p>统一查找、预览并下载品牌与 IP 标准素材。</p></div>
        <label className="material-search"><Icon name="search" size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、品牌或素材类型" aria-label="搜索素材"/>{query && <button type="button" onClick={() => setQuery('')} aria-label="清除搜索"><Icon name="x" size={14}/></button>}</label>
      </header>

      <div className="material-library-layout">
        <aside className="material-categories" aria-label="素材类别">
          <div className="material-category-heading"><b>素材类别</b><span>{IP_ASSETS.length + LOGO_ASSETS.length}</span></div>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <button type="button" key={value} className={type === value ? 'active' : ''} onClick={() => setType(value)}><Icon name={value === 'logo' ? 'badge' : value === 'ip' ? 'person' : 'library'} size={17}/><span>{label}</span><small>{value === 'ip' ? IP_ASSETS.length : value === 'logo' ? LOGO_ASSETS.length : IP_ASSETS.length + LOGO_ASSETS.length}</small></button>)}
          <div className="material-guide"><Icon name="shield" size={17}/><b>使用提示</b><p>下载后请保持原始比例与透明背景，不拉伸、不改色。</p></div>
        </aside>

        <main className="material-results">
          <div className="material-filter-bar">
            <div className="material-filter-summary"><b>{TYPE_LABELS[type]}</b><span>{assets.length} 项素材 · {availableCount} 项可下载</span></div>
            {(type === 'all' || type === 'ip') && <div className="material-filter-group" aria-label="IP 类型"><span>IP 类型</span>{[['cartoon', '卡通'], ['real', '真人']].map(([value, label]) => <button type="button" key={value} className={ipGroup === value ? 'active' : ''} onClick={() => setIpGroup(value)}>{label}</button>)}</div>}
            {(type === 'all' || type === 'logo') && <div className="material-filter-group" aria-label="Logo 版本"><span>Logo</span>{[['all', '全部'], ['彩色', '彩色'], ['反白', '反白']].map(([value, label]) => <button type="button" key={value} className={variant === value ? 'active' : ''} onClick={() => setVariant(value)}>{label}</button>)}</div>}
          </div>
          {(type === 'all' || type === 'logo') && <div className="material-brand-row" aria-label="品牌筛选"><button type="button" className={brand === 'all' ? 'active' : ''} onClick={() => setBrand('all')}>全部品牌</button>{BRANDS.map((item) => <button type="button" key={item} className={brand === item ? 'active' : ''} onClick={() => setBrand(item)}>{item}</button>)}</div>}
          {assets.length ? <div className="material-grid">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} onPreview={setPreview}/>)}</div> : <div className="material-empty"><Icon name="search" size={24}/><b>没有找到相关素材</b><span>试试其他关键词或筛选条件</span></div>}
        </main>
      </div>
    </div>
    {preview && <MaterialPreview asset={preview} onClose={() => setPreview(null)}/>}
  </section>
}
