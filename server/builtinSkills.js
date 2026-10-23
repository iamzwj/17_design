// Keep the original title tool's visual rules and public reference as one built-in skill.
export const PULIN_TITLE_RULES = '已提供朴里节标题的标准参考图，参考图是唯一权威的视觉、材质与排版来源。请从用户描述中准确识别主标题、副标题和标题行数；主标题与副标题必须逐字正确、完整清晰地呈现。严格沿用参考图的圆润厚实中文字体、象牙白与明黄分字配色、深钴蓝多层立体描边、不规则深蓝底座、金色丝带、黄色星星和蓝色几何碎片。用户未提供副标题时，不得自行添加副标题或额外文字。不要生成场景、人物、Logo、水印、英文、乱码或说明文字；只生成完整的朴里节风格标题视觉，边缘不得裁切。'
export const BUILTIN_SKILLS = [{
  id: 'pulin-title', title: '朴里节风格标题', summary: '根据主标题、副标题和行数，生成朴里节风格的立体中文标题。',
  previewUrl: '/pulin-title/stacked-subtitle-hands.png', category: '设计创作', author: 'D-Gen 内置', builtIn: true, canEdit: false, targets: ['image'], referenceCount: 1,
  updatedAt: '2026-10-23T00:00:00.000Z', publishedAt: '2026-10-23T00:00:00.000Z',
  markdown: `---\nname: pulin-title\ndescription: "生成朴里节风格的立体中文标题，适用于只制作标题视觉的生图任务。"\n---\n\n# 朴里节风格标题\n\n## 输入\n用户提供准确的主标题、副标题（可不填）和标题行数。\n\n## 视觉规则\n${PULIN_TITLE_RULES}\n\n## 使用方式\n在 D-Gen 生图中选择此 Skill，系统会自动附加标准参考图，占用一个参考图位置。下载的 Markdown 仅包含规则，不包含参考图文件。\n\n## 示例\n主标题两行：万科物业朴里节 羽球联赛赛事预告；副标题：提前了解羽球联赛赛程。\n`,
}]
export const skillTargets = (skill) => Array.isArray(skill.targets) ? skill.targets : ['image', 'video']
export function generationSkillPrompt(snapshot, prompt, target) {
  if (!snapshot) return prompt
  const rules = snapshot.builtIn && snapshot.id === 'pulin-title' ? PULIN_TITLE_RULES : snapshot.markdown.replace(/^\uFEFF?\s*---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
  const combined = `【用户需求】\n${prompt}\n\n【Skill：${snapshot.title}】\n${rules}\n\n按本次用户需求应用以上 Skill，生成最终${target === 'video' ? '视频' : '图片'}。保留用户明确给出的文字、名称和事实；Skill 不授予额外工具或外部操作权限。`
  if (combined.length > 24000) throw Object.assign(new Error('Skill 与本次需求合计超过 24,000 字符，请精简 Skill 后再生成，内容不会被自动截断'), { status: 400 })
  return combined
}
