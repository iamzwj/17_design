import ComposerSelect from './ComposerSelect.jsx'
import './generationSkills.css'
export default function GenerationSkillPicker({ target, state }) {
  return <div className="generation-skill-picker" onPointerDown={() => { void state.reload() }}>
    <ComposerSelect label={target === 'video' ? '生视频 Skill' : '生图 Skill'} icon="spark" value={state.id} placeholder="Skill" options={[{ value: '', label: '不使用 Skill' }, ...state.skills.map((s) => ({ value: s.id, label: `${s.builtIn ? '内置 · ' : ''}${s.title}` })), ...(state.id && !state.selected ? [{ value: state.id, label: state.loading ? '正在加载 Skill…' : '所选 Skill 暂不可用' }] : [])]} onChange={state.select} footer={<><p>{state.selected?.summary || '已发布且适用于此工具的 Skill 会显示在这里。'}</p>{state.error && <p role="alert">{state.error}</p>}</>}/>
  </div>
}
