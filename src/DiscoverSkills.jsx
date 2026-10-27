import { useCallback, useEffect, useState } from 'react'
import { Icon } from './icons.jsx'
import { readDiscovery, updateDiscovery, recoverDiscovery, searchExternal, previewExternal, installExternal, redownloadExternal, uninstallExternal, installedLocalSkills, localSkillText } from './externalSkillClient.js'
import './skillLibrary.css'
import './discoverSkills.css'

export default function DiscoverSkills({ user, onLogin, onUse }) {
  const owner = user?.id || 'guest'
  const [state, setState] = useState(() => readDiscovery(owner)), [installed, setInstalled] = useState([]), [loading, setLoading] = useState(false), [localDetail, setLocalDetail] = useState(null)
  const load = useCallback(async () => { if (!user) return; setLoading(true); try { const records = await installedLocalSkills(); setInstalled(records) } catch (error) { updateDiscovery(owner, { error: error.message }) } finally { setLoading(false) } }, [user, owner])
  useEffect(() => {
    if (!user) return
    recoverDiscovery(owner)
    const changed = (event) => { if (event.detail && event.detail !== owner) return; setState(readDiscovery(owner)); void load() }
    const stateOnly = (event) => { if (!event.detail || event.detail === owner) setState(readDiscovery(owner)) }
    const focus = () => { setState(readDiscovery(owner)); void load() }
    window.addEventListener('dgen-discovery-change', stateOnly); window.addEventListener('dgen-generation-skill', changed); window.addEventListener('focus', focus)
    setState(readDiscovery(owner)); void load()
    return () => { window.removeEventListener('dgen-discovery-change', stateOnly); window.removeEventListener('dgen-generation-skill', changed); window.removeEventListener('focus', focus) }
  }, [user, owner, load])
  const patch = (value) => updateDiscovery(owner, value)
  const working = (id) => state.jobs[id]?.status === 'running'
  const preview = state.preview
  const running = Object.entries(state.jobs).filter(([, job]) => job.status === 'running')
  async function viewLocal(record) { try { setLocalDetail({ record, markdown: await localSkillText(owner, record) }) } catch (error) { patch({ error: error.message }); void load() } }
  function exportText(markdown, name = 'SKILL.md') { const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000) }
  const use = (record, target) => { if (!record.localReady || !record.compatibility.usable) return; onUse(record, target) }
  return <section className="skill-workspace"><div className="skill-page discover-page">
    <header className="skill-header"><div><h1>发现 Skill<span>把适合你的方法，留在这台电脑。</span></h1><p>搜索开放 Skill，预览后下载到本机。安装记录仅当前账号可见，不会加入团队 Skill。</p></div></header>
    {!user ? <div className="skill-empty"><Icon name="search" size={36}/><h2>登录后发现并安装 Skill</h2><p>不同账号的安装目录和本地文件独立管理。</p><button className="skill-primary" onClick={onLogin}>登录并开始</button></div> : <>
      <nav className="skill-tabs discover-tabs" aria-label="发现 Skill 范围">{[['discover', '发现'], ['installed', '已安装']].map(([value, label]) => <button key={value} aria-pressed={state.tab === value} onClick={() => { patch({ tab: value, preview: null }); setLocalDetail(null); void load() }}>{label}{value === 'installed' && <small>{installed.length}</small>}</button>)}</nav>
      <p className="discover-storage-note">MD 文件只保存在当前浏览器的本地文件区。更换电脑、浏览器或清除站点数据后，请在“已安装”中重新下载。</p>
      {state.error && <div className="skill-alert" role="alert">{state.error}<button onClick={() => { patch({ error: '' }); void load() }}>关闭提示</button></div>}
      {state.notice && <div className="skill-notice" role="status">{state.notice}</div>}
      {running.length > 0 && <div className="discover-progress" role="status"><span className="skill-spinner"/>正在{running.some(([id]) => id === 'search') ? '搜索' : running.some(([id]) => id === 'preview') ? '读取预览' : '下载或处理本地文件'}，切换模块后可回来继续查看。</div>}
      {localDetail ? <article className="skill-detail"><button onClick={() => setLocalDetail(null)}>返回已安装</button><div className="skill-detail-heading"><h2>{localDetail.record.title}</h2><p>{localDetail.record.source} · {localDetail.record.commit.slice(0, 7)}</p></div><div className="skill-actions"><button onClick={() => exportText(localDetail.markdown)}>导出 MD</button></div><pre className="discover-markdown">{localDetail.markdown}</pre></article> : preview && state.tab === 'discover' ? <article className="skill-detail">
        <button onClick={() => patch({ preview: null })}>返回搜索结果</button><div className="skill-detail-heading"><span>来源：{preview.source} · 版本 {preview.commit.slice(0, 7)}</span><h2>{preview.title}</h2><p>{preview.summary}</p></div>
        <div className={`discover-compatibility ${preview.compatibility.usable ? 'ready' : 'adapt'}`}><b>{preview.compatibility.usable ? '文字规则可用' : '需要适配'}</b><p>{preview.compatibility.reason}</p>{preview.compatibility.dependencies.length > 0 && <p>依赖：{preview.compatibility.dependencies.join('、')}</p>}</div>
        <div className="skill-actions"><button className="skill-primary" disabled={working(`install:${preview.source}/${preview.name}`)} onClick={() => { void installExternal(owner, preview) }}>下载并安装到本机</button><a href={`https://github.com/${preview.source}/tree/${preview.commit}/${preview.path.split('/').slice(0, -1).map(encodeURIComponent).join('/')}`} target="_blank" rel="noreferrer">查看原始来源</a></div><p className="discover-storage-note">当前安装 SKILL.md。依赖脚本、附件或外部工具的 Skill 可下载阅读，适配前不会出现在生成工具中；安装不会执行代码。</p><pre className="discover-markdown">{preview.markdown}</pre>
      </article> : state.tab === 'discover' ? <>
        <form className="discover-search" onSubmit={(event) => { event.preventDefault(); if (state.query.trim().length >= 2) void searchExternal(owner, state.query) }}><label className="skill-search"><Icon name="search" size={17}/><input aria-label="搜索外部 Skill" placeholder="搜索用途或名称，例如 poster、marketing" maxLength={120} value={state.query} onChange={(event) => patch({ query: event.target.value })}/></label><button className="skill-primary" disabled={state.query.trim().length < 2 || working('search')}>搜索 Skill</button></form>
        {state.results.length ? <div className="discover-grid">{state.results.map((record) => <article className="discover-card" key={`${record.source}/${record.name}`}><span className="discover-source">{record.source}</span><h2>{record.name}</h2><p>{Number(record.installs).toLocaleString('zh-CN')} 次安装 · 来源 skills.sh</p><div className="skill-actions"><button disabled={working('preview')} onClick={() => { void previewExternal(owner, record) }}>预览与下载</button><a href={record.url} target="_blank" rel="noreferrer">查看目录</a></div></article>)}</div> : <div className="skill-empty"><Icon name="search" size={36}/><h2>寻找下一份好方法</h2><p>搜索公开 Skill，确认内容和适用能力后再安装到本机。</p></div>}
      </> : <>
        <div className="discover-list-heading"><h2>我的已安装 Skill</h2><button disabled={loading} onClick={() => { void load() }}>检查本地文件</button></div>
        {loading && !installed.length ? <div className="skill-empty" role="status">正在检查安装记录和本地 MD…</div> : installed.length ? <div className="discover-grid">{installed.map((record) => <article className="discover-card" key={record.id}><div className="discover-card-top"><span className="discover-source">{record.source}</span><b className={`discover-status ${record.localReady ? 'ready' : 'missing'}`}>{record.localReady ? record.compatibility.usable ? '本机已就绪' : '需适配' : '需重新下载'}</b></div><h2>{record.title}</h2><p>{record.summary}</p><small>版本 {record.commit.slice(0, 7)} · 仅自己可见</small>{!record.localReady && <p className="discover-missing">{record.localError}</p>}{record.localReady && !record.compatibility.usable && <p>{record.compatibility.reason}</p>}<div className="skill-actions">{record.localReady ? <button onClick={() => { void viewLocal(record) }}>查看 MD</button> : <button className="skill-primary" disabled={working(`download:${record.id}`)} onClick={() => { void redownloadExternal(owner, record) }}>重新下载 MD</button>}{record.localReady && record.compatibility.usable && ['image', 'video'].map((target) => <button key={target} className="skill-primary" onClick={() => use(record, target)}>用于{target === 'image' ? '生图' : '生视频'}</button>)}<button disabled={working(`remove:${record.id}`)} onClick={() => { void uninstallExternal(owner, record) }}>移除安装</button></div></article>)}</div> : <div className="skill-empty"><Icon name="blocks" size={36}/><h2>还没有安装外部 Skill</h2><p>前往发现页搜索并下载，安装后会在这里显示。</p><button onClick={() => patch({ tab: 'discover' })}>去发现 Skill</button></div>}
      </>}
    </>}
  </div></section>
}
