export function filmConsistencyPrompt(p, shot) {
  const cast = (p.characters || []).map(c => ({id:c.id,name:c.name,identity:c.identity,voice:c.voice,outfits:(c.outfits || []).filter(o => (shot.outfitIds || []).includes(o.id))}));
  const scene = (p.scenes || []).find(s => s.id === shot.sceneId);
  return [
    '全片统一视觉风格：' + (p.settings?.style || '电影写实'),
    /写实|实拍|摄影|photoreal/i.test(p.settings?.style || '电影写实') && !/卡通|动漫|动画|插画|cartoon|anime/i.test(p.settings?.style || '') ? '所有角色及场景设定图、昼夜视图、分镜和视频均使用真实摄影质感、真实材质与物理光照；设定图仅表示视图编排，不表示概念插画。禁止卡通、绘画、手绘线稿、游戏渲染或Concept Art，忽略局部提示词中与此冲突的画风词。' : '全部设定图与镜头严格使用指定风格，保持相同渲染方式、材质与色彩，不混用实拍和插画。',
    '全片人物与声音身份表：' + JSON.stringify(cast),
    '本镜出镜角色：' + JSON.stringify(shot.characterIds || []),
    scene && '固定场景布局与材质：' + JSON.stringify(scene),
    p.script?.narrator && '全片固定旁白：' + JSON.stringify(p.script.narrator),
    '对白绑定说话人身份、性别与年龄，同一角色跨镜保持相同音色、口音和语速。第一人称旁白使用叙述者本人声线，保持画外音，不要求人物口播。不得自行增加旁白、对白或说话人。',
    '保持参考图中同一张脸、体型、服装与空间布局，只按剧本明确要求改变年代、服装、天气与地点，不自行更换画风。'
  ].filter(Boolean).join('；');
}
