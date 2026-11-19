const names = {
  'image to editable ppt': '图片转可编辑 PPT',
  'image-to-editable-ppt': '图片转可编辑 PPT',
  'video-storyboard': '分镜与视频提示词',
  'video-character-design': '视频角色设定',
  'video-poster-design': '电影海报设计',
  'gunpla-poster': '高达模型海报',
  'film-cinematography-master': '电影运镜指导',
}

export function skillDisplayName(value) {
  const title = String(value || '')
  return names[title.trim().toLowerCase()] || title
}
