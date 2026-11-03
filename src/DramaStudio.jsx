import { useEffect, useMemo, useRef, useState } from 'react'
import { generateImage } from './api.js'
import { Icon } from './icons.jsx'
import { createDramaProject, deleteDramaProject, getDramaProject, listDramaProjects, planDramaStage, updateDramaProject } from './dramaApi.js'
import { characterSheetPrompt, contextForProject, estimatedDialogueSeconds, lookSheetPrompt, scenePrompt, shotFirstFramePrompt, shotSummary, shotVideoPrompt, shotsReferencing } from './dramaPrompt.js'
import './dramaStudio.css'

const STEPS = [
  { id: 'story', label: '故事与剧本', hint: '原文 · 场次 · 对白' },
  { id: 'characters', label: '角色资产', hint: '三视图 · 服装' },
  { id: 'scenes', label: '场景资产', hint: '昼夜 · 灯光 · 道具' },
  { id: 'shots', label: '分镜工作台', hint: '镜头 · 时长 · 运镜' },
  { id: 'video', label: '视频生成', hint: '提示词 · 首尾帧' },
  { id: 'export', label: '导出资产包', hint: 'JSON · 提示词' },
]

const IMAGE_MODEL = 'gpt-image-2.5'

function asDataUrl(url) {
  if (!url) return Promise.resolve('')
  if (String(url).startsWith('data:')) return Promise.resolve(url)
  return fetch(url).then((response) => response.blob()).then((blob) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('参考图读取失败'))
    reader.readAsDataURL(blob)
  }))
}

function downloadFile(name, content, type = 'application/json') {
  const blob = new Blob([content], { type })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 20_000)
}

function safeName(value, fallback) {
  return String(value || fallback).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
}

function buildAssetPackage(project) {
  if (!project) return null
  const context = contextForProject(project)
  return {
    schema: 'diefa-drama-assets/1',
    exportedAt: new Date().toISOString(),
    title: project.title,
    logline: project.logline || project.script?.logline || '',
    script: project.script?.scenes || [],
    characters: (project.characters || []).map((character) => ({
      ...character,
      prompts: {
        faceSheet: characterSheetPrompt(character),
        looks: (character.looks || []).map((look) => ({ id: look.id, name: look.name, prompt: lookSheetPrompt(character, look) })),
      },
    })),
    scenes: (project.scenes || []).map((scene) => ({
      ...scene,
      prompts: { day: scenePrompt(scene), night: scenePrompt(scene, { timeOfDay: 'night' }) },
    })),
    shots: (project.shots || []).map((shot) => ({
      ...shot,
      prompts: {
        video: shotVideoPrompt(shot, context),
        firstFrame: shotFirstFramePrompt(shot, context),
      },
    })),
  }
}

function StepNav({ step, onSelect, project }) {
  const ready = {
    story: Boolean((project?.script?.scenes || []).length),
    characters: Boolean((project?.characters || []).length),
    scenes: Boolean((project?.scenes || []).length),
    shots: Boolean((project?.shots || []).length),
    video: Boolean((project?.shots || []).length),
    export: Boolean((project?.shots || []).length),
  }
  return <nav className="drama-steps" aria-label="短剧制作阶段">
    {STEPS.map((item, index) => <button key={item.id} type="button" className={`${step === item.id ? 'active' : ''} ${ready[item.id] ? 'ready' : ''}`} onClick={() => onSelect(item.id)}>
      <span className="drama-step-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="drama-step-copy"><b>{item.label}</b><small>{item.hint}</small></span>
      {ready[item.id] && <span className="drama-step-dot" aria-label="已完成"/>}
    </button>)}
  </nav>
}

function Empty({ title, description, action }) {
  return <div className="drama-empty glass-strong">
    <Icon name="focus" size={26}/>
    <h3>{title}</h3>
    <p>{description}</p>
    {action}
  </div>
}

export default function DramaStudio({ onUserUpdate, onRequireLogin }) {
  const [projects, setProjects] = useState([])
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [step, setStep] = useState('story')
  const [selectedShotId, setSelectedShotId] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftStory, setDraftStory] = useState('')
  const [storyDraft, setStoryDraft] = useState('')
  const storyRef = useRef('')

  useEffect(() => {
    void (async () => {
      try {
        const result = await listDramaProjects()
        setProjects(result.projects || [])
      } catch (requestError) {
        if (requestError.status === 401) onRequireLogin?.()
        else setError(requestError.message)
      } finally {
        setLoading(false)
      }
    })()
  }, [onRequireLogin])

  useEffect(() => {
    if (!project) return
    setStoryDraft(project.story || '')
    storyRef.current = project.story || ''
  }, [project?.id])

  const context = useMemo(() => contextForProject(project), [project])
  const selectedShot = (project?.shots || []).find((shot) => shot.id === selectedShotId) || null

  function flash(message) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3200)
  }

  function guard(requestError) {
    if (requestError?.status === 401) { onRequireLogin?.(); return true }
    setError(requestError.message || '操作失败，请重试')
    return false
  }

  async function openProject(id) {
    setBusy('loading'); setError('')
    try {
      const result = await getDramaProject(id)
      setProject(result.project)
      setSelectedShotId('')
      const hasScenes = (result.project.scenes || []).length > 0
      const hasScript = (result.project.script?.scenes || []).length > 0
      setStep((result.project.shots || []).length ? 'shots' : hasScenes ? 'shots' : hasScript ? 'characters' : 'story')
    } catch (requestError) { guard(requestError) } finally { setBusy('') }
  }

  async function createProject() {
    if (!draftStory.trim()) { setError('请先粘贴故事原文'); return }
    setBusy('create'); setError('')
    try {
      const result = await createDramaProject({ title: draftTitle.trim() || '未命名短剧', story: draftStory.trim() })
      setProjects((current) => [{ id: result.project.id, title: result.project.title, stage: result.project.stage, updatedAt: result.project.updatedAt }, ...current])
      setProject(result.project)
      setStep('story')
      setDraftTitle(''); setDraftStory('')
    } catch (requestError) { guard(requestError) } finally { setBusy('') }
  }

  async function savePatch(patch, message) {
    if (!project) return
    try {
      const result = await updateDramaProject(project.id, patch)
      setProject(result.project)
      if (message) flash(message)
    } catch (requestError) { guard(requestError) }
  }

  async function runStage(stage, label) {
    if (!project) return
    setBusy(stage); setError('')
    try {
      const result = await planDramaStage(project.id, stage)
      setProject(result.project)
      setSelectedShotId('')
      flash(`${label}已生成`)
      if (stage === 'script') setStep('characters')
      if (stage === 'characters') setStep('scenes')
      if (stage === 'scenes') setStep('shots')
    } catch (requestError) { guard(requestError) } finally { setBusy('') }
  }

  async function saveStory() {
    if (!project || storyDraft === storyRef.current) return
    await savePatch({ story: storyDraft }, '故事已保存')
    storyRef.current = storyDraft
  }

  async function generateImage(prompt, { aspectRatio = '16:9', reference = '' } = {}) {
    const images = reference ? [await asDataUrl(reference)] : []
    const result = await generateImage({ prompt, images, aspectRatio, model: IMAGE_MODEL, resolution: '1k', quality: 'high' })
    if (result.user) onUserUpdate?.(result.user)
    const url = (result.urls || [])[0]
    if (!url) throw new Error('没有拿到生成结果')
    return url
  }

  async function makeFaceSheet(character) {
    setBusy(`face:${character.id}`); setError('')
    try {
      const url = await generateImage(characterSheetPrompt(character), { aspectRatio: '16:9' })
      const characters = (project.characters || []).map((item) => item.id === character.id ? { ...item, faceSheetUrl: url, faceSheetStatus: 'ready' } : item)
      await savePatch({ characters }, '角色三视图已生成')
    } catch (requestError) { guard(requestError) } finally { setBusy('') }
  }

  async function makeLook(character, look) {
    setBusy(`look:${look.id}`); setError('')
    try {
      const url = await generateImage(lookSheetPrompt(character, look), { aspectRatio: '4:5', reference: character.faceSheetUrl })
      const characters = (project.characters || []).map((item) => item.id === character.id
        ? { ...item, looks: (item.looks || []).map((entry) => entry.id === look.id ? { ...entry, url, status: 'ready' } : entry) }
        : item)
      await savePatch({ characters }, `${look.id} 已生成`)
    } catch (requestError) { guard(requestError) } finally { setBusy('') }
  }

  async function makeScene(scene, timeOfDay) {
    const key = `${timeOfDay === 'night' ? 'night' : 'day'}:${scene.id}`
    setBusy(key); setError('')
    try {
      const reference = timeOfDay === 'night' ? scene.dayUrl : ''
      const url = await generateImage(scenePrompt(scene, { timeOfDay }), { aspectRatio: '16:9', reference })
      const scenes = (project.scenes || []).map((item) => item.id === scene.id
        ? timeOfDay === 'night' ? { ...item, nightUrl: url, nightStatus: 'ready' } : { ...item, dayUrl: url, dayStatus: 'ready' }
        : item)
      await savePatch({ scenes }, timeOfDay === 'night' ? '夜间场景已生成' : '白天场景已生成')
    } catch (requestError) { guard(requestError) } finally { setBusy('') }
  }

  async function toggleLock(kind, id) {
    const key = kind === 'character' ? 'characters' : 'scenes'
    const list = (project[key] || []).map((item) => item.id === id ? { ...item, locked: !item.locked } : item)
    await savePatch({ [key]: list })
  }

  async function updateShot(id, patch) {
    const shots = (project.shots || []).map((shot) => shot.id === id ? { ...shot, ...patch } : shot)
    setProject((current) => ({ ...current, shots }))
    await savePatch({ shots })
  }

  function copy(text, label) {
    navigator.clipboard.writeText(text).then(() => flash(`${label}已复制`)).catch(() => setError('复制失败，请手动选择文本'))
  }

  async function removeProject(id) {
    if (!window.confirm('删除这个短剧项目？此操作不可恢复。')) return
    try {
      await deleteDramaProject(id)
      setProjects((current) => current.filter((item) => item.id !== id))
      if (project?.id === id) setProject(null)
    } catch (requestError) { guard(requestError) }
  }

  if (loading) return <section className="workspace drama-workspace"><div className="drama-loading"><i/><i/><i/></div></section>

  if (!project) return <section className="workspace drama-workspace">
    <div className="drama-landing">
      <header className="drama-landing-head">
        <span>SHORT DRAMA STUDIO</span>
        <h1>把一个故事，拆成可拍摄的资产包</h1>
        <p>先产出剧本结构、角色与场景设定、分镜提示词；画面与视频再按资产逐个生成。资产一次锁定，后续镜头反复复用。</p>
      </header>
      <div className="drama-create glass-strong">
        <label>剧名<input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="例如：雨夜来电" maxLength={40}/></label>
        <label>故事原文<textarea value={draftStory} onChange={(event) => setDraftStory(event.target.value)} rows="8" placeholder="粘贴小说片段、故事梗概或文字剧本…"/></label>
        <button type="button" className="drama-primary" onClick={() => void createProject()} disabled={busy === 'create' || !draftStory.trim()}>{busy === 'create' ? '正在创建…' : '开始拆解'}</button>
      </div>
      {projects.length > 0 && <div className="drama-project-list">
        <h3>继续之前的项目</h3>
        {projects.map((item) => <div className="drama-project-row glass-strong" key={item.id}>
          <button type="button" onClick={() => void openProject(item.id)}><b>{item.title}</b><small>{item.logline || `${item.storyLength} 字故事`}</small></button>
          <button type="button" className="drama-ghost" onClick={() => void removeProject(item.id)} aria-label="删除项目"><Icon name="x" size={14}/></button>
        </div>)}
      </div>}
    </div>
  </section>

  const shots = project.shots || []
  const characters = project.characters || []
  const scenes = project.scenes || []

  return <section className="workspace drama-workspace">
    <header className="drama-header">
      <div>
        <button type="button" className="drama-back" onClick={() => setProject(null)}>← 全部项目</button>
        <h1>{project.title}</h1>
        <small>{project.logline || '还没有一句话故事内核'}</small>
      </div>
      <div className="drama-header-stats">
        <span>{project.script?.scenes?.length || 0} 场</span>
        <span>{characters.length} 角色</span>
        <span>{scenes.length} 场景</span>
        <span>{shots.length} 镜头</span>
      </div>
    </header>

    <StepNav step={step} onSelect={setStep} project={project}/>

    {(error || notice) && <div className={`drama-banner ${error ? 'error' : ''}`}>{error || notice}{error && <button type="button" onClick={() => setError('')} aria-label="关闭提示"><Icon name="x" size={13}/></button>}</div>}

    <div className="drama-body">
      {step === 'story' && <div className="drama-panel">
        <div className="drama-panel-head">
          <div><h2>故事与剧本</h2><p>先锁定场次、地点与对白。分镜只引用场次，不再重复描述。</p></div>
          <div className="drama-actions">
            <button type="button" className="drama-primary" onClick={() => void runStage('script', '剧本结构')} disabled={Boolean(busy) || !storyDraft.trim()}>{busy === 'script' ? '正在改编…' : (project.script?.scenes || []).length ? '重新改编剧本' : '生成剧本结构'}</button>
          </div>
        </div>
        <div className="drama-split">
          <div className="drama-card glass-strong">
            <label className="drama-field">剧名<input value={project.title} onChange={(event) => setProject({ ...project, title: event.target.value })} onBlur={(event) => void savePatch({ title: event.target.value })} maxLength={40}/></label>
            <label className="drama-field">故事原文<textarea value={storyDraft} onChange={(event) => setStoryDraft(event.target.value)} onBlur={() => void saveStory()} rows="16" placeholder="粘贴小说、故事梗概或文字剧本…"/></label>
          </div>
          <div className="drama-card glass-strong">
            {(project.script?.scenes || []).length === 0 ? <Empty title="还没有剧本结构" description="生成后会得到场次、地点、时间、对白和预估时长。"/> : <ol className="drama-scene-list">
              {project.script.scenes.map((scene) => <li key={scene.id}>
                <header><b>{scene.id} · {scene.title}</b><small>{scene.location} · {scene.timeOfDay} · {scene.durationSeconds}s</small></header>
                <p>{scene.summary}</p>
                {scene.dialogue?.length > 0 && <ul className="drama-dialogue">{scene.dialogue.map((line, index) => <li key={index}><span>{line.speaker}</span>{line.line}</li>)}</ul>}
              </li>)}
            </ol>}
          </div>
        </div>
      </div>}

      {step === 'characters' && <div className="drama-panel">
        <div className="drama-panel-head">
          <div><h2>角色资产</h2><p>三视图锁定面部身份，服装造型单独成册。换装不换脸。</p></div>
          <div className="drama-actions">
            <button type="button" className="drama-primary" onClick={() => void runStage('characters', '角色设定')} disabled={Boolean(busy) || !(project.script?.scenes || []).length}>{busy === 'characters' ? '正在提取…' : characters.length ? '重新提取角色' : '提取角色'}</button>
          </div>
        </div>
        {characters.length === 0 ? <Empty title="还没有角色" description="先生成剧本结构，再从这里提取角色。"/> : <div className="drama-grid">
          {characters.map((character) => <article className="drama-asset glass-strong" key={character.id}>
            <header>
              <div><b>{character.id} · {character.name}</b><small>{[character.role, character.gender, character.age].filter(Boolean).join(' · ')}</small></div>
              <button type="button" className={`drama-lock ${character.locked ? 'on' : ''}`} onClick={() => void toggleLock('character', character.id)}>{character.locked ? '已锁定' : '锁定'}</button>
            </header>
            <div className="drama-asset-media">
              {character.faceSheetUrl ? <img src={character.faceSheetUrl} alt={`${character.name} 面部三视图`}/> : <div className="drama-asset-placeholder">尚未生成三视图</div>}
            </div>
            <dl className="drama-facts">
              <dt>面部</dt><dd>{character.appearance || '—'}</dd>
              <dt>基础穿搭</dt><dd>{character.wardrobe || '—'}</dd>
              <dt>音色</dt><dd>{character.voice || '—'}</dd>
            </dl>
            <button type="button" className="drama-secondary" onClick={() => void makeFaceSheet(character)} disabled={Boolean(busy)}>{busy === `face:${character.id}` ? '正在生成三视图…' : character.faceSheetUrl ? '重新生成三视图' : '生成面部三视图'}</button>
            <div className="drama-looks">
              {(character.looks || []).map((look) => <div className="drama-look" key={look.id}>
                <div className="drama-look-media">{look.url ? <img src={look.url} alt={`${look.name} 服装设定`}/> : <div className="drama-asset-placeholder small">{look.id}</div>}</div>
                <div className="drama-look-copy"><b>{look.name}</b><small>{look.description}</small></div>
                <button type="button" className="drama-ghost" onClick={() => void makeLook(character, look)} disabled={Boolean(busy)}>{busy === `look:${look.id}` ? '生成中…' : look.url ? '重生成' : '生成服装图'}</button>
              </div>)}
            </div>
          </article>)}
        </div>}
      </div>}

      {step === 'scenes' && <div className="drama-panel">
        <div className="drama-panel-head">
          <div><h2>场景资产</h2><p>一个空间一条记录。夜间版本以白天版本为参考生成，保证是同一个真实空间。</p></div>
          <div className="drama-actions">
            <button type="button" className="drama-primary" onClick={() => void runStage('scenes', '场景设定')} disabled={Boolean(busy) || !(project.script?.scenes || []).length}>{busy === 'scenes' ? '正在提取…' : scenes.length ? '重新提取场景' : '提取场景'}</button>
          </div>
        </div>
        {scenes.length === 0 ? <Empty title="还没有场景" description="生成场景后会得到建筑结构、材质、家具位置与灯光设定。"/> : <div className="drama-grid">
          {scenes.map((scene) => <article className="drama-asset glass-strong" key={scene.id}>
            <header>
              <div><b>{scene.id} · {scene.name}</b><small>{[scene.location, scene.timeOfDay].filter(Boolean).join(' · ')}</small></div>
              <button type="button" className={`drama-lock ${scene.locked ? 'on' : ''}`} onClick={() => void toggleLock('scene', scene.id)}>{scene.locked ? '已锁定' : '锁定'}</button>
            </header>
            <div className="drama-scene-pair">
              <figure><div className="drama-asset-media">{scene.dayUrl ? <img src={scene.dayUrl} alt={`${scene.name} 白天`}/> : <div className="drama-asset-placeholder">白天</div>}</div><figcaption>白天</figcaption></figure>
              <figure><div className="drama-asset-media">{scene.nightUrl ? <img src={scene.nightUrl} alt={`${scene.name} 夜晚`}/> : <div className="drama-asset-placeholder">夜晚</div>}</div><figcaption>夜晚</figcaption></figure>
            </div>
            <dl className="drama-facts">
              <dt>结构</dt><dd>{scene.architecture || '—'}</dd>
              <dt>道具</dt><dd>{(scene.props || []).join('；') || '—'}</dd>
              <dt>灯光</dt><dd>{scene.lighting || '—'}</dd>
            </dl>
            <div className="drama-actions">
              <button type="button" className="drama-secondary" onClick={() => void makeScene(scene, 'day')} disabled={Boolean(busy)}>{busy === `day:${scene.id}` ? '生成中…' : scene.dayUrl ? '重生成白天' : '生成白天'}</button>
              <button type="button" className="drama-secondary" onClick={() => void makeScene(scene, 'night')} disabled={Boolean(busy) || !scene.dayUrl}>{busy === `night:${scene.id}` ? '生成中…' : scene.nightUrl ? '重生成夜晚' : '生成夜晚'}</button>
            </div>
          </article>)}
        </div>}
      </div>}

      {(step === 'shots' || step === 'video') && <div className="drama-panel">
        <div className="drama-panel-head">
          <div><h2>{step === 'shots' ? '分镜工作台' : '视频生成'}</h2><p>{step === 'shots' ? '每个镜头不超过 15 秒，只演一个主要动作。提示词由资产实时编译。' : '首帧图与视频提示词都已按资产编译好，可直接送进生成模型。'}</p></div>
          <div className="drama-actions">
            <button type="button" className="drama-primary" onClick={() => void runStage('shots', '分镜')} disabled={Boolean(busy) || !scenes.length}>{busy === 'shots' ? '正在拆分镜…' : shots.length ? '重新拆分镜' : '自动拆分镜'}</button>
            {shots.length > 0 && <button type="button" className="drama-secondary" onClick={() => copy(shots.map((shot) => `${shot.id} · ${shot.durationSeconds}s\n${shotVideoPrompt(shot, context)}`).join('\n\n'), '全部分镜提示词')}>复制全部提示词</button>}
          </div>
        </div>
        {shots.length === 0 ? <Empty title="还没有分镜" description="生成前请确认角色与场景资产已经就绪，分镜会直接引用它们的 ID。"/> : <>
          <div className="drama-shot-table-wrap">
            <table className="drama-shot-table">
              <thead><tr><th>镜头</th><th>时长</th><th>景别 / 角度</th><th>动作</th><th>引用</th></tr></thead>
              <tbody>
                {shots.map((shot) => {
                  const spoken = estimatedDialogueSeconds(shot)
                  return <tr key={shot.id} className={selectedShotId === shot.id ? 'selected' : ''} onClick={() => setSelectedShotId(shot.id)}>
                    <td><b>{shot.id}</b>{shot.warnings?.length > 0 && <span className="drama-warn" title={shot.warnings.join('；')}>!</span>}</td>
                    <td><input type="number" min="4" max="15" value={shot.durationSeconds} onClick={(event) => event.stopPropagation()} onChange={(event) => void updateShot(shot.id, { durationSeconds: Math.min(15, Math.max(4, Number(event.target.value) || 4)) })}/>{spoken > 0 && <small className={spoken > shot.durationSeconds ? 'over' : ''}>台词≈{spoken}s</small>}</td>
                    <td>{shotSummary(shot) || '—'}</td>
                    <td className="drama-shot-action">{shot.action || '—'}</td>
                    <td><small>{shot.sceneId}{shot.characterIds?.length ? ` · ${shot.characterIds.join('、')}` : ''}<br/>{shot.lookId}</small></td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
          {selectedShot && <div className="drama-shot-detail glass-strong">
            <header>
              <div><b>{selectedShot.id}</b><small>{selectedShot.timeOfDay} · {selectedShot.durationSeconds}s · {selectedShot.sceneId}</small></div>
              <button type="button" className="drama-ghost" onClick={() => setSelectedShotId('')} aria-label="收起"><Icon name="x" size={14}/></button>
            </header>
            <div className="drama-detail-grid">
              <div>
                <div className="drama-detail-head"><span>视频提示词</span><button type="button" onClick={() => copy(shotVideoPrompt(selectedShot, context), '视频提示词')}><Icon name="copy" size={13}/>复制</button></div>
                <pre>{shotVideoPrompt(selectedShot, context)}</pre>
              </div>
              <div>
                <div className="drama-detail-head"><span>首帧生图提示词</span><button type="button" onClick={() => copy(shotFirstFramePrompt(selectedShot, context), '首帧提示词')}><Icon name="copy" size={13}/>复制</button></div>
                <pre>{shotFirstFramePrompt(selectedShot, context)}</pre>
              </div>
            </div>
            {selectedShot.warnings?.length > 0 && <ul className="drama-warning-list">{selectedShot.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
            <footer>
              <span>连续性：{selectedShot.continuity || '未填写'}</span>
              <span>声音：{[selectedShot.dialogue?.map((line) => `${line.speaker}：${line.line}`).join(' '), selectedShot.sound].filter(Boolean).join('；') || '—'}</span>
            </footer>
          </div>}
        </>}
        {step === 'video' && shots.length > 0 && <div className="drama-note glass-strong">
          <b>下一步接入</b>
          <p>逐镜生成已经可以走现有的视频模型：用首帧提示词出图，再把首帧 + 视频提示词提交给 Seedance / MiniMax。剪辑与配音放在最后一期，避免前期被拼接细节拖住。修改角色或场景后，可用引用反查受影响的镜头重新生成，不必从头再做。</p>
        </div>}
      </div>}

      {step === 'export' && <div className="drama-panel">
        <div className="drama-panel-head">
          <div><h2>导出资产包</h2><p>一个 JSON 带走全部资产与已编译提示词，换任何视频平台都能接着做。</p></div>
          <div className="drama-actions">
            <button type="button" className="drama-primary" onClick={() => downloadFile(`${safeName(project.title, '短剧资产包')}.json`, JSON.stringify(buildAssetPackage(project), null, 2))}>下载资产包</button>
            <button type="button" className="drama-secondary" onClick={() => copy(buildAssetPackage(project)?.shots.map((shot) => `${shot.id} · ${shot.durationSeconds}s\n${shot.prompts.video}`).join('\n\n') || '', '视频提示词清单')}>复制提示词清单</button>
          </div>
        </div>
        <div className="drama-export-grid">
          {(characters.length || scenes.length || shots.length) === 0 ? <Empty title="先完成前四个阶段" description="资产包包含剧本、角色、场景、分镜与全部编译后的提示词。"/> : <>
            <article className="drama-card glass-strong"><h3>角色 {characters.length}</h3><p>{characters.map((item) => `${item.id} ${item.name}（${item.looks?.length || 0} 套造型）`).join('、') || '—'}</p></article>
            <article className="drama-card glass-strong"><h3>场景 {scenes.length}</h3><p>{scenes.map((item) => `${item.id} ${item.name}`).join('、') || '—'}</p></article>
            <article className="drama-card glass-strong"><h3>镜头 {shots.length}</h3><p>合计约 {shots.reduce((total, shot) => total + shot.durationSeconds, 0)} 秒</p></article>
            <article className="drama-card glass-strong"><h3>引用关系</h3><p>{characters.map((character) => `${character.name} → ${shotsReferencing(shots, { characterId: character.id }).length} 镜`).join('；') || '—'}</p></article>
          </>}
        </div>
      </div>}
    </div>
  </section>
}
