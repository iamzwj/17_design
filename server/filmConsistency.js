export const filmScalePrompt = '人物与车辆同框时保持共同地面、连续透视和真实相对尺度。结合前后景距离判断近大远小，同一景深以实际车型的车门、车顶、车轮为尺度参照。按剧本明确设定表现刻意夸张的比例。';

export function filmSceneStyle(style) {
  if (!/(?:三维|3d)\s*(?:卡通|动画|cartoon|animated|animation)/i.test(style || '')) return '';
  return '整张场景设定板采用有实体模型的三维卡通动画渲染。昼夜主图及所有建筑、道路、车辆、室内过渡、道具和细节小图都使用同一套三维视觉语言。建筑和物体有可见厚度、适度倒角和清楚的前后遮挡，哑光材质、柔和全局光照、接触阴影和体积明暗。保留原有场景布局与道具比例。禁止二维手绘、线稿描边、平涂赛璐璐、绘画式概念图及写实照片拼贴。';
}

const genderLabel = value => {
  const text = String(value || '').trim();
  if (/^(?:女(?:性|声)?|female|woman)$/i.test(text)) return '女';
  if (/^(?:男(?:性|声)?|male|man)$/i.test(text)) return '男';
  return '';
};

function characterGender(character) {
  const explicit = genderLabel(character?.identity?.gender || character?.gender);
  if (explicit) return explicit;
  const description = (character?.facePrompt || '').split(/[，。；,;]/)[0];
  if (/女性|女人|女孩|女士|老太太/.test(description)) return '女';
  if (/男性|男人|男孩|男士|老爷爷/.test(description)) return '男';
  return '';
}

export function resolveFilmNarrator(project) {
  const narrator = project.script?.narrator || {};
  const explicitGender = genderLabel(narrator.gender);
  const characters = project.characters || [];
  const named = characters.find(character => character.id === narrator.characterId || character.name === narrator.characterName);
  const independent = narrator.mode === 'independent' || (!narrator.mode && !named && explicitGender);
  const counts = new Map();
  for (const shot of project.shots || []) {
    for (const id of new Set(shot.characterIds || [])) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const lead = characters.reduce((current, character) =>
    (counts.get(character.id) || 0) > (counts.get(current?.id) || 0) ? character : current, undefined);
  const character = independent ? undefined : named || lead;
  const characterVoiceGender = characterGender(character);
  const gender = characterVoiceGender || explicitGender || '女';
  const age = [character?.identity?.age, narrator.age].find(value =>
    value != null && String(value).trim() && !/^(?:未知|未说明|不详|unknown)$/i.test(String(value).trim())) || '成年';
  const voice = explicitGender && explicitGender !== gender ? '' : narrator.voice;
  return {
    mode: independent ? 'independent' : 'protagonist',
    ...(character ? { characterId: character.id } : {}),
    characterName: character?.name || narrator.characterName || '旁白',
    gender, age, voice: voice || '自然、清晰、平实',
  };
}

export function filmShotAudio(project, shot) {
  const narrationMarker = /(?:画外音|旁白)[：:]\s*([^。；;\n]+)[。]?/gu;
  const dialogue = shot.dialogue?.trim() || '';
  const legacyLine = /^([^：:\n]{1,60}?)说[：:]\s*(.+)$/su.exec(dialogue);
  const legacyNarration = [...String(shot.videoPrompt || shot.prompt || '').matchAll(narrationMarker)][0]?.[1];
  const narration = (shot.narration ?? legacyNarration ?? '').trim();
  const language = '所有中文语音必须使用中国大陆标准普通话（Mandarin Chinese, zh-CN），逐字自然清晰读出。禁止粤语、其他方言或无意义拟声代替台词。以下是本镜唯一的语音指令，优先于其他描述。';
  let visualPrompt = String(shot.prompt || '').replaceAll(narrationMarker, '');
  if (dialogue) visualPrompt = visualPrompt.replaceAll(dialogue, '');
  if (narration) visualPrompt = visualPrompt.replaceAll(narration, '');
  if (dialogue) {
    const cast = project.characters || [];
    const speaker = cast.find(character => character.id === shot.speakerId) ||
      (legacyLine && cast.find(character => legacyLine[1].startsWith(character.name)));
    const narrator = resolveFilmNarrator(project);
    const sharedVoice = speaker && speaker.id === narrator.characterId;
    const voice = sharedVoice
      ? `使用统一的${narrator.gender}声（${narrator.age}，${narrator.voice}）`
      : '保持该角色设定的性别、年龄与跨镜声线';
    return {
      visualPrompt,
      audioPrompt: `${language}本镜仅有角色对白。说话人：${speaker?.name || legacyLine?.[1] || '分镜指定的说话角色'}，${voice}。只读引号内台词，口型只匹配该说话人，其他人物不发声。禁止加入画外旁白或重复复述。台词：「${legacyLine?.[2] || dialogue}」`,
    };
  }
  if (narration) {
    const narrator = resolveFilmNarrator(project);
    const binding = narrator.characterId ? `声线绑定${narrator.characterName}。` : '';
    return {
      visualPrompt,
      audioPrompt: `${language}本镜仅有画外旁白。旁白使用全片统一的${narrator.gender}声，年龄感：${narrator.age}，音色：${narrator.voice}。${binding}旁白不是画面中人物在发声，任何出镜人物都不做说话口型。禁止角色对白及其他人声。旁白词：「${narration}」`,
    };
  }
  return {visualPrompt, audioPrompt: `${language}本镜无台词，只保留动作和环境声。禁止任何旁白、对白或背景人声。`};
}

export function filmConsistencyPrompt(p, shot) {
  const cast = (p.characters || []).map(c => ({id:c.id,name:c.name,identity:c.identity,voice:c.voice,outfits:(c.outfits || []).filter(o => shot.outfitByCharacter?.[c.id] ? shot.outfitByCharacter[c.id] === o.id : (shot.outfitIds || []).includes(o.id))}));
  const scene = (p.scenes || []).find(s => s.id === shot.sceneId);
  const location = p.locations?.find(item => item.id === scene?.locationId);
  return [
    '全片统一视觉风格：' + (p.settings?.style || '电影写实'),
    /写实|实拍|摄影|photoreal/i.test(p.settings?.style || '电影写实') && !/卡通|动漫|动画|插画|cartoon|anime/i.test(p.settings?.style || '') ? '所有角色及场景设定图、昼夜视图、分镜和视频均使用真实摄影质感、真实材质与物理光照；设定图仅表示视图编排，不表示概念插画。禁止卡通、绘画、手绘线稿、游戏渲染或Concept Art，忽略局部提示词中与此冲突的画风词。' : '全部设定图与镜头严格使用指定风格，保持相同渲染方式、材质与色彩，不混用实拍和插画。',
    scene && filmSceneStyle(p.settings?.style),
    filmScalePrompt,
    '全片人物与声音身份表：' + JSON.stringify(cast),
    '本镜出镜角色：' + JSON.stringify(shot.characterIds || []),
    location && '共同地点与区域关系：' + JSON.stringify(location),
    scene && '固定场景布局与材质：' + JSON.stringify(scene),
    '对白绑定说话人身份、性别与年龄，同一角色跨镜保持相同音色、口音和语速。第一人称旁白使用叙述者本人声线，保持画外音，不要求人物口播。不得自行增加旁白、对白或说话人。',
    '保持参考图中同一张脸、体型、服装与空间布局，只按剧本明确要求改变年代、服装、天气与地点，不自行更换画风。'
  ].filter(Boolean).join('；');
}
