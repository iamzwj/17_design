export const ACTIVITY_FORMAT_PROMPTS = Object.freeze({
  strategy: '根据营销活动资料，帮我制定一份可执行的活动方案。',
  image: '根据当前活动方向和身份，生成一张有清晰主题的营销海报。',
  content: '帮我制作一套小红书图文，包含标题、正文和逐页配图脚本。',
  slides: '将活动方案制作成 HTML 演示稿，先给出清晰大纲，再生成完整演示页面。',
})
export function activityFormatDraft(current, next) {
  // A format change must never overwrite a user-authored brief.
  const text = String(current || '')
  return !text.trim() || Object.values(ACTIVITY_FORMAT_PROMPTS).includes(text) ? next : text
}
