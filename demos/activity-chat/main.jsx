import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ComposerSelect from '../../src/ComposerSelect.jsx'
import { Icon } from '../../src/icons.jsx'
import './style.css'
import sources from './sources.json'

const activities = [
  { id: 'newyear', name: '跨年营销 · 试写', tag: '历史同期参考', subtitle: '参考去年同期方案，筹划新一轮跨年营销', date: '参考：2025.11 — 2026.01', file: '2025 年终福利节执行方案', theme: '新年，让好生活发生', tone: 'warm' },
  { id: 'winter', name: '社区冰爽节', tag: '历史活动', subtitle: '百万居住礼 · 冰爽进万家', date: '2026.07 — 08', file: '2026 社区冰爽节策划执行案', theme: '百万居住礼 · 冰爽进万家', tone: 'cool' },
]
const modes = [
  { id: 'strategy', name: '生成策略', icon: 'spark', detail: '从营销总纲到执行方案', prompt: '帮我制定一份可落地的活动执行策略。' },
  { id: 'image', name: '生成图片', icon: 'image', detail: '让活动有统一的视觉表达', prompt: '帮我设计一张活动主题海报。' },
  { id: 'content', name: '生产图文', icon: 'book', detail: '小红书文案与配图一起做', prompt: '面向年轻家庭，策划一组 5 页的小红书图文。' },
  { id: 'slides', name: '制作演示稿', icon: 'blocks', detail: '先理清大纲，再呈现方案', prompt: '把活动策略整理成一份 HTML 提案演示稿。' },
]
const key = 'dgen-activity-chat-demo-v1'
function initial() { try { return JSON.parse(localStorage.getItem(key)) || {} } catch { return {} } }
export default function App() {
  const [state, setState] = useState(() => ({ activity: '', knowledge: true, identity: '研选家', scope: '武汉幸福社', mode: 'strategy', input: '', records: [], ...initial() }))
  const [theme, setTheme] = useState(() => localStorage.getItem(key + '-theme') || 'light')
  const [library, setLibrary] = useState(false)
  const [nav, setNav] = useState('活动策略')
  const [preview, setPreview] = useState(null)
  const [page, setPage] = useState(0)
  const activity = activities.find(a => a.id === state.activity)
  const mode = modes.find(m => m.id === state.mode) || modes[0]
  const update = value => setState(s => ({ ...s, ...value }))
  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)) }, [state])
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem(key + '-theme', theme) }, [theme])
  function create(e) {
    e.preventDefault()
    if (!state.input.trim()) return
    const record = { id: crypto.randomUUID(), activity: activity || null, identity: state.identity, scope: state.scope, mode: state.mode, knowledge: Boolean(state.knowledge), request: state.input.trim() }
    update({ records: [...state.records, record], input: '' })
    setPreview(record); setPage(0)
  }
  const selected = preview && (modes.find(m => m.id === preview.mode) || modes[0])
  const title = preview?.activity?.theme || '让每一次创作，都有好方向'
  return <div className="demo-shell">
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-mark">D<span>✳</span></span><b>D-Gen<span>AI 创作工作台</span></b></a>
      <button className="new-chat" onClick={() => { update({ records: [], input: '', activity: '' }); setPreview(null); setNav('活动策略') }}><Icon name="plus" size={17}/>开启新创作</button>
      <small className="nav-label">工作空间</small>
      {['活动策略', '图像创作', '视频生成', '合规审核', 'Skill 库', '知识库'].map((label, i) => <button key={label} className={`nav-item ${nav === label ? 'active' : ''}`} onClick={() => label === '知识库' ? window.location.assign('/?module=marketing-activities') : setNav(label)}><Icon name={['spark', 'image', 'video', 'shield', 'blocks', 'library'][i]} size={18}/>{label}{label === '活动策略' && <span className="new-dot"/>}</button>)}
      <a className="marketing-nav" href="/?module=marketing-activities"><Icon name="book" size={15}/>营销活动<Icon name="chevron" size={12}/></a>
      <div className="recent"><small className="nav-label">当前对话成果 <span>{state.records.length}</span></small>{state.records.length ? state.records.slice(-4).reverse().map(r => <button key={r.id} onClick={() => { setPreview(r); setPage(0); setNav('活动策略') }}><Icon name="history" size={14}/><span>{r.activity?.name || '自由创作'} · {modes.find(m => m.id === r.mode)?.name}</span></button>) : <p>创作从一个好想法开始</p>}</div>
      <div className="sidebar-bottom"><button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name="focus" size={16}/>{theme === 'light' ? '切换深色模式' : '切换浅色模式'}</button><div className="profile"><span>W</span><div>我的工作台<small>本地交互 Demo</small></div><span className="profile-dot"/></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><span>D-Gen <span className="slash">/</span> {nav}</span><div><button className="theme-toggle" aria-label="切换主题" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name="focus" size={15}/></button><span className="demo-badge">DEMO</span><span className="local-label">仅本地预览 · 示例内容</span></div></header>
      {nav !== '活动策略' ? <section className="module-placeholder"><Icon name={nav === '知识库' ? 'library' : 'blocks'} size={34}/><h1>{nav === '知识库' ? '活动资料，都在知识库' : `${nav} · 共用创作能力`}</h1><p>{nav === '知识库' ? '这里展示同一份活动选择。切回活动策略，顶部快捷卡片与下方知识库都会同步。' : '本 Demo 聚焦活动策略的活动创作流程，生产能力后续复用现有模块。'}</p>{nav === '知识库' && activities.map(a => <button className={`library-doc ${state.activity === a.id ? 'chosen' : ''}`} key={a.id} onClick={() => update({ activity: a.id })}><Icon name="book"/><span><b>{a.file}</b><small>{a.name} · 示例已发布资料</small></span><span>{state.activity === a.id ? '已选择 ✓' : '选择活动'}</span></button>)}{nav === '知识库' && <><h3 className="catalog-title">部门活动资料 · {sources.length} 份</h3><p className="catalog-note">已读取文件文字；本 Demo 仅展示资料目录，尚未接入真实检索与生成。复盘用于经验参考，不作为当前活动的硬性要求。</p>{sources.map((s, i) => <button key={s.name} className={`library-doc ${state.activity === `source-${i}` ? 'chosen' : ''}`} onClick={() => update({ activity: `source-${i}` })}><Icon name="book" size={17}/><span><b>{s.name}</b><small>{s.kind} · {s.pages} 页</small></span><span>{state.activity === `source-${i}` ? '已选择 ✓' : '选择资料'}</span></button>)}</>}<button className="primary" onClick={() => setNav('活动策略')}>返回当前对话 <Icon name="chevron" size={14}/></button></section> : <div className={`workspace ${preview ? 'with-preview' : ''}`}>
        <section className="chat-column">
          <div className="chat-scroll">
            <div className="greeting"><div className="eyebrow"><span/> YOUR CREATIVE COPILOT</div><h1>好想法，从这里发生<span>✳</span></h1><p>带上营销策略和品牌身份，让每一次创作都有方向。</p></div>
            <div className="section-label"><span>近期活动 <small>从这里快捷开始，也可以在下方知识库中选择</small></span><span className="muted">02</span></div>
            <div className="activity-grid">{activities.map(a => <button key={a.id} aria-pressed={state.activity === a.id} className={`activity-card ${a.tone} ${state.activity === a.id ? 'selected' : ''}`} onClick={() => update({ activity: state.activity === a.id ? '' : a.id, knowledge: true })}><div className="activity-art" aria-hidden="true"><span className="ring ring-one"/><span className="ring ring-two"/><span className="art-star">✳</span><span className="art-number">{a.id === 'newyear' ? '2027' : '冬日'}</span></div><div className="activity-top"><span>{a.tag}</span><span className="card-check">{state.activity === a.id ? '✓' : '↗'}</span></div><div className="activity-copy"><small>{a.date}</small><h2>{a.name}</h2><p>{a.subtitle}</p></div><div className="activity-footer"><Icon name="book" size={13}/><span>{a.file}</span><b>{state.activity === a.id ? '已选择' : '使用策略'}</b></div></button>)}</div>
            <div className="identity-row"><span><Icon name="person" size={15}/>创作身份</span><ComposerSelect label="业务身份" value={state.identity} options={['研选家', '朴邻', '住这儿'].map(x => ({ value: x, label: x }))} onChange={identity => update({ identity })}/><ComposerSelect label="执行范围" value={state.scope} options={['本部', '武汉幸福社', '武汉 · 示例阵地', '武汉 · 示例项目', '杭州幸福社'].map(x => ({ value: x, label: x }))} onChange={scope => update({ scope })}/></div>
            <div className="section-label production-label"><span>今天，想创作什么？</span><span className="muted">选择一种方式开始</span></div>
            <div className="mode-grid">{modes.map(m => <button key={m.id} className={`mode-card ${state.mode === m.id ? 'selected' : ''}`} aria-pressed={state.mode === m.id} onClick={() => update({ mode: m.id, input: m.prompt })}><span className={`mode-icon ${m.id}`}><Icon name={m.icon} size={19}/></span><b>{m.name}<span>↗</span></b><small>{m.detail}</small>{m.id === 'slides' && <em>HTML</em>}</button>)}</div>
            {state.records.map(r => <article className="chat-record" key={r.id}><div className="user-request">{r.request}</div><div className="assistant-label"><span className="mini-brand">✳</span>D-Gen <small>示例产出</small></div><p>已按「{r.activity?.name || '自由创作'}」与「{r.identity} · {r.scope}」组织一份{modes.find(m => m.id === r.mode)?.name}示例。</p><button className="result-card" onClick={() => { setPreview(r); setPage(0) }}><Icon name={modes.find(m => m.id === r.mode)?.icon}/><span><b>{r.activity?.name || '自由创作'} · {modes.find(m => m.id === r.mode)?.name}</b><small>{r.activity?.file || '未指定活动策略'} · 查看示例成果</small></span><Icon name="chevron" size={17}/></button></article>)}
          </div>
          <div className="composer-area">
            {activity && <div className="context-strip"><Icon name="pin" size={13}/><span>当前活动 <b>{activity.name}</b></span><span className="context-separator"/><span>{state.identity} · {state.scope}</span><button aria-label="取消活动选择" onClick={() => update({ activity: '' })}><Icon name="x" size={13}/></button></div>}
            <form className="composer" onSubmit={create}><textarea aria-label="创作需求" value={state.input} onChange={e => update({ input: e.target.value })} placeholder={activity ? `基于${activity.name}，说说你想做什么…` : '描述你的想法，或先选一个活动开始…'} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); create(e) } }}/><div className="composer-bottom"><div className="composer-controls"><span className="model-pill"><Icon name="spark" size={13}/>创作助手</span><div className="library-control"><button type="button" className={`library-trigger ${state.knowledge ? 'has-selection' : ''}`} aria-expanded={library} onClick={() => setLibrary(!library)}><Icon name="library" size={15}/>知识库{state.knowledge && <span className="selection-count">1</span>}<Icon name="chevron" size={13}/></button>{library && <div className="library-popover"><div className="popover-title"><b>选择创作依据</b><small>选择资料集合，无需逐份挑选历史方案</small></div><span className="library-category">资料集合</span>{[{ enabled: false, name: '不使用营销资料', detail: '自由创作' }, { enabled: true, name: '营销活动', detail: '按活动属性、时间与业务自动检索相关资料' }].map(item => <button type="button" role="menuitemradio" aria-checked={Boolean(state.knowledge) === item.enabled} key={item.name} onClick={() => { update({ knowledge: item.enabled, ...(!item.enabled ? { activity: '' } : {}) }); setLibrary(false) }}><Icon name="library" size={16}/><span><b>{item.name}</b><small>{item.detail}</small></span>{Boolean(state.knowledge) === item.enabled && <Icon name="check" size={15}/>}</button>)}<a className="manage-marketing" href="/?module=marketing-activities">前往知识库 · 营销活动 ↗</a><p>品牌规范：{state.identity} · 待接入核验，不冒充已加载</p></div>}</div></div><button className="send" type="submit" disabled={!state.input.trim()} aria-label="生成示例"><Icon name="arrowUp" size={18}/></button></div></form>
            <div className="composer-footnote"><span>当前方式：{mode.name}{state.mode === 'slides' ? ' · HTML 演示稿' : ''}</span><span>交互原型 · 不调用模型，不消耗额度</span></div>
          </div>
        </section>
        {preview && <aside className="preview-panel"><header><span><Icon name={selected.icon} size={17}/>{selected.name}<small>示例预览</small></span><button aria-label="关闭预览" onClick={() => setPreview(null)}><Icon name="x" size={18}/></button></header><div className="preview-body"><div className="knowledge-status"><Icon name="library" size={15}/><span>活动依据：{preview.activity?.file || (preview.knowledge ? '营销活动（自动检索待接入）' : '未选择')}<br/>身份规范：{preview.identity}（待接入）<br/>地域条件：{preview.scope}（待补充当地事实）</span></div><div className="preview-meta"><span>{preview.identity}</span><span>{preview.scope}</span><span>{preview.activity?.file || '自由创作'}</span></div>{preview.mode === 'slides' ? <><div className="slide"><span>{preview.identity} / CAMPAIGN PROPOSAL</span><small>0{page + 1} — 04</small><h2>{[title, '从生活期待出发', '让策略落到每个社区', '让每一份内容彼此呼应'][page]}</h2><p>{['活动策略与执行提案', '人群洞察 / 品牌价值 / 内容主张', `${preview.scope} · 场景、资源与执行节奏`, '图文内容 / 活动海报 / 视频传播'][page]}</p><i>✳</i></div><div className="slide-controls"><button disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / 4</span><button disabled={page === 3} onClick={() => setPage(page + 1)}>下一页</button></div><h3>演示大纲</h3>{['活动主张与目标', '人群与场景洞察', '属地执行路径', '内容矩阵与节奏'].map((x, i) => <button key={x} className={`outline-item ${i === page ? 'active' : ''}`} onClick={() => setPage(i)}><span>0{i + 1}</span>{x}</button>)}</> : preview.mode === 'image' ? <><div className="poster"><span>{preview.identity} / 美好生活提案</span><h2>{title.replace('，', '，\n')}</h2><div className="poster-sculpture">✳</div><p>{preview.activity?.name || '生活灵感'} · {preview.scope}</p><small>版式示意 · 非模型生成图片</small></div><h3>视觉方向</h3><p>温暖的生活感、清晰的主题层级，统一品牌表达。正式生成时加载品牌色与素材。</p></> : preview.mode === 'content' ? <><div className="content-cover"><small>{preview.identity} · 生活灵感</small><h2>{title}</h2><span>让家的小变化<br/>成为新年的第一份礼物</span><i>✳</i></div><h3>小红书图文 · 5 页内容结构</h3>{['封面｜一个值得期待的新开始', '共鸣｜你想怎样开启新一年？', '场景｜从家里的一处小变化开始', '价值｜让好生活更容易发生', '行动｜带着你的期待，一起参与'].map((x, i) => <p className="page-line" key={x}><b>0{i + 1}</b>{x}</p>)}<h3>正文示例</h3><p>新的一年，不妨从照顾好日常开始。和{preview.identity}一起，把对好生活的期待，变成家中触手可及的改变。</p></> : <><div className="doc-heading"><small>CAMPAIGN STRATEGY</small><h2>{preview.activity?.name || '活动'}<br/>执行策略</h2><p>{preview.identity} / {preview.scope}</p></div>{[['01', '核心主张', title], ['02', '目标人群', '关注家庭生活品质，希望获得实用灵感与便捷服务的人群。'], ['03', '执行路径', `围绕${preview.scope}的实际场景，组织内容预热、参与体验和活动回顾三个阶段。`], ['04', '内容矩阵', '小红书图文建立认知，主题海报传递信息，活动回顾沉淀口碑。']].map(([n, h, text]) => <section className="strategy-section" key={n}><small>{n}</small><div><h3>{h}</h3><p>{text}</p></div></section>)}</>}<div className="source-note"><Icon name="book" size={15}/><span>依据：{preview.activity?.file || '未选择活动策略'}<br/>静态示例，用于体验流程与版式。</span></div></div><footer><Icon name="check" size={14}/>已保存在本地对话中</footer></aside>}
      </div>}
    </main>
  </div>
}
createRoot(document.getElementById('root')).render(<App/> )
