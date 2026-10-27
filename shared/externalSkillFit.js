// Purpose matching is a conservative first pass, not an execution guarantee.
export function externalSkillFit(record = {}) {
  const text = `${record.name || ''} ${record.title || ''} ${record.summary || ''}`.toLowerCase()
  const engineering = /\b(frontend|backend|react|nextjs|next\.js|typescript|javascript|devops|kubernetes|docker|git|github|coding|debugging|database|sql|testing|unit-test|web-design|web-app)\b|前端|后端|编程|代码|运维|数据库/.test(text)
  if (engineering) return { category: 'other', label: '暂不适用', targets: [], reason: '面向开发或其他工具，当前工作台没有对应的 Skill 执行入口。' }
  const image = /image|photo|poster|logo|illustrat|graphic|typograph|brand-design|branding|visual-design|ai-art|图像|图片|生图|摄影|海报|插画|平面设计|视觉设计|品牌设计|标志|字体设计/.test(text)
  const video = /video|storyboard|filmmak|cinematic|animation|motion-design|视频|分镜|镜头|动画|生视频/.test(text)
  if (image || video) return { category: image ? 'image' : 'video', label: image && video ? '图像 / 视频' : image ? '图像创作' : '视频创作', targets: [image && 'image', video && 'video'].filter(Boolean), reason: '用途与生成工具相关；通过文件依赖检查后，可作为对应工具的文字规则使用。' }
  if (/copywrit|marketing|campaign|content-writ|seo|品牌|文案|营销|策划|广告/.test(text)) return { category: 'planning', label: '文案 / 品牌策划', targets: [], reason: '可作为海报或营销策划参考，但尚未适配生图、生视频的规则格式，当前仅支持下载阅读。' }
  if (/compliance|brand-guideline|knowledge|合规|审核|品牌规范|知识库/.test(text)) return { category: 'reference', label: '审核 / 知识参考', targets: [], reason: '用途相关，但合规审核、知识库等模块尚未接入外部 Skill，当前仅支持下载阅读。' }
  return { category: 'other', label: '待确认用途', targets: [], reason: '未确认与当前生成工具的适用关系，先下载阅读，适配后再使用。' }
}
