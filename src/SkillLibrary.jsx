import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import ComposerSelect from './ComposerSelect.jsx'
import { downloadSkill, skillRequest } from './skillApi.js'
import './skillLibrary.css'

const CATEGORIES = ['设计创作', '内容写作', '方案策划', '审核检查', '效率工具', '其他']
const initial = { view: 'all', editor: null, step: 0, instruction: '', handled: [], proposal: null }
function readSession(key) { try { return { ...initial, ...JSON.parse(localStorage.getItem(key) || 'null') } } catch { return initial } }
function Markdown({ text = '' }) {
  // Render text only: shared files never execute HTML, scripts or embedded URLs.
  return <div className="skill-markdown">{text.replace(/^\uFEFF?\s*---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split('\n').map((line, i) => /^#{1,4} /.test(line) ? <h3 key={i}>{line.replace(/^#+ /, '')}</h3> : <p key={i}>{line || '\u00a0'}</p>)}</div>
}
export default function SkillLibrary({ user, onLogin }) {
  const key = `dgen-skills:${user?.id || 'guest'}`
  const [session, setSession] = useState(() => readSession(key))
  const [skills, setSkills] = useState([]), [tasks, setTasks] = useState([])
  const [query, setQuery] = useState(''), [category, setCategory] = useState('全部')
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(Boolean(user)), [source, setSource] = useState(false)
  const sessionRef = useRef(session), lock = useRef(false), importInput = useRef(null)
  const update = (patch) => setSession((s) => ({ ...s, ...patch }))
  const edit = (patch) => setSession((s) => ({ ...s, editor: { ...s.editor, ...patch } }))
  useEffect(() => { sessionRef.current = session; localStorage.setItem(key, JSON.stringify(session)) }, [session, key])
  const load = useCallback(async () => {
    if (!user) return
    const [library, jobs] = await Promise.all([skillRequest(sessionRef.current.view === 'mine' ? '?mine=1' : ''), skillRequest('/tasks')])
    setSkills(library.skills); setTasks(jobs.tasks)
  }, [user])
  useEffect(() => {
    let live = true
    if (!user) return
    const refresh = async () => { try { await load() } catch (e) { if (live) setError(e.message) } finally { if (live) setLoading(false) } }
    void refresh()
    const interval = setInterval(() => { void refresh() }, 4000)
    return () => { live = false; clearInterval(interval) }
  }, [user, load])
  async function action(fn) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await fn() } catch (e) { setError(e.message) } finally { lock.current = false; setBusy(false) }
  }
  async function importFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await action(async () => {
      if (!/\.md$/i.test(file.name)) throw new Error('请选择一个 .md 文件')
      if (!file.size || file.size > 240000) throw new Error('请选择非空的 Markdown 文件，最大 240KB')
      let markdown
      try { markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()) } catch { throw new Error('文件需要使用 UTF-8 编码，请另存为 UTF-8 后重试') }
      if (sessionRef.current.editor) await saveDraft()
      const { skill, warning } = await skillRequest('/import', { fileName: file.name, markdown })
      openDraft(skill)
      setNotice(warning ? `已导入为私有草稿。发布前还需完善：${warning}。可以直接编辑文件，或让 AI 帮你整理。` : '已导入为私有草稿，文件原文已保留。可以继续编辑、让 AI 修改或发布。')
      await load()
    })
  }
  async function saveDraft() {
    const current = sessionRef.current.editor
    const { skill } = await skillRequest(`/${current.id}`, current, 'PUT')
    update({ editor: skill }); sessionRef.current = { ...sessionRef.current, editor: skill }
    return skill
  }
  const activeTask = tasks.find((t) => t.skillId === session.editor?.id && t.status === 'running')
  const pending = busy || Boolean(activeTask)
  async function start(mode) {
    await action(async () => {
      const skill = await saveDraft()
      const { task } = await skillRequest(`/${skill.id}/tasks`, { mode, requestId: crypto.randomUUID(), revision: skill.revision, instruction: session.instruction })
      setTasks((jobs) => [task, ...jobs.filter((t) => t.id !== task.id)])
      update({ proposal: null }); setNotice('任务已开始，可以切换其他模块，回来后继续查看。')
    })
  }
  function openDraft(skill) { update({ editor: skill, step: skill.markdown ? 2 : skill.questions?.length ? 1 : 0, proposal: null, instruction: '' }); setDetail(null); setSource(false); setError(''); setNotice('') }
  async function openOwn(id) {
    if (sessionRef.current.editor && sessionRef.current.editor.id !== id) await saveDraft()
    const { skills: mine } = await skillRequest('?mine=1')
    const skill = mine.find((s) => s.id === id)
    if (!skill) throw new Error('草稿不存在，请刷新后重试')
    if (session.editor?.id === id) { setDetail(null); return }
    openDraft(skill)
  }
  function acceptGuide(task) {
    update({ editor: { ...session.editor, questions: task.result.questions, answers: task.result.questions.map(() => '') }, step: 1, handled: [...session.handled, task.id] })
  }
  function acceptProposal() {
    const task = session.proposal
    edit(task.result); update({ proposal: null, step: 2, handled: [...session.handled, task.id] }); setNotice('已应用到本地草稿，请保存或发布。')
  }
  async function changeView(view) { update({ view }); setLoading(true); try { const data = await skillRequest(view === 'mine' ? '?mine=1' : ''); setSkills(data.skills) } catch (e) { setError(e.message) } finally { setLoading(false) } }
  const visibleTasks = tasks.filter((t) => !session.handled.includes(t.id)).sort((a, b) => b.createdAt - a.createdAt)
  const filtered = skills.filter((s) => (category === '全部' || s.category === category) && `${s.title} ${s.summary} ${s.author}`.toLowerCase().includes(query.trim().toLowerCase()))
  const editor = session.editor
  return <section className="skill-workspace">
    <div className="skill-page">
      <header className="skill-header"><div><h1>Skill 库<span>把经验，变成下一次的起点。</span></h1><p>把好用的方法整理成 Skill，和团队一起积累、复用。</p></div><div className="skill-header-actions"><input ref={importInput} type="file" accept=".md,text/markdown" hidden aria-label="上传 Skill Markdown 文件" onChange={importFile}/><button disabled={busy} onClick={() => user ? importInput.current?.click() : onLogin()}>导入 Skill</button><button className="skill-primary" disabled={busy} onClick={() => user ? action(async () => {
        if (editor) await saveDraft()
        const { skill } = await skillRequest('', {}); openDraft(skill)
      }) : onLogin()}><Icon name="plus" size={16}/>新增 Skill</button></div></header>
      {error && <div className="skill-alert" role="alert">{error}<button onClick={() => { setError(''); void action(load) }}>重新加载</button></div>}
      {notice && <div className="skill-notice" role="status">{notice}</div>}
      {!user ? <div className="skill-empty"><Icon name="blocks" size={40}/><h2>让每个人的好方法，都能被复用</h2><p>登录后浏览团队 Skill，也可以用自己的话描述需求，让 AI 帮你整理第一份 Skill。</p><button className="skill-primary" onClick={onLogin}>登录并进入 Skill 库</button></div> : <>
        {visibleTasks.length > 0 && <div className="skill-jobs" aria-live="polite">{visibleTasks.slice(0, 5).map((task) => <div className="skill-job" key={task.id}><span className={task.status === 'running' ? 'skill-spinner' : ''}/><div><b>{task.mode === 'guide' ? '创建引导' : task.mode === 'revise' ? 'AI 修改' : 'Skill 生成'}{task.status === 'running' ? '进行中' : task.status === 'succeeded' ? '已完成' : '未完成'}</b><p>{task.status === 'running' ? '任务已保存，离开此页面也会继续。' : task.error || '结果已保留，查看后再决定是否应用。'}</p></div>{task.status !== 'running' && <button onClick={() => action(async () => { await openOwn(task.skillId); if (task.status === 'succeeded') { if (task.mode === 'guide') { const data = await skillRequest('?mine=1'); const draft = sessionRef.current.editor?.id === task.skillId ? sessionRef.current.editor : data.skills.find((s) => s.id === task.skillId); setSession((s) => ({ ...s, editor: { ...draft, questions: task.result.questions, answers: task.result.questions.map(() => '') }, step: 1, handled: [...s.handled, task.id] })) } else update({ proposal: task, step: 2 }) } })}>{task.status === 'succeeded' ? '查看结果' : '返回草稿重试'}</button>}{task.status !== 'running' && <button aria-label="收起任务记录" onClick={() => update({ handled: [...session.handled, task.id] })}>×</button>}</div>)}</div>}
        {editor && !detail ? <div className="skill-editor">
          <div className="skill-editor-top"><div><b>{editor.title}</b><span>{editor.publishedAt ? '已发布 · 修改先存入草稿' : '仅自己可见的草稿'}</span></div><button disabled={busy} onClick={() => action(async () => { await saveDraft(); update({ editor: null, proposal: null }); await load() })}>保存并返回 Skill 库</button></div>
          <nav className="skill-steps" aria-label="创建步骤">{['描述用途', '补充要求', '编辑与发布'].map((label, i) => <button key={label} aria-current={session.step === i ? 'step' : undefined} onClick={() => update({ step: i })}><span>{i + 1}</span>{label}</button>)}</nav>
          <fieldset disabled={pending}>
            {session.step === 0 && <div className="skill-guide"><h2>这个 Skill 帮你做什么？</h2><p>像向同事介绍任务一样描述即可。已有成熟方法，也可以一起写下来。</p><label>用途与使用场景<textarea value={editor.purpose} maxLength={8000} onChange={(e) => edit({ purpose: e.target.value })} placeholder="例如：帮我审核社区活动方案，重点找出流程、人员分工、物料和安全保障中影响落地的问题，按严重程度给出修改意见。" rows={7}/></label><label>已有经验、规则或输入输出示例 <small>选填</small><textarea value={editor.notes} maxLength={12000} onChange={(e) => edit({ notes: e.target.value })} placeholder="例如：我会提供活动方案 PPT；意见需要对应页码。不要把可选建议当成必须修改的问题。" rows={5}/></label><div className="skill-actions"><button className="skill-primary" disabled={!editor.purpose.trim()} onClick={() => start('guide')}>让 AI 帮我补齐信息</button><button disabled={!editor.purpose.trim()} onClick={() => update({ step: 1 })}>直接补充要求</button></div></div>}
            {session.step === 1 && <div className="skill-guide"><h2>把你的判断标准也告诉 AI</h2><p>不确定的可以留空。具体的输入和理想结果，比一长串笼统要求更有帮助。</p>{editor.questions?.length > 0 ? editor.questions.map((question, i) => <label key={`${i}:${question}`}>{question}<textarea rows={3} maxLength={8000} value={editor.answers[i] || ''} onChange={(e) => { const answers = [...editor.answers]; answers[i] = e.target.value; edit({ answers }) }}/></label>) : <label>需要什么输入？结果应该是什么样？有哪些真实规则？<textarea rows={8} value={editor.notes} maxLength={12000} onChange={(e) => edit({ notes: e.target.value })} placeholder="可以贴一个输入示例、期望结果，或你平时处理这项工作的具体方法。"/></label>}<div className="skill-actions"><button onClick={() => update({ step: 0 })}>上一步</button><button className="skill-primary" disabled={!editor.purpose.trim()} onClick={() => start('generate')}>生成 Skill 文件</button></div></div>}
            {session.step === 2 && <div className="skill-final"><div className="skill-metadata"><label>Skill 名称<input value={editor.title} maxLength={80} onChange={(e) => edit({ title: e.target.value })}/></label><label>分类<ComposerSelect label="Skill 分类" value={editor.category} options={CATEGORIES.map((value) => ({ value, label: value }))} onChange={(value) => edit({ category: value })}/></label><label className="skill-summary">用途简介<textarea rows={2} value={editor.summary} maxLength={500} onChange={(e) => edit({ summary: e.target.value })}/></label></div>
              {session.proposal && <div className="skill-proposal"><h3>AI 建议版本</h3><p>应用后可继续编辑；当前草稿仍保留，保存时会记录上一版本。</p><div className="skill-compare"><div><b>当前版本</b><pre>{editor.markdown || '尚未生成文件'}</pre></div><div><b>{session.proposal.result.title}</b><pre>{session.proposal.result.markdown}</pre></div></div><div className="skill-actions"><button className="skill-primary" onClick={acceptProposal}>应用建议版本</button><button onClick={() => update({ handled: [...session.handled, session.proposal.id], proposal: null })}>保留当前版本</button></div></div>}
              <div className="skill-file-header"><b>SKILL.md</b><button aria-pressed={source} onClick={() => setSource(!source)}>{source ? '阅读预览' : '编辑文件'}</button></div>{source ? <textarea className="skill-source" aria-label="Skill 文件内容" spellCheck={false} rows={20} value={editor.markdown} maxLength={60000} onChange={(e) => edit({ markdown: e.target.value })}/> : editor.markdown ? <Markdown text={editor.markdown}/> : <div className="skill-empty small"><p>完成用途与要求后，生成第一份 Skill 文件。</p><button onClick={() => update({ step: 0 })}>返回描述用途</button></div>}
              <label className="skill-revise">让 AI 帮你修改<textarea value={session.instruction} maxLength={8000} rows={2} placeholder="例如：只把输出格式改成表格，保留现有审核规则。" onChange={(e) => update({ instruction: e.target.value })}/></label><button disabled={!editor.markdown || !session.instruction.trim()} onClick={() => start('revise')}>生成修改建议</button>
              {editor.history?.length > 0 && <details className="skill-history"><summary>历史内容版本（最近 {editor.history.length} 次）</summary>{editor.history.map((version, i) => <details key={`${version.updatedAt}:${i}`}><summary>{new Date(version.updatedAt).toLocaleString('zh-CN')} · {version.title}</summary><pre>{version.markdown}</pre><button onClick={() => { edit({ title: version.title, summary: version.summary, markdown: version.markdown }); setNotice('历史版本已载入本地草稿，保存后生效。') }}>恢复此版本到草稿</button></details>)}</details>}
              <div className="skill-actions skill-publish"><button onClick={() => action(async () => { await saveDraft(); await load(); setNotice('草稿已保存。') })}>保存草稿</button><button disabled={!editor.markdown} onClick={() => action(async () => { const skill = await saveDraft(); await downloadSkill(skill.id, true) })}>下载 SKILL.md</button><button className="skill-primary" disabled={!editor.markdown || !editor.summary.trim() || !editor.title.trim()} onClick={() => action(async () => { const saved = await saveDraft(); const { skill } = await skillRequest(`/${saved.id}/publish`, { revision: saved.revision }); update({ editor: skill }); await load(); setNotice('已发布，所有注册用户都能在 Skill 库查看和下载。') })}>{editor.publishedAt ? '更新发布版本' : '发布到 Skill 库'}</button>{editor.publishedAt && <button onClick={() => action(async () => { const saved = await saveDraft(); const { skill } = await skillRequest(`/${saved.id}/unpublish`, { revision: saved.revision }); update({ editor: skill }); await load(); setNotice('已取消发布，草稿仍保留。') })}>取消发布</button>}</div><p className="skill-footnote">输入会发送给 AI 用于整理，请勿填写密码或密钥。下载的文件供支持 Skill 的助手使用，具体执行能力取决于目标工具。</p>
            </div>}
          </fieldset>
          {activeTask && <div className="skill-generating" role="status"><span className="skill-spinner"/>AI 正在整理，请稍候。可以离开当前模块，任务会继续。</div>}
          {tasks.filter((t) => t.skillId === editor.id && t.status === 'succeeded' && !session.handled.includes(t.id)).map((task) => <button key={task.id} className="skill-result-button" onClick={() => task.mode === 'guide' ? acceptGuide(task) : update({ proposal: task, step: 2 })}>查看{task.mode === 'guide' ? '引导问题' : 'AI 建议版本'}</button>)}
        </div> : detail ? <article className="skill-detail"><button onClick={() => setDetail(null)}>返回 Skill 库</button><div className="skill-detail-heading"><span>{detail.category}</span><h2>{detail.title}</h2><p>{detail.summary}</p><small>{detail.author} · {new Date(detail.updatedAt).toLocaleDateString('zh-CN')}</small></div><div className="skill-actions"><button className="skill-primary" onClick={() => action(() => downloadSkill(detail.id, session.view === 'mine' && detail.canEdit))}>下载 SKILL.md</button>{detail.canEdit && <button onClick={() => action(() => openOwn(detail.id))}>编辑我的 Skill</button>}</div><Markdown text={detail.markdown}/></article> : <>
          <div className="skill-toolbar"><div className="skill-tabs" role="group" aria-label="Skill 范围">{[['all', '全部 Skill'], ['mine', '我创建的']].map(([value, label]) => <button key={value} aria-pressed={session.view === value} onClick={() => changeView(value)}>{label}</button>)}</div><label className="skill-search"><Icon name="search" size={16}/><input aria-label="搜索 Skill" placeholder="搜索名称、用途或作者" value={query} onChange={(e) => setQuery(e.target.value)}/></label></div>
          <div className="skill-categories" aria-label="分类筛选">{['全部', ...CATEGORIES].map((c) => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div>
          {loading ? <div className="skill-empty" role="status">正在加载 Skill…</div> : filtered.length ? <div className="skill-waterfall">{filtered.map((skill) => <button className="skill-card" key={skill.id} onClick={() => { setDetail(skill); setError(''); setNotice('') }}><div className="skill-card-top"><span>{skill.category}</span>{session.view === 'mine' && <small>{skill.publishedAt ? '已发布' : '草稿'}</small>}</div><h2>{skill.title}</h2><p>{skill.summary || skill.purpose || '继续完善你的方法，让 AI 帮你整理成 Skill。'}</p>{skill.markdown && <div className="skill-card-excerpt">{skill.markdown.replace(/^\uFEFF?\s*---[\s\S]*?---\s*/, '').replace(/[#*`]/g, '').slice(0, 180)}</div>}<footer><span>{skill.author}</span><span>{new Date(skill.updatedAt).toLocaleDateString('zh-CN')}</span></footer></button>)}</div> : <div className="skill-empty"><Icon name="blocks" size={36}/><h2>{query || category !== '全部' ? '没有找到匹配的 Skill' : session.view === 'mine' ? '从你熟悉的一件事开始' : '团队的第一份 Skill，等你来写'}</h2><p>{query || category !== '全部' ? '换一个关键词，或试试其他分类。' : '描述用途、补充经验，让 AI 帮你整理成可编辑的 Skill 文件。'}</p></div>}
        </>}
      </>}
    </div>
  </section>
}
