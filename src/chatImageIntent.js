export function isChatImageRequest(input) {
  const text = input.trim()
  if (!text || /^(?:不要|别|不用|如何|怎么|为什么|什么是)/u.test(text)) return false
  if (/提示词|prompt|(?:生图|生成图片)(?:功能|流程|教程|原理|接口|模型)/iu.test(text)) return false
  if (/^(?:请\s*)?(?:帮我\s*|给我\s*|为我\s*|用.+?(?:来|帮我|给我))*(?:生图|画(?!图表|流程图)|绘制|(?:生|生成|制作|做)(?:一[张幅组]|个|一张)?[^。！？\n]{0,24}(?:图片|插画|海报|照片|头像|壁纸|效果图|视觉图|配图|图像))/u.test(text)) return true
  if (/^(?:请\s*)?(?:帮我\s*|给我\s*)?(?:画|生)(?:一张|一幅|一只|一组)[^。！？\n]{1,50}$/u.test(text)) return true
  if (/^(?:请\s*)?(?:给|发)(?:我)?一[张幅组][^。！？\n]{0,30}(?:图片|插画|海报|照片|头像|图像)/u.test(text)) return true
  return /^(?:please\s+)?(?:draw|paint|(?:generate|create|make)\s+(?:me\s+)?(?:an?\s+)?(?:image|illustration|poster|picture|photo))\b/i.test(text)
}

export function chatImagePrompt(input, messages) {
  const followUp = /^(?:请\s*|帮我\s*|把上面(?:的内容)?\s*)*(?:(?:做|改|生成|设计)成|转成|转为)[^。！？\n]*(?:海报|图片|插画|配图|图像)[。！!]?$/u
  if (!followUp.test(input.trim())) return input

  const previous = messages.filter(message =>
    ['user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string' && message.content.trim() &&
    !message.content.includes('dalle.text2im') &&
    !followUp.test(message.content.trim()),
  ).slice(-4)
  if (!previous.length) return input

  const context = previous.map(message =>
    `${message.role === 'user' ? '用户需求' : '已讨论的方案'}：\n${message.content.slice(0, 6000)}`,
  ).join('\n\n')
  return `当前制作要求：${input}\n请依据以下对话制作，保留相关主题、品牌、文案、数字与视觉方向。用户最新明确指定的内容优先。\n\n${context}`
}
