import ComposerSelect from './ComposerSelect.jsx'
import { Icon } from './icons.jsx'
import './activityStrategy.css'

export const DEFAULT_ACTIVITY = { enabled: true, identity: '', scope: '', campaign: '', format: 'strategy' }
export default function ActivityStrategy({ value, onChange, onPrompt, compact = false }) {
  const change = patch => onChange({ ...value, ...patch })
  return <div className={`activity-strategy ${compact ? 'compact' : ''}`}>
    {!compact && <><div className="activity-section-heading"><b>近期活动</b><span>快捷指定方向，也可直接描述需求，由 AI 检索营销活动资料</span></div><div className="activity-shortcuts">
      {[['跨年营销', '历史同期参考', '参考去年年终福利节，筹划新的跨年营销'], ['社区冰爽节', '历史活动参考', '参考暑期策划，结合当前需求调整']].map(([name, tag, note]) => <button type="button" key={name} aria-pressed={value.campaign === name} onClick={() => change({ campaign: value.campaign === name ? '' : name, enabled: true })}><span>{tag}</span><h3>{name}<Icon name={value.campaign === name ? 'check' : 'chevron'} size={17}/></h3><p>{note}</p></button>)}
    </div></>}
    <div className="activity-context-row"><ComposerSelect label="业务身份" value={value.identity} placeholder="身份 · 自动识别" options={['', '研选家', '朴邻', '住这儿', '万科物业'].map(x => ({ value: x, label: x || '根据需求识别身份' }))} onChange={identity => change({ identity })}/><label className="activity-scope"><Icon name="person" size={14}/><input aria-label="属地与执行范围" value={value.scope} maxLength={100} placeholder="属地与范围，如武汉幸福社" onChange={e => change({ scope: e.target.value })}/></label>{value.campaign && <button className="activity-selected" type="button" onClick={() => change({ campaign: '' })}>{value.campaign}<Icon name="x" size={12}/></button>}</div>
    {<div className="activity-actions">{[['strategy', '生成策略', 'spark', '根据营销活动资料，帮我制定一份可执行的活动方案。'], ['image', '生成图片', 'image', '根据当前活动方向和身份，生成一张有清晰主题的营销海报。'], ['content', '生产图文', 'book', '帮我制作一套小红书图文，包含标题、正文和逐页配图脚本。'], ['slides', '制作演示稿', 'blocks', '将活动方案制作成 HTML 演示稿，先给出清晰大纲，再生成完整演示页面。']].map(([format, title, icon, prompt]) => <button type="button" key={format} onClick={() => { change({ format }); onPrompt(prompt) }} aria-pressed={value.format === format}><Icon name={icon} size={18}/><span>{title}</span><Icon name="chevron" size={12}/></button>)}</div>}
  </div>
}
export function ActivityKnowledgePicker({ value, onChange }) {
  return <ComposerSelect icon="library" label="知识库" placeholder="知识库" value={value.enabled ? 'marketing' : ''} options={[{ value: '', label: '不使用营销资料' }, { value: 'marketing', label: '营销活动' }]} onChange={id => onChange({ ...value, enabled: id === 'marketing', ...(!id ? { campaign: '' } : {}) })} footer={<><p>按活动属性、时间和业务检索已发布资料；身份规范同时加载。无需逐份选择文件。</p><a href="?module=marketing-activities">管理营销活动资料 ↗</a></>}/>
}
