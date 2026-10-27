import { useEffect, useState } from 'react'
import { knowledgeDownload, knowledgeKey, knowledgeRequest } from './knowledgeApi.js'
const NAMES = { logo: '正式Logo候选', palette: '色板', original: '原始素材', style: '风格参考', prohibited: '禁用示范 · 不可导入', unknown: '用途不明 · 不可导入' }
const STATUS = { queued: '等待图文解析', running: '图文解析中', succeeded: '解析完成，请核对', failed: '图文解析失败' }
function Preview({ analysisId, page }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let live = true, current
    knowledgeDownload(`/analyses/${analysisId}/pages/${page.number}`, '', true).then((u) => { current = u; if (live) setUrl(u); else URL.revokeObjectURL(u) }).catch(() => {})
    return () => { live = false; if (current) URL.revokeObjectURL(current) }
  }, [analysisId, page.number])
  return url ? <a href={url} target="_blank" rel="noreferrer" aria-label={`查看原页：${page.source}`}><img src={url} alt={page.source}/></a> : <p>正在读取原页…</p>
}
function Candidate({ analysis, page, asset, index, onImport, busy }) {
  const key = knowledgeKey(`vision:${analysis.id}:${page.number}:${index}`)
  const [draft, setDraft] = useState(() => { try { return JSON.parse(localStorage.getItem(key)) || { title: asset.title, content: asset.description, box: asset.box, kind: asset.kind } } catch { return { title: asset.title, content: asset.description, box: asset.box, kind: asset.kind } } })
  useEffect(() => { localStorage.setItem(key, JSON.stringify(draft)) }, [key, draft])
  const blocked = ['prohibited', 'unknown'].includes(asset.kind)
  const width = ((draft.box[2] - draft.box[0]) / 10).toFixed(1), height = ((draft.box[3] - draft.box[1]) / 10).toFixed(1)
  return <div className="kb-vision-candidate"><h4>{NAMES[asset.kind]}</h4><p>{asset.description}</p>{blocked ? <small>已保留在解析记录中，不会作为可调用素材。</small> : <><label>素材名称<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}/></label><label>确认用途<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}><option value="logo">正式Logo</option><option value="palette">色板</option><option value="original">原始素材</option><option value="style">风格参考</option></select></label><label>素材说明<textarea rows={3} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })}/></label><details><summary>调整裁切范围 · {width}% × {height}%</summary><p>对照左侧原页，坐标以整页千分位表示。保存后请在素材详情检查裁切图，确认无误再发布。</p><div className="kb-crop-fields">{['左', '上', '右', '下'].map((label, i) => <label key={label}>{label}<input type="number" min="0" max="1000" value={draft.box[i]} onChange={(e) => setDraft({ ...draft, box: draft.box.map((n, j) => i === j ? Number(e.target.value) : n) })}/></label>)}</div></details><button disabled={busy} onClick={() => onImport({ page: page.number, assetIndex: index, ...draft })}>保存素材草稿</button></>}</div>
}
function PageResult({ analysis, page, onImport, busy }) {
  const key = knowledgeKey(`vision-text:${analysis.id}:${page.number}`)
  const [text, setText] = useState(() => { try { return localStorage.getItem(key) || [page.result?.business ? `主营业务：${page.result.business}` : '', ...(page.result?.rules || [])].filter(Boolean).join('\n') } catch { return '' } })
  const [kind, setKind] = useState('rule')
  useEffect(() => { localStorage.setItem(key, text) }, [key, text])
  return <section className="kb-vision-page"><header><h4>{page.source}</h4><small>{page.analyzedAt ? '已解析' : '尚未完成'}</small></header><div className="kb-vision-columns"><div className="kb-vision-preview"><Preview analysisId={analysis.id} page={page}/></div><div>{page.result ? <><details><summary>查看图文识别全文</summary><p className="kb-vision-text">{page.result.text}</p></details>{page.result.warnings?.length > 0 && <div className="kb-alert">需核对：{page.result.warnings.join('；')}</div>}<label>核对品牌事实与规则<textarea rows={6} value={text} onChange={(e) => setText(e.target.value)}/></label><button type="button" onClick={() => setText(page.result.text)}>填入图文识别全文</button><label>保存为<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="rule">强制规则 · 发布后固定加载</option><option value="document">品牌资料 · 按任务检索</option></select></label><button disabled={busy || !text.trim()} onClick={() => onImport({ page: page.number, kind, content: text })}>保存文字草稿</button>{page.result.assets.map((asset, index) => <Candidate key={index} analysis={analysis} page={page} asset={asset} index={index} onImport={onImport} busy={busy}/>)}</> : <p>本页尚未解析完成。任务完成或重试后可确认。</p>}</div></div></section>
}
export default function KnowledgeVision({ selected, version, onChanged, onOpen, onError, canEdit }) {
  const [analysis, setAnalysis] = useState(null), [busy, setBusy] = useState(false)
  const rangeKey = knowledgeKey(`vision-range:${version.id}`)
  const [range, setRange] = useState(() => { try { return JSON.parse(localStorage.getItem(rangeKey)) || { start: 1, end: 1 } } catch { return { start: 1, end: 1 } } })
  useEffect(() => { localStorage.setItem(rangeKey, JSON.stringify(range)) }, [rangeKey, range])
  const history = (selected.analyses || []).filter((a) => a.versionId === version.id).slice().reverse()
  const latestId = history[0]?.id
  const [picked, setPicked] = useState('')
  const analysisId = picked || latestId
  useEffect(() => {
    if (!analysisId) return
    let live = true
    const load = () => knowledgeRequest(`/analyses/${analysisId}`).then((r) => { if (live) setAnalysis(r.analysis) }).catch((e) => { if (live) onError(e.message) })
    void load(); const timer = setInterval(load, 2500)
    return () => { live = false; clearInterval(timer) }
  }, [analysisId, onError])
  const automatic = history.find((a) => a.automatic)
  const pending = ['queued', 'running'].includes(analysis?.status) || history.some((a) => a.id !== analysis?.id && ['queued', 'running'].includes(a.status))
  async function action(fn) { setBusy(true); onError(''); try { await fn() } catch (e) { onError(e.message) } finally { setBusy(false) } }
  if (!canEdit || !['.pdf', '.pptx', '.docx', '.png', '.jpg', '.jpeg', '.webp'].includes(version.ext)) return null
  return <section className="kb-vision"><h3>图文识别</h3><p>上传后自动识别整份资料的文字、Logo、色板和图示规范。识别文字自动补充到当前草稿，素材候选需核对；发布后才会被工具调用。</p>{!automatic && <button className="kb-primary" disabled={busy || pending} onClick={() => action(async () => { const r = await knowledgeRequest(`/documents/${selected.document.id}/analyze`, { versionId: version.id, automatic: true }); setAnalysis(r.analysis); setPicked(r.analysis.id); await onChanged() })}>{pending ? '后台识别中…' : '自动解析整份资料'}</button>}{automatic && <p role="status">{automatic.status === 'succeeded' ? '整份图文识别已完成，文字已补充到草稿，请核对后发布。' : automatic.status === 'failed' ? '自动识别未完成，请重试未完成页面。' : '正在后台自动识别整份资料，离开页面不影响处理。'}</p>}<details><summary>补充解析指定页</summary><form className="kb-vision-start" onSubmit={(e) => { e.preventDefault(); void action(async () => { const r = await knowledgeRequest(`/documents/${selected.document.id}/analyze`, { versionId: version.id, ...range }); setAnalysis(r.analysis); setPicked(r.analysis.id); await onChanged() }) }}><label>{version.ext === '.docx' ? '起始图片序号' : '起始页 / 张'}<input type="number" min="1" max="100" required value={range.start} onChange={(e) => setRange({ ...range, start: Number(e.target.value) })}/></label><label>结束页 / 张<input type="number" min={range.start} max={Math.min(100, range.start + 19)} required value={range.end} onChange={(e) => setRange({ ...range, end: Number(e.target.value) })}/></label><button className="kb-primary" disabled={busy || pending}>{pending ? '后台解析中…' : '开始图文解析'}</button></form><small>每次最多20页/张。所选页图与相关文字会发送至平台已配置的 GRSAI；按其账户规则计费。PDF保留原页，DOCX提取内嵌PNG/JPG/WebP图片（不含WMF/EMF）。旧资料无需重新上传。PPTX 自动转换为页面后识别。</small></details>{history.length > 0 && <label className="kb-vision-history">解析记录<select value={analysisId} onChange={(e) => { setPicked(e.target.value); setAnalysis(null) }}>{history.map((a) => <option key={a.id} value={a.id}>{new Date(a.createdAt).toLocaleString('zh-CN')} · {a.automatic ? '整份资料' : `${a.range.start}–${a.range.end}`} · {STATUS[a.status]}</option>)}</select></label>}{analysis && <><p role="status">{analysis.automatic ? '整份自动识别' : '补充识别'} · {STATUS[analysis.status]} · {analysis.pages.filter((p) => p.result).length}/{analysis.pages.length || '—'} · 离开页面后继续处理</p>{analysis.error && <div className="kb-alert">{analysis.error}</div>}{analysis.status === 'failed' && <button disabled={busy} onClick={() => action(async () => { await knowledgeRequest(`/analyses/${analysis.id}/retry`, {}); setAnalysis({ ...analysis, status: 'queued', error: null }); await onChanged() })}>重试未完成页面</button>}{analysis.pages.map((page) => <PageResult key={`${analysis.id}:${page.number}`} analysis={analysis} page={page} busy={busy || analysis.status !== 'succeeded'} onImport={(payload) => action(async () => { const d = await knowledgeRequest(`/analyses/${analysis.id}/import`, payload); onOpen(d) })}/>)}</>}
  </section>
}
