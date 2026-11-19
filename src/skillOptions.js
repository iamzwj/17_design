const pptName = /^---\s*\r?\n[\s\S]*?^name:\s*["']?image-to-editable-ppt["']?\s*$/m
const isPpt = (skill) => skill.id === 'image-to-editable-ppt' || skill.name === 'image-to-editable-ppt' || pptName.test(skill.markdown || '')

export function uniqueSkillOptions(skills, selectedId) {
  const builtin = skills.find((skill) => skill.id === 'image-to-editable-ppt' && skill.builtIn)
  if (!builtin) return { skills, selectedId }
  const duplicate = skills.find((skill) => skill.id === selectedId && skill.id !== builtin.id && isPpt(skill))
  return { skills: skills.filter((skill) => skill.id === builtin.id || !isPpt(skill)), selectedId: duplicate ? builtin.id : selectedId }
}
