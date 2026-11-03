// 短剧提示词编译器。
//
// 这里全部是纯函数：输入结构化资产，输出可直接用于生图 / 生视频的中文提示词。
// 界面展示、复制、导出都走同一份实现，保证「看到的」和「送进模型的」完全一致。
// 任何提示词都不要在数据库里存成字符串——只存引用，需要时现编译。

export const MAX_SHOT_SECONDS = 15
export const DIALOGUE_CHARS_PER_SECOND = 4

const CLEAN = /\s+/g

function line(label, value) {
  const body = String(value || '').replace(CLEAN, ' ').trim()
  return body ? `【${label}】${body}` : ''
}

function joinLines(parts) {
  return parts.filter(Boolean).join('\n')
}

export function characterTitle(character) {
  return [character?.name, character?.gender, character?.age].filter(Boolean).join('，')
}

// 一张图里画三个视角，是保证「同一个人」最稳的做法：模型在同框时会自己对齐五官。
export function characterSheetPrompt(character) {
  if (!character) return ''
  return joinLines([
    '角色面部设定图，同一张画布上并排绘制同一个人物的正面、45°侧面、90°侧面三个头部特写。',
    line('角色', `${characterTitle(character)}${character.identity ? `，${character.identity}` : ''}`),
    line('面部', character.appearance),
    line('造型', character.wardrobe),
    line('要求', '三个视角必须是同一个人，五官比例、脸型、眉形、眼距、鼻梁、唇形、肤色、发长与发色完全一致，不得变脸'),
    line('质感', '真实皮肤质感，自然柔和光线，中性表情，不夸张，不带戏剧化妆容'),
    line('版式', '纯灰白背景，三个头部等大并排，头部之间留出空隙，不要文字'),
    line('禁止', '不要分镜画面、不要全身、不要多余人物、不要文字水印'),
  ])
}

export function lookSheetPrompt(character, look) {
  if (!character || !look) return ''
  return joinLines([
    '角色服装设定图，同一张画布上绘制同一人物的全身正面、全身侧面、全身背面，并附服饰细节特写。',
    line('角色', `${characterTitle(character)}${character.identity ? `，${character.identity}` : ''}`),
    line('面部锁定', `面部必须与角色三视图完全一致：${character.appearance}`),
    line('造型', `${look.name}：${look.description}`),
    line('要求', '正面、侧面、背面必须是同一个人、同一套衣服，服装版型、材质、颜色、穿着层次前后一致'),
    line('细节', '鞋履、配饰、随身物品的位置与样式在三视图中保持一致，配饰在侧背面同位置可见'),
    line('版式', '纯浅灰背景，四个视图等间距排列，全身占比一致，不要文字'),
    line('禁止', '不要换发型、不要换脸、不要改变肤色、不要多人合影'),
  ])
}

export function scenePrompt(scene, { timeOfDay = 'day' } = {}) {
  if (!scene) return ''
  const night = timeOfDay === 'night'
  return joinLines([
    night ? '场景环境设定图，同一空间的夜间版本，机位与构图必须与白天版本完全一致。' : '场景环境设定图，同一空间的白天版本。',
    line('场景', `${scene.id} ${scene.name}${scene.location ? `（${scene.location}）` : ''}`),
    line('建筑', scene.architecture),
    line('材质', scene.materials),
    line('布局', scene.furniture),
    line('道具', (scene.props || []).join('；')),
    line('光线', night ? `夜间光效：${scene.lighting || '路灯与室内灯为光源'}；保留窗内暖光与地面反光，暗部保留细节` : `日间光效：${scene.lighting || '自然光为主要光源'}；阴影方向明确`),
    line('色调', scene.palette),
    line('气氛', scene.mood),
    line('要求', night ? '建筑结构、门窗位置、家具与道具的摆放必须与白天版本逐一对齐，只改变光照与色温' : '空间结构清晰，无人物，无文字'),
    line('禁止', '不要人物、不要文字、不要风格化插画'),
  ])
}

export function estimatedDialogueSeconds(shot) {
  const characters = (shot?.dialogue || []).reduce((total, item) => total + String(item.line || '').replace(/\s+/g, '').length, 0)
  return Math.ceil(characters / DIALOGUE_CHARS_PER_SECOND)
}

function referenceLine(shot, context) {
  const characters = (shot.characterIds || []).map((id) => context.charactersById?.get(id)).filter(Boolean)
  if (!characters.length) return ''
  return characters.map((character) => {
    const look = (character.looks || []).find((item) => item.id === shot.lookId) || character.looks?.[0]
    const face = character.faceSheetUrl ? '面部严格对齐角色三视图' : '面部按角色设定描述'
    const lookText = look ? `，穿着 ${look.id}「${look.name}」：${look.description}` : ''
    return `${character.id} ${character.name}：${face}${lookText}`
  }).join('；')
}

export function shotVideoPrompt(shot, context = {}) {
  if (!shot) return ''
  const scene = context.scenesById?.get(shot.sceneId)
  const dialogue = (shot.dialogue || []).map((item) => `${item.speaker}：「${item.line}」`).join(' ')
  return joinLines([
    line('时间', shot.timeOfDay),
    line('场景', [shot.sceneId, scene?.name, scene ? '保持与场景设定图一致' : ''].filter(Boolean).join('，')),
    line('角色', referenceLine(shot, context)),
    line('画面', [shot.shotSize, shot.angle, shot.composition].filter(Boolean).join('，')),
    line('动作', shot.action),
    line('情绪', shot.emotion),
    line('光线', shot.lighting),
    line('摄影机', shot.camera),
    line('声音', [dialogue ? `对白 ${dialogue}` : '', shot.sound].filter(Boolean).join('；')),
    line('连续性', shot.continuity),
    line('时长', `${shot.durationSeconds} 秒，单个连续镜头，不要剪辑点`),
  ])
}

export function shotFirstFramePrompt(shot, context = {}) {
  if (!shot) return ''
  const scene = context.scenesById?.get(shot.sceneId)
  return joinLines([
    line('画面', shot.firstFrame || shot.composition),
    line('时间', shot.timeOfDay),
    line('场景', [shot.sceneId, scene?.name, scene ? '空间结构、家具与道具位置与场景设定图一致' : ''].filter(Boolean).join('，')),
    line('角色', referenceLine(shot, context)),
    line('景别', [shot.shotSize, shot.angle].filter(Boolean).join('，')),
    line('光线', shot.lighting),
    line('要求', '是一张静止的电影剧照，直接作为视频首帧；人物面部与服装必须与角色资产一致'),
    line('禁止', '不要文字、不要分屏、不要多格漫画'),
  ])
}

export function shotSummary(shot) {
  return [shot?.shotSize, shot?.angle, shot?.emotion].filter(Boolean).join(' · ')
}

export function contextForProject(project) {
  return {
    charactersById: new Map((project?.characters || []).map((item) => [item.id, item])),
    scenesById: new Map((project?.scenes || []).map((item) => [item.id, item])),
  }
}

// 改资产后要能反查受影响的镜头，这是「不用从头再来」的关键。
export function shotsReferencing(shots, { characterId, lookId, sceneId }) {
  return (shots || []).filter((shot) => (
    (characterId && (shot.characterIds || []).includes(characterId))
    || (lookId && shot.lookId === lookId)
    || (sceneId && shot.sceneId === sceneId)
  )).map((shot) => shot.id)
}
