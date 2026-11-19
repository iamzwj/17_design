import { skillDisplayName } from './skillDisplayName.js'
import ComposerSelect from './ComposerSelect.jsx'
import './generationSkills.css'
export default function GenerationSkillPicker({ target, state }) {
  return <div className="generation-skill-picker" onPointerDown={() => { void state.reload() }}>
    <ComposerSelect label={target === 'chat' ? '对话 Skill' : target === 'video' ? '生视频 Skill' : '生图 Skill'} icon="spark" value={state.id} placeholder="Skill" options={[{ value: '', label: '不使用 Skill' }, ...state.skills.map((s) => ({ value: s.id, label: skillDisplayName(s.title) })), ...(state.id && !state.selected ? [{ value: state.id, label: state.loading ? '正在加载 Skill…' : '所选 Skill 暂不可用' }] : [])]} onChange={state.select} footer={state.error || (state.id?.startsWith('external-') && !state.selected && !state.loading) ? <p role="alert">{state.error || state.unavailableReason || '本机缺少 Skill 文件，请到发现 Skill → 已安装重新下载。'}</p> : target === 'chat' ? <p>对话支持文字规则；图片转 PPT 支持上传一张图片并生成文件。</p> : null}/>
  </div>
}
