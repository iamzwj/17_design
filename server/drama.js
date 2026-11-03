import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// 短剧工作台的服务端。
//
// 设计原则：分镜里只存引用（sceneId / characterIds / lookId），提示词每次由
// 编译器现拼。这样改一个角色可以反查出所有受影响的镜头，而不是把所有文字
// 都固化在每个镜头里。四个阶段的模型调用只负责产出结构化数据，不做拼装。

const STORY_LIMIT = 24_000
const SHOT_LIMIT = 80
const SCENE_LIMIT = 24
const CHARACTER_LIMIT = 16
const PLAN_TIMEOUT_MS = 180_000
const STAGES = ['script', 'characters', 'scenes', 'shots']

const FIELD_LIMITS = { title: 80, logline: 400, story: STORY_LIMIT }

function text(value, limit) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, limit)
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function jsonFromModel(content) {
  const source = String(content || '').trim().replace(/<think>[\s\S]*?<\/think>/gi, '')
  const fenced = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('剧本模型没有返回结构化结果，请重试')
  try {
    return JSON.parse(fenced.slice(start, end + 1))
  } catch {
    throw new Error('剧本模型返回的结构无法解析，请重试')
  }
}

// 中文台词按每秒约 4 个汉字估算，用于判断台词是否会撑爆镜头时长。
function dialogueSeconds(dialogue) {
  const characters = dialogue.reduce((total, item) => total + String(item.line || '').replace(/\s+/g, '').length, 0)
  return Math.ceil(characters / 4)
}

function scriptPrompt(project) {
  const system = `你是资深短剧编剧，负责把故事改编成可以直接拍摄的短剧剧本结构。只输出 JSON，不要任何额外文字。

输出结构：
{"logline":"一句话故事内核","scenes":[{"id":"SCN_01","title":"场次名","location":"具体地点","timeOfDay":"日/夜/黄昏/清晨","summary":"这场发生什么，一到两句","characters":["人物姓名"],"dialogue":[{"speaker":"人物姓名","line":"台词"}],"durationSeconds":45}]}

硬性规则：
1. 场次按故事体量决定，通常 3-8 场；每场 durationSeconds 取 15-90 之间的整数。
2. 台词必须口语化、短句，单句不超过 20 个汉字，方便后续配音对齐时长。没有台词的场次 dialogue 为空数组。
3. 每一场都要写清 location 与 timeOfDay；同一地点在不同场次必须用完全相同的写法。
4. 只做剧本结构，不要写分镜、运镜、画面描述或任何生图提示词。
5. id 从 SCN_01 起递增；全文简体中文；JSON 内不许出现注释。`
  return { system, user: `剧名：${project.title || '未命名'}\n\n故事原文：\n${project.story}` }
}

function charactersPrompt(project) {
  const script = project.script?.scenes || []
  const system = `你是短剧美术指导，负责把剧本里的角色变成可绘制的角色设定。只输出 JSON，不要任何额外文字。

输出结构：
{"characters":[{"id":"CHAR_01","name":"姓名","role":"主角/配角","age":"年龄段","gender":"男/女","identity":"身份职业","appearance":"可绘制的面部与身体特征","wardrobe":"固定基础穿搭","personality":"性格关键词","voice":"配音音色建议","looks":[{"id":"CHAR_01_LOOK_01","name":"造型名","description":"可绘制的服装描述"}]}]}

硬性规则：
1. 只提取剧本中真实出现过的人物，不要新增人物，也不要合并两个人物。
2. appearance 必须写成能画出来的具体信息：脸型、眉形、眼睛、鼻子、唇形、肤色、发长发型发色、身高体型、显著标记。禁止"很美""有气质""普通长相"这类无法绘制的词。
3. wardrobe 与 looks 必须写清版型、材质、主色、鞋履、配饰及其位置，不要只写风格名。
4. 每个角色至少一套造型。剧本里明确换过装（不同日期、天气、剧情阶段）时补第二套，命名依次为 LOOK_01、LOOK_02；换装时面部特征保持不变。
5. id 从 CHAR_01 起递增，looks 的 id 为「角色id_LOOK_01」的形式。
6. 全文简体中文。`
  return { system, user: `剧名：${project.title || '未命名'}\n\n剧本：\n${JSON.stringify(script).slice(0, 12_000)}` }
}

function scenesPrompt(project) {
  const script = project.script?.scenes || []
  const names = (project.characters || []).map((item) => item.name).join('、')
  const system = `你是短剧美术指导，负责把剧本里的地点变成可绘制、可复用的场景设定。只输出 JSON，不要任何额外文字。

输出结构：
{"scenes":[{"id":"SCENE_001","name":"场景名","location":"地点","timeOfDay":"日/夜","architecture":"建筑结构与空间布局","materials":"墙面、地面、门窗材质","furniture":"固定家具及其摆放位置","props":["固定道具及摆放位置"],"lighting":"光源方向、色温、灯位","palette":"整体色调","mood":"气氛关键词"}]}

硬性规则：
1. 一个物理空间只写一条记录：同一个房间的白天和夜晚不要分成两条。
2. 全部字段都写成可以画出来的具体信息，禁止抽象形容。
3. furniture 与 props 必须写明位置关系（靠哪面墙、在画面左/右/前景），后续分镜要靠它保持道具连贯。
4. id 从 SCENE_001 起递增；全文简体中文。`
  return { system, user: `剧本：\n${JSON.stringify(script).slice(0, 12_000)}\n\n主要人物：${names || '未标注'}` }
}

function shotsPrompt(project) {
  const script = project.script?.scenes || []
  const characters = (project.characters || []).map((item) => ({ id: item.id, name: item.name, looks: (item.looks || []).map((look) => look.id) }))
  const scenes = (project.scenes || []).map((item) => ({ id: item.id, name: item.name, timeOfDay: item.timeOfDay }))
  const system = `你是短剧分镜师。请把剧本拆成一组可以直接用于 AI 生图与生视频的镜头。只输出 JSON，不要任何额外文字。

输出结构：
{"shots":[{"id":"SHOT_001","sceneId":"SCENE_001","sceneName":"场景名","timeOfDay":"夜晚 22:30 雨后","characterIds":["CHAR_01"],"lookId":"CHAR_01_LOOK_01","durationSeconds":8,"shotSize":"中景","angle":"低机位侧面","composition":"人物在画面右侧，左侧道路延伸至远处","action":"0-2秒…；2-5秒…；5-8秒…","emotion":"紧张","lighting":"冷色路灯为主光，远处门厅暖光","camera":"缓慢向人物推进，镜头稳定","sound":"轻微雨声、远处车声，无背景音乐","dialogue":[{"speaker":"姓名","line":"台词"}],"continuity":"承接上一镜头：右手持伞、左手提包，站位不变","firstFrame":"首帧定格的完整画面描述，可直接用于生图"}]}

硬性规则：
1. durationSeconds 为 4-15 之间的整数。一个镜头只表现一个主要动作或一次明确的情绪变化；动作多、角度多就拆成多个镜头，不要硬塞进一个 15 秒镜头。
2. 台词按每秒约 4 个汉字估算时长。若某镜台词估算时长超过镜头时长，必须拆镜或压缩台词，禁止单纯把时长加到 15 秒。
3. sceneId 必须取自给定场景列表，characterIds 与 lookId 必须取自给定角色列表，禁止编造。
4. continuity 必须写明与上一镜头的动作、持物、站位、时间如何衔接；第一个镜头写"开场"。
5. action 用「秒数区间＋动作」的形式分段描述，首帧画面单独写在 firstFrame 里。
6. 镜头按剧本顺序排列，id 从 SHOT_001 起递增，总数不超过 ${SHOT_LIMIT} 个。
7. 全文简体中文，不要输出英文提示词。`
  const user = `剧本：\n${JSON.stringify(script).slice(0, 10_000)}\n\n可用场景：\n${JSON.stringify(scenes)}\n\n可用角色与造型：\n${JSON.stringify(characters)}`
  return { system, user }
}

const PROMPT_BUILDERS = { script: scriptPrompt, characters: charactersPrompt, scenes: scenesPrompt, shots: shotsPrompt }

function normalizeScript(project, raw) {
  const scenes = (Array.isArray(raw?.scenes) ? raw.scenes : []).slice(0, SCENE_LIMIT).map((item, index) => ({
    id: `SCN_${String(index + 1).padStart(2, '0')}`,
    title: text(item?.title, 60) || `第 ${index + 1} 场`,
    location: text(item?.location, 80),
    timeOfDay: text(item?.timeOfDay, 20) || '日',
    summary: text(item?.summary, 400),
    characters: (Array.isArray(item?.characters) ? item.characters : []).map((name) => text(name, 40)).filter(Boolean).slice(0, 8),
    dialogue: (Array.isArray(item?.dialogue) ? item.dialogue : []).map((line) => ({ speaker: text(line?.speaker, 40), line: text(line?.line, 200) })).filter((line) => line.line).slice(0, 40),
    durationSeconds: clampNumber(item?.durationSeconds, 15, 90, 30),
  }))
  if (!scenes.length) throw new Error('剧本结构里没有任何场次，请补充故事后重试')
  return { logline: text(raw?.logline, FIELD_LIMITS.logline), scenes }
}

function normalizeCharacters(raw) {
  const characters = (Array.isArray(raw?.characters) ? raw.characters : []).slice(0, CHARACTER_LIMIT).map((item, index) => {
    const id = `CHAR_${String(index + 1).padStart(2, '0')}`
    const looks = (Array.isArray(item?.looks) && item.looks.length ? item.looks : [{ name: '基础造型', description: item?.wardrobe }]).slice(0, 6).map((look, lookIndex) => ({
      id: `${id}_LOOK_${String(lookIndex + 1).padStart(2, '0')}`,
      name: text(look?.name, 40) || `造型 ${lookIndex + 1}`,
      description: text(look?.description, 600),
      url: '',
      status: 'draft',
    }))
    return {
      id,
      name: text(item?.name, 40) || `角色 ${index + 1}`,
      role: text(item?.role, 20) || '配角',
      age: text(item?.age, 20),
      gender: text(item?.gender, 10),
      identity: text(item?.identity, 80),
      appearance: text(item?.appearance, 800),
      wardrobe: text(item?.wardrobe, 400),
      personality: text(item?.personality, 120),
      voice: text(item?.voice, 80),
      faceSheetUrl: '',
      faceSheetStatus: 'draft',
      locked: false,
      looks,
    }
  })
  if (!characters.length) throw new Error('没有识别到角色，请检查剧本内容')
  return characters
}

function normalizeScenes(raw) {
  const scenes = (Array.isArray(raw?.scenes) ? raw.scenes : []).slice(0, SCENE_LIMIT).map((item, index) => ({
    id: `SCENE_${String(index + 1).padStart(3, '0')}`,
    name: text(item?.name, 60) || `场景 ${index + 1}`,
    location: text(item?.location, 80),
    timeOfDay: text(item?.timeOfDay, 20) || '日',
    architecture: text(item?.architecture, 600),
    materials: text(item?.materials, 400),
    furniture: text(item?.furniture, 600),
    props: (Array.isArray(item?.props) ? item.props : []).map((prop) => text(prop, 200)).filter(Boolean).slice(0, 20),
    lighting: text(item?.lighting, 400),
    palette: text(item?.palette, 200),
    mood: text(item?.mood, 120),
    dayUrl: '',
    nightUrl: '',
    dayStatus: 'draft',
    nightStatus: 'draft',
    locked: false,
  }))
  if (!scenes.length) throw new Error('没有识别到场景，请检查剧本内容')
  return scenes
}

function normalizeShotTimes(shot, sceneMap, characterMap) {
  const warnings = []
  const scene = sceneMap.get(shot.sceneId)
  if (!scene) warnings.push('场景引用无效')
  const characterIds = shot.characterIds.filter((id) => characterMap.has(id))
  if (characterIds.length !== shot.characterIds.length) warnings.push('角色引用无效')
  const lookId = shot.lookId && characterIds.includes(shot.lookId.slice(0, 7)) ? shot.lookId : (characterMap.get(characterIds[0])?.looks?.[0]?.id || '')
  const spokenSeconds = dialogueSeconds(shot.dialogue)
  const durationSeconds = Math.max(shot.durationSeconds, Math.min(15, Math.ceil(spokenSeconds / 2) * 2))
  if (spokenSeconds > durationSeconds) warnings.push(`台词约 ${spokenSeconds} 秒，超过镜头时长，建议拆镜`)
  if (durationSeconds < 4) warnings.push('镜头时长过短')
  return { ...shot, characterIds, lookId, durationSeconds, spokenSeconds, warnings, sceneName: scene?.name || shot.sceneName }
}

function normalizeShots(raw, project) {
  const sceneMap = new Map((project.scenes || []).map((item) => [item.id, item]))
  const characterMap = new Map((project.characters || []).map((item) => [item.id, item]))
  const shots = (Array.isArray(raw?.shots) ? raw.shots : []).slice(0, SHOT_LIMIT).map((item, index) => {
    const shot = {
      id: `SHOT_${String(index + 1).padStart(3, '0')}`,
      sceneId: text(item?.sceneId, 20),
      sceneName: text(item?.sceneName, 60),
      timeOfDay: text(item?.timeOfDay, 60),
      characterIds: (Array.isArray(item?.characterIds) ? item.characterIds : []).map((id) => text(id, 20)).filter(Boolean).slice(0, 4),
      lookId: text(item?.lookId, 30),
      durationSeconds: clampNumber(item?.durationSeconds, 4, 15, 8),
      shotSize: text(item?.shotSize, 30),
      angle: text(item?.angle, 40),
      composition: text(item?.composition, 500),
      action: text(item?.action, 800),
      emotion: text(item?.emotion, 60),
      lighting: text(item?.lighting, 300),
      camera: text(item?.camera, 200),
      sound: text(item?.sound, 300),
      dialogue: (Array.isArray(item?.dialogue) ? item.dialogue : []).map((line) => ({ speaker: text(line?.speaker, 40), line: text(line?.line, 200) })).filter((line) => line.line),
      continuity: text(item?.continuity, 400),
      firstFrame: text(item?.firstFrame, 800),
      firstFrameUrl: '',
      firstFrameStatus: 'draft',
      videoUrl: '',
      videoStatus: 'draft',
      locked: false,
    }
    return normalizeShotTimes(shot, sceneMap, characterMap)
  })
  if (!shots.length) throw new Error('没有生成任何镜头，请检查剧本与资产')
  return shots
}

function carryOver(nextItems, previousItems, fields) {
  if (!Array.isArray(previousItems) || !previousItems.length) return nextItems
  const byName = new Map(previousItems.map((item) => [item.name, item]))
  return nextItems.map((item) => {
    const previous = byName.get(item.name)
    if (!previous) return item
    const merged = { ...item }
    for (const field of fields) if (previous[field] !== undefined) merged[field] = previous[field]
    return merged
  })
}

export function installDrama(app, { dataDir, requireAuth, complete }) {
  const file = path.join(dataDir, 'drama-projects.json')
  fs.mkdirSync(dataDir, { recursive: true })
  let projects = []
  if (fs.existsSync(file)) {
    try { projects = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { projects = [] }
  }
  const save = () => {
    fs.writeFileSync(`${file}.next`, JSON.stringify(projects), { mode: 0o600 })
    fs.renameSync(`${file}.next`, file)
  }

  const publicProject = (project) => project
  const findOwned = (req) => projects.find((item) => item.id === req.params.id && item.owner === req.user?.id)

  app.get('/api/drama/projects', requireAuth, (req, res) => {
    const list = projects
      .filter((item) => item.owner === req.user.id)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map(({ id, title, stage, updatedAt, logline, story }) => ({ id, title, stage, updatedAt, logline, storyLength: String(story || '').length }))
    res.set('Cache-Control', 'no-store').json({ projects: list })
  })

  app.post('/api/drama/projects', requireAuth, (req, res) => {
    const now = new Date().toISOString()
    const project = {
      id: randomUUID(),
      owner: req.user.id,
      title: text(req.body?.title, FIELD_LIMITS.title) || '未命名短剧',
      story: text(req.body?.story, STORY_LIMIT),
      logline: '',
      stage: 'story',
      script: { logline: '', scenes: [] },
      characters: [],
      scenes: [],
      shots: [],
      createdAt: now,
      updatedAt: now,
    }
    projects = [project, ...projects].slice(0, 200)
    save()
    res.status(201).json({ project: publicProject(project) })
  })

  app.get('/api/drama/projects/:id', requireAuth, (req, res) => {
    const project = findOwned(req)
    if (!project) return res.status(404).json({ error: '短剧项目不存在或无权访问' })
    res.set('Cache-Control', 'no-store').json({ project: publicProject(project) })
  })

  app.patch('/api/drama/projects/:id', requireAuth, (req, res) => {
    const project = findOwned(req)
    if (!project) return res.status(404).json({ error: '短剧项目不存在或无权访问' })
    const body = req.body || {}
    if (body.title !== undefined) project.title = text(body.title, FIELD_LIMITS.title) || project.title
    if (body.story !== undefined) project.story = text(body.story, STORY_LIMIT)
    if (Array.isArray(body.characters)) project.characters = body.characters.slice(0, CHARACTER_LIMIT)
    if (Array.isArray(body.scenes)) project.scenes = body.scenes.slice(0, SCENE_LIMIT)
    if (Array.isArray(body.shots)) project.shots = body.shots.slice(0, SHOT_LIMIT)
    if (typeof body.stage === 'string' && body.stage) project.stage = body.stage.slice(0, 20)
    project.updatedAt = new Date().toISOString()
    save()
    res.json({ project: publicProject(project) })
  })

  app.delete('/api/drama/projects/:id', requireAuth, (req, res) => {
    const project = findOwned(req)
    if (!project) return res.status(404).json({ error: '短剧项目不存在或无权访问' })
    projects = projects.filter((item) => item.id !== project.id)
    save()
    res.json({ ok: true })
  })

  app.post('/api/drama/projects/:id/plan', requireAuth, async (req, res, next) => {
    const project = findOwned(req)
    if (!project) return res.status(404).json({ error: '短剧项目不存在或无权访问' })
    const stage = String(req.body?.stage || '')
    if (!STAGES.includes(stage)) return res.status(400).json({ error: '不支持的生成阶段' })
    if (stage !== 'script' && !(project.script?.scenes || []).length) return res.status(400).json({ error: '请先生成剧本结构' })
    if (stage === 'shots' && !(project.scenes || []).length) return res.status(400).json({ error: '请先生成场景资产' })
    if (stage === 'characters' && !String(project.story || '').trim() && !(project.script?.scenes || []).length) return res.status(400).json({ error: '请先填写故事原文' })
    try {
      const { system, user } = PROMPT_BUILDERS[stage](project)
      const content = await complete({ system, user, timeoutMs: PLAN_TIMEOUT_MS })
      const raw = jsonFromModel(content)
      if (stage === 'script') {
        project.script = normalizeScript(project, raw)
        project.logline = project.script.logline
        project.characters = []
        project.scenes = []
        project.shots = []
        project.stage = 'script'
      } else if (stage === 'characters') {
        project.characters = carryOver(normalizeCharacters(raw), project.characters, ['faceSheetUrl', 'faceSheetStatus', 'locked', 'looks'])
        project.stage = 'characters'
      } else if (stage === 'scenes') {
        project.scenes = carryOver(normalizeScenes(raw), project.scenes, ['dayUrl', 'nightUrl', 'dayStatus', 'nightStatus', 'locked'])
        project.shots = []
        project.stage = 'scenes'
      } else {
        project.shots = normalizeShots(raw, project)
        project.stage = 'shots'
      }
      project.updatedAt = new Date().toISOString()
      save()
      res.json({ project: publicProject(project) })
    } catch (error) {
      next(error)
    }
  })
}
