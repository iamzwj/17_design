import { useState } from 'react'
import { createFestivalPosters, downloadGeneratedImage } from './api.js'
import { Icon } from './icons.jsx'
import './festivalPoster.css'

const DEFAULT_FESTIVAL = '国庆'

export default function FestivalPosterStudio({ onUserUpdate, onRequireLogin }) {
  const [festival, setFestival] = useState(DEFAULT_FESTIVAL)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function generate() {
    const name = festival.trim()
    if (!name || loading) return
    setLoading(true)
    setError('')
    try {
      const data = await createFestivalPosters({ festival: name })
      setResult(data)
      if (data.user) onUserUpdate?.(data.user)
    } catch (requestError) {
      if (requestError.status === 401) onRequireLogin?.()
      else setError(requestError.message || '生成失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return <section className="workspace festival-poster-workspace">
    <div className="festival-poster-page">
      <header className="festival-poster-heading">
        <span>CONTENT CREATION</span>
        <h1>朴邻节日海报</h1>
        <p>输入节日名称，自动规划两套不同的邻里服务场景并生成 9:16 成品海报。</p>
      </header>

      <div className="festival-poster-layout">
        <aside className="festival-poster-panel glass-strong">
          <label htmlFor="festival-name">节日名称</label>
          <div className="festival-input-row">
            <input id="festival-name" value={festival} onChange={(event) => setFestival(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) generate() }} placeholder="例如：国庆、重阳、元旦" maxLength={24}/>
            <button type="button" onClick={generate} disabled={!festival.trim() || loading}>{loading ? '生成中…' : '生成两套方案'}<Icon name="spark" size={17}/></button>
          </div>
          <div className="festival-model-card">
            <div><span>提示词模型</span><b>GRS AI · GPT-5.5</b><small>高推理</small></div>
            <div><span>生图模型</span><b>Image 2.5 Sunburst</b><small>高质量 · 自动降级 Image 2.5</small></div>
          </div>
          <ul className="festival-rules">
            <li>固定输出两套不同服务场景</li>
            <li>自动匹配季节着装与节日氛围</li>
            <li>严格使用领花、风格母版与朴邻蒙版</li>
            <li>规避国旗、国徽、华表等敏感元素</li>
          </ul>
          {loading && <div className="festival-progress"><i/><span>正在规划场景、生成画面并叠加品牌蒙版，通常需要几分钟。</span></div>}
          {error && <div className="festival-error">{error}</div>}
        </aside>

        <main className="festival-poster-results">
          {!result ? <div className="festival-empty glass-strong"><Icon name="image" size={28}/><b>等待节日灵感</b><span>生成后，两套完整海报会显示在这里。</span></div> : <>
            <div className="festival-result-summary"><div><span>{result.festival}</span><b>已生成 2 套方案</b></div><small>提示词：{result.promptModelLabel || 'GPT-5.5 · 高'} · 生图：{result.imageModelLabel || 'Image 2.5 Sunburst · high'}</small></div>
            <div className="festival-poster-grid">
              {(result.posters || []).map((poster, index) => <article className="festival-poster-card glass-strong" key={poster.url || index}>
                <div className="festival-image-wrap"><img src={poster.url} alt={`${result.festival}海报方案${index + 1}`}/><span>方案 {index + 1}</span></div>
                <footer><div><b>{poster.title || `方案 ${index + 1}`}</b><small>{poster.scene || '邻里服务场景'}</small></div><button type="button" onClick={() => downloadGeneratedImage(poster.url, `${result.festival}-方案${index + 1}`)}><Icon name="download" size={16}/>下载</button></footer>
              </article>)}
            </div>
          </>}
        </main>
      </div>
    </div>
  </section>
}
