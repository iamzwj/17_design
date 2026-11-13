import { filmVideoResolution, filmVideoResolutions } from '../shared/filmVideoModels.js';
import { VIBBIT_FLARE_MODEL } from '../shared/vibbitImageModels.js';
import { filmNarrativePreset } from '../shared/filmNarrativePresets.js';
import { filmReviewFingerprint } from '../shared/filmReviewWarnings.js';
import { IP_ASSETS } from "../shared/materialCatalog.js";
import { fileURLToPath } from "node:url";
import {filmMediaIndex} from '../shared/filmMediaIndex.js';
import {probe} from './filmEditing.js';
import sharp from 'sharp';
import { readFilmProject, clone, applyCommand, pendingCommands, queueFilmCommand } from './filmState.js';
import { filmEvent } from '../shared/filmProgress.js';
import { filmLinkKey, validFilmLink, filmAssetLink } from "./filmLinks.js";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
export function installFilms(app, { dataDir, requireAuth, worker = true, prepareContext = async()=>null, analyzeStory }) {
  const root = path.join(dataDir, "films");
  fs.mkdirSync(root, { recursive: true });
  const archivesDir = path.join(dataDir, 'conversation-archives');
  fs.mkdirSync(archivesDir, { recursive: true });
  const archiveFile = (req) => path.join(archivesDir, createHash('sha256').update(String(req.user.id)).digest('hex') + '.json');
  const readArchives = (req) => { try { const data = JSON.parse(fs.readFileSync(archiveFile(req), 'utf8')); return Array.isArray(data) ? data : []; } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
  app.get('/api/films/archive-records', requireAuth, (req, res) => res.json({ records: readArchives(req) }));
  app.post('/api/films/archive-records', requireAuth, (req, res) => {
    const { record, id, restore } = req.body || {};
    if (typeof id !== 'string' || !id || id.length > 200 || (restore !== true && (!record || record.id !== id || record.type === 'film'))) return res.status(400).json({ error: '归档数据无效' });
    const records = readArchives(req).filter(item => item.id !== id);
    if (!restore) records.push({ ...record, archived: true, pinned: false, pinnedAt: null });
    else if (record && record.id === id) records.push({ ...record, archived: false });
    const file = archiveFile(req), temp = file + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(records), { mode: 0o600 }); fs.renameSync(temp, file);
    res.json({ ok: true });
  });
  const linkKey = filmLinkKey(root);
  app.get("/api/film-assets/:id/:file", async (req, res, next) => {
    const { id, file } = req.params;
    if (
      !validFilmLink(linkKey, id, file, req.query.expires, req.query.signature)
    )
      return res.sendStatus(404);
    res.setHeader("Cache-Control", "private, no-store");
    const source = path.resolve(root, id, file);
    if (req.query.preview !== '1' || !/\.(png|jpg)$/.test(file)) {
      return res.sendFile(source);
    }
    try {
      const metadata = await fs.promises.stat(source);
      const previewDir = path.join(root, id, '.media-previews');
      await fs.promises.mkdir(previewDir, { recursive: true });
      const preview = path.join(previewDir, `${file}-${metadata.size}-${metadata.mtimeMs}.webp`);
      if (!fs.existsSync(preview)) {
        const temporary = preview + '.' + randomUUID() + '.tmp';
        try {
          await sharp(source).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 }).toFile(temporary);
          await fs.promises.rename(temporary, preview);
        } finally {
          await fs.promises.rm(temporary, { force: true });
        }
      }
      res.type('webp').sendFile(preview, { dotfiles: 'allow' });
    } catch (error) {
      next(error);
    }
  });
  const read = (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    try {
      return readFilmProject(root,id);
    } catch {
      return null;
    }
  };
  const write = (p) => {
    fs.mkdirSync(path.join(root, p.id), { recursive: true });
    const f = path.join(root, p.id, "project.json");
    fs.writeFileSync(f + ".next", JSON.stringify(p));
    fs.renameSync(f + ".next", f);
  };
  const owned = (req, res) => {
    const p = read(req.params.id);
    if (!p || p.userId !== req.user.id) {
      res.status(404).json({ error: "项目不存在或无权访问" });
      return null;
    }
    return p;
  };
  app.get("/api/films", requireAuth, (req, res) =>
    res.json({
      projects: fs
        .readdirSync(root)
        .map(read)
        .filter((p) => p?.userId === req.user.id)
        .sort((a, b) => b.createdAt - a.createdAt),
    }),
  );
  app.post("/api/films/analyze", requireAuth, async (req, res, next) => {
    try {
      const story = String(req.body?.story || '').trim();
      if (!story || story.length > 12000) return res.status(400).json({ error: '请填写故事，最多12000字' });
      if (!analyzeStory) return res.status(503).json({ error: '时长分析暂不可用' });
      res.json(await analyzeStory(story));
    } catch (error) { next(error); }
  });
  app.post("/api/films", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (!String(b.story || "").trim() || String(b.story).length > 12000)
      return res.status(400).json({ error: "请填写故事，最多12000字" });
    if (
      !["gpt-image-2.5", "nano-banana-2.1", VIBBIT_FLARE_MODEL].includes(b.imageModel) ||
      !filmVideoResolutions(b.videoModel).length ||
      (b.videoResolution != null && !filmVideoResolutions(b.videoModel).includes(b.videoResolution)) ||
      !["16:9", "9:16"].includes(b.ratio) ||
      (b.duration != null && (!Number.isInteger(Number(b.duration)) || Number(b.duration) < 15 || Number(b.duration) > 600))
    )
      return res.status(400).json({ error: "制作参数无效" });
    const requestId = /^[a-f0-9-]{36}$/.test(b.requestId || "")
      ? b.requestId
      : randomUUID();
    const previous = read(requestId);
    if (previous) {
      if (previous.userId !== req.user.id) return res.sendStatus(409);
      return res.json({ project: previous });
    }
    if (
      fs
        .readdirSync(root)
        .map(read)
        .filter(
          (x) =>
            x?.userId === req.user.id &&
            ["queued", "running"].includes(x.status),
        ).length >= 2
    )
      return res
        .status(409)
        .json({ error: "已有两个项目在制作，请稍后再创建" });
    const narrative = filmNarrativePreset(b.narrativeStyleId);
    if (b.narrativeStyleId && !narrative) {
      return res.status(400).json({ error: "不支持的叙事风格" });
    }
    const context=await prepareContext(req.user,b);
    const p = {
      context: narrative ? { ...context, narrative } : context,
      schemaVersion: 2,
      id: requestId,
      userId: req.user.id,
      title: "导演命名中",
      story: b.story,
      settings: { style: String(b.style ?? "电影写实").slice(0,200), transition:"cut", sourceVolume:1, subtitles:true },
      resources: [], tasks: [], appliedCommands: [],
      ratio: b.ratio,
      duration: b.duration == null ? null : Number(b.duration),
      autoDuration: b.duration == null,
      imageModel: b.imageModel,
      videoModel: b.videoModel,
      ...(b.videoResolution ? { videoResolution: filmVideoResolution(b.videoModel, b.videoResolution) } : {}),
      status: "queued",
      stage: "plan",
      createdAt: Date.now(),
      attempts: 0,
      shots: [],
      assets: [],
      automatic: true,
      referenceWorkflow: true,
      editorialWorkflow: true,
    };
    filmEvent(p, "created", "已接收故事，等待 AI 导演开始统筹制作");
    write(p);
    res.status(202).json({ project: p });
  });
  const brandIPs = IP_ASSETS.filter((asset) => asset.file)
    .map(({ id, name, file }) => ({ id, name, file, source: "brand" }));
  const brandPath = (asset) => fileURLToPath(new URL("../public" + asset.file, import.meta.url));
  const library = (req) => path.join(root, "characters", createHash("sha256").update(String(req.user.id)).digest("hex"));
  const readCharacter = (req, id) => {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(library(req), id + ".json")));
    } catch {
      return null;
    }
  };
  async function uploadedImage(data) {
    if (typeof data !== "string" || data.length > 14_000_000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data))
      throw Error("图片格式无效，请上传 10 MB 以内的 PNG、JPEG 或 WebP");
    try {
      return await sharp(Buffer.from(data.split(",")[1], "base64"), { limitInputPixels: 40_000_000 })
        .rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    } catch {
      throw Error("图片无效或无法解码");
    }
  }
  app.get("/api/films/characters", requireAuth, (req, res) => {
    const dir = library(req);
    const ids = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    res.json({
      characters: ids.filter((name) => name.endsWith(".json"))
        .map((name) => readCharacter(req, name.slice(0, -5))).filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt),
      brandIPs: brandIPs.filter((asset) => fs.existsSync(brandPath(asset))),
    });
  });
  app.get("/api/films/characters/:characterId/image", requireAuth, (req, res) => {
    const entry = readCharacter(req, req.params.characterId);
    if (!entry) return res.sendStatus(404);
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(path.resolve(library(req), entry.id + ".png"));
  });
  app.get("/api/films/history", requireAuth, (req, res) => {
    const projects = fs.readdirSync(root).map(read)
      .filter((project) => project?.userId === req.user.id)
      .map(({ id, title, createdAt, plan, directorPlan, script, status }) => ({
        id, title, createdAt, status, archived: fs.existsSync(path.join(root, id, 'archived')), named: Boolean(plan || directorPlan || script),
      }));
    res.json({ projects });
  });
  app.post('/api/films/:id/archive', requireAuth, (req, res) => {
    const p = owned(req, res); if (!p) return;
    const marker = path.join(root, p.id, 'archived');
    if (req.body?.archived === true) {
      fs.writeFileSync(marker, '1', { mode: 0o600 });
      queueFilmCommand(root, p.id, 'pause');
    } else if (req.body?.archived === false) {
      try { fs.unlinkSync(marker); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    } else return res.status(400).json({ error: '归档状态无效' });
    res.json({ archived: req.body.archived });
  });
  app.get("/api/films/:id", requireAuth, (req, res) => {
    const p = owned(req, res);
    if (p) {
      let reviewDismissed = null;
      try { reviewDismissed = fs.readFileSync(path.join(root, p.id, 'review-dismissed.json'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      res.json({ project: {...p, reviewDismissed, pendingChanges:pendingCommands(root,p).map(c=>({id:c.id,type:c.type,target:c.body?.id}))} });
    }
  });
  app.post('/api/films/:id/review-dismissal', requireAuth, (req, res) => {
    const p = owned(req, res); if (!p) return;
    const fingerprint = filmReviewFingerprint(p);
    if (!p.reviewWarning || req.body?.fingerprint !== fingerprint) return res.status(409).json({ error: '审核结果已更新，请重新查看' });
    fs.writeFileSync(path.join(root, p.id, 'review-dismissed.json'), fingerprint);
    res.json({ reviewDismissed: fingerprint });
  });
  app.get('/api/films/:id/media',requireAuth,(req,res)=>{const p=owned(req,res);if(p)res.json({media:filmMediaIndex(p,req.query.history==='1')});});
  const commandRoute = (fn) => async (req,res,next) => { try { await fn(req,res); } catch(e) { if(e.status) return res.status(e.status).json({error:e.message}); if(/锁定|不存在|无效|未知|上限|先解锁|重试|版本已更新|暂时无法重做|没有可替换/.test(e.message)) return res.status(400).json({error:e.message}); next(e); } };
  const validateCommand = (p,type,body) => {
    const projected=clone(p);for(const command of pendingCommands(root,p))applyCommand(projected,command);p=projected;
    const allowed=['character-mode','character-reference','pause','resume','lock','task-pause','keep','edit','regenerate','redo-media','export-replacement','retry-shot','restore','script','script-lock','revise','settings','timeline','upload','add-outfit','stage-pause'];
    if(type==='character-reference' && !body.file?.startsWith('asset-character-'))throw Error('角色参考无效');
    if(!allowed.includes(type))throw Error('未知操作');
    if(body.patch?.duration!==undefined && (!Number.isFinite(body.patch.duration)||body.patch.duration<1||body.patch.duration>10))throw Error('镜头时长必须在1至10秒，复杂镜头请拆分');
    if(body.patch?.prompt && (typeof body.patch.prompt!=='string'||body.patch.prompt.length>6000))throw Error('提示词无效');
    if(type==='stage-pause'&&!['script','characters','scenes','storyboard','images','videos','audio','editing'].includes(body.stage))throw Error('阶段无效');
    if(type==='revise' && (typeof body.text!=='string'||!body.text.trim()||body.text.length>2000))throw Error('修改要求无效');
    if(type==='script' && (!body.script || typeof body.script!=='object' || JSON.stringify(body.script).length>50000))throw Error('剧本无效');
    if(type==='settings' && ((!['cut','fade'].includes(body.settings?.transition||p.settings.transition))||!Number.isFinite(Number(body.settings?.sourceVolume??p.settings.sourceVolume))||Number(body.settings?.sourceVolume??p.settings.sourceVolume)<0||Number(body.settings?.sourceVolume??p.settings.sourceVolume)>2))throw Error('项目设置无效');
    if(type==='timeline') {
      const tl=body.timeline;
      if(!tl || !Array.isArray(tl.clips) || !tl.clips.length || tl.clips.length>80 || !Array.isArray(tl.tracks)||tl.tracks.length>12 || !Array.isArray(tl.captions)||tl.captions.length>300)throw Error('时间线无效');
      for(const c of tl.clips) if(!p.shots.some(s=>s.id===c.shotId)||!Number.isFinite(c.duration)||c.duration<0.2||c.duration>15||!Number.isFinite(c.trimIn)||c.trimIn<0||c.trimIn>120)throw Error('片段参数无效');
      for(const t of tl.tracks) if(!p.uploads?.some(u=>u.file===t.file && u.kind==='audio')||![t.start,t.volume].every(Number.isFinite)||t.start<0||t.start>600||t.volume<0||t.volume>2)throw Error('音轨无效');
      for(const c of tl.captions)if(typeof c.text!=='string'||c.text.length>500||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end>600)throw Error('字幕参数无效');
    }
    if(type==='edit' && body.patch?.resourceIds && (!Array.isArray(body.patch.resourceIds)||body.patch.resourceIds.some(id=>!p.resources.some(r=>r.id===id))))throw Error('参考素材无效');
    const preview=clone(p);for(const c of pendingCommands(root,p))applyCommand(preview,c);
    if(type==='upload' && !preview.uploads?.some(u=>u.file===body.file && u.kind===(preview.shots.some(s=>s.id===body.id)?'video':'image')))throw Error('上传成果不存在或类型无效');
    if(type==='script' && (!Array.isArray(body.script.scenes)||!body.script.scenes.length||body.script.scenes.some(s=>!s.id||!s.time||!s.action)))throw Error('剧本场次无效');
    applyCommand(preview,{id:randomUUID(),type,body});
  };
  app.post("/api/films/characters", requireAuth, commandRoute(async (req, res) => {
    let name = String(req.body.name || "").trim().slice(0, 100);
    let bytes;
    let id = randomUUID();
    if (req.body.projectId) {
      const project = read(req.body.projectId);
      const asset = project?.resources?.find((item) => item.id === req.body.assetId);
      const file = (asset?.output || asset?.image)?.file;
      if (project?.userId !== req.user.id || asset?.type !== "face" ||
          !/^asset-[a-zA-Z0-9_-]+\.png$/.test(file || ""))
        return res.status(404).json({ error: "角色图片不可用" });
      const dir = library(req);
      const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      const source = project.id + "/" + file;
      const existing = entries.filter((entry) => entry.endsWith(".json"))
        .map((entry) => readCharacter(req, entry.slice(0, -5))).find((entry) => entry?.origin === source);
      if (existing) return res.json({ character: existing });
      bytes = fs.readFileSync(path.join(root, project.id, file));
      name = project.characters?.find((c) => c.id === asset.sourceId)?.name || asset.name;
      const character = saveCharacter(req, { id, name, origin: source }, bytes);
      return res.json({ character });
    }
    bytes = await uploadedImage(req.body.image);
    res.json({ character: saveCharacter(req, { id, name }, bytes) });
  }));
  function saveCharacter(req, { id, name, origin }, bytes) {
    const character = { id, name: name || "未命名角色", origin, createdAt: Date.now() };
    const dir = library(req);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id + ".png"), bytes);
    fs.writeFileSync(path.join(dir, id + ".json"), JSON.stringify(character));
    return character;
  }
  app.post("/api/films/:id/character-reference", requireAuth, commandRoute(async (req, res) => {
    const { id, characterId, source, image } = req.body;
    let bytes;
    let name;
    if (image) {
      bytes = await uploadedImage(image);
      name = "上传图片";
    } else if (source === "brand") {
      const entry = brandIPs.find((item) => item.id === characterId);
      if (entry && fs.existsSync(brandPath(entry))) bytes = fs.readFileSync(brandPath(entry));
      name = entry?.name;
    } else {
      const entry = readCharacter(req, characterId);
      if (entry) bytes = fs.readFileSync(path.join(library(req), entry.id + ".png"));
      name = entry?.name;
    }
    const p = owned(req, res);
    if (!p) return;
    if (!bytes) return res.status(404).json({ error: "角色图片不可用" });
    const file = "asset-character-" + randomUUID() + ".png";
    const body = { id, file, name };
    validateCommand(p, "character-reference", body);
    fs.writeFileSync(path.join(root, p.id, file), bytes);
    const cmd = queueFilmCommand(root, p.id, "character-reference", body);
    res.status(202).json({ commandId: cmd.id });
  }));
  app.post('/api/films/:id/commands',requireAuth,commandRoute((req,res)=>{
    const p=owned(req,res);if(!p)return;
    const {type,body={}}=req.body;if(type==="character-reference")throw Error("请使用角色图片入口");if(JSON.stringify(body).length>120000)throw Error('操作内容超过上限');validateCommand(p,type,body);
    const cmd=queueFilmCommand(root,p.id,type,body);
    res.status(202).json({project:{...p,pendingChanges:[{id:cmd.id,type,target:body.id}]},commandId:cmd.id});
  }));
  app.post('/api/films/:id/upload',requireAuth,commandRoute(async(req,res)=>{
    const p=owned(req,res);if(!p)return;
    const {kind,data,name}=req.body;
    if(!['image','video','audio'].includes(kind)||typeof data!=='string'||data.length>34e6)throw Error('上传内容无效或超过25MB');
    const bytes=Buffer.from(data.replace(/^data:[^,]+,/,''),'base64');
    if(!bytes.length||bytes.length>25*1024*1024)throw Error('上传文件上限25MB');
    if((p.uploads?.length||0)+pendingCommands(root,p).filter(c=>c.type==='inventory').length>=80)throw Error('每个项目上传文件上限80个');
    const id=randomUUID();let file;
    if(kind==='image') {file=`asset-upload-${id}.png`;await sharp(bytes,{limitInputPixels:25000000}).rotate().png().toFile(path.join(root,p.id,file));}
    else {const ext=kind==='video'?'mp4':/\.(wav|mp3|m4a|aac|ogg)$/i.exec(name||'')?.[1]?.toLowerCase();if(!ext)throw Error('音频格式无效');file=`upload-${id}.${ext}`;fs.writeFileSync(path.join(root,p.id,file),bytes);try{const meta=await probe(path.join(root,p.id,file));if(!meta.streams.some(s=>s.codec_type===kind))throw Error('类型不符');}catch{fs.rmSync(path.join(root,p.id,file),{force:true});throw Error('上传媒体文件无法解码或类型无效');}}
    // Upload inventory is a command too: only the worker writes project snapshots.
    queueFilmCommand(root,p.id,'inventory',{file,kind,name:String(name||file).slice(0,150)});
    res.status(201).json({file,kind});
  }));
  app.post("/api/films/:id/resume", requireAuth, (req, res) => {
    const p = owned(req, res);
    if (!p) return;
    if (!["failed", "review", "needs-input", "cancelled", "succeeded"].includes(p.status))
      return res.status(409).json({ error: "项目正在制作中" });
    if (req.body.shots) {
      if (
        !Array.isArray(req.body.shots) ||
        req.body.shots.length !== p.shots.length
      )
        return res.status(400).json({ error: "镜头数量无效" });
      for (let i = 0; i < p.shots.length; i++) {
        const s = req.body.shots[i];
        if (typeof s.prompt !== "string" || s.prompt.length > 6000)
          return res.status(400).json({ error: "镜头提示词无效" });
        if (s.prompt !== p.shots[i].prompt)
          p.shots[i] = {
            ...p.shots[i],
            revision:(p.shots[i].revision||1)+1,
            prompt: s.prompt,
            frame: null,
            video: null,
            frameTask: null,
            videoTask: null,
            frameAttempts: 0,
            videoAttempts: 0,
            frameSubmitting: false,
            videoSubmitting: false,
          };
      }
    }
    if (Number.isInteger(req.body.redo) && p.shots[req.body.redo]) {
      p.shots[req.body.redo].revision=(p.shots[req.body.redo].revision||1)+1;
      p.shots[req.body.redo].video = null;
      p.shots[req.body.redo].videoTask = null;
      p.shots[req.body.redo].videoAttempts = 0;
      p.shots[req.body.redo].videoError = null;
      p.shots[req.body.redo].videoSubmitting = false;
    }
    p.output = null;
    p.error = null;
    p.automatic = true;
    p.activity = null;
    p.status = "queued";
    filmEvent(p, `resume:${Date.now()}`, "已安排继续成片制作，复用已完成的素材与镜头");
    fs.rmSync(path.join(root, p.id, "cancel"), { force: true });
    write(p);
    res.json({ project: p });
  });
  app.post("/api/films/:id/revise", requireAuth, (req, res) => {
    const p = owned(req, res);
    if (!p) return;
    if (
      !["failed", "review", "succeeded", "cancelled"].includes(p.status) ||
      !p.plan
    )
      return res.status(409).json({ error: "请等待分镜完成或暂停后再修改" });
    const text = String(req.body.change || "").trim();
    if (!text || text.length > 2000)
      return res.status(400).json({ error: "请填写修改要求，最多2000字" });
    p.revision = text;
    p.activity = null;
    filmEvent(p, `request:${Date.now()}`, "已收到修改要求，导演将调整受影响镜头");
    p.status = "queued";
    p.error = null;
    fs.rmSync(path.join(root, p.id, "cancel"), { force: true });
    write(p);
    res.json({ project: p });
  });
  app.post("/api/films/:id/assets/:assetId", requireAuth, (req, res) => {
    const p = owned(req, res);
    if (!p) return;
    if (["queued", "running"].includes(p.status))
      return res
        .status(409)
        .json({ error: "请等待当前制作完成或暂停后再修改" });
    const asset = p.assets.find((a) => a.id === req.params.assetId),
      prompt = String(req.body.prompt || "").trim();
    if (!asset || !prompt || prompt.length > 6000)
      return res.status(400).json({ error: "素材设定无效" });
    Object.assign(asset, {
      prompt,
      image: null,
      imageTask: null,
      imageAttempts: 0,
      imageSubmitting: false,
    });
    for (const shot of p.shots.filter((s) => s.assetIds.includes(asset.id)))
      Object.assign(shot, {
        frame: null,
        video: null,
        frameTask: null,
        videoTask: null,
        frameAttempts: 0,
        videoAttempts: 0,
        frameSubmitting: false,
        videoSubmitting: false,
        review: null,
      });
    p.status = "queued";
    p.stage = "assets";
    p.output = null;
    p.error = null;
    write(p);
    res.json({ project: p });
  });
  app.post("/api/films/:id/cancel", requireAuth, (req, res) => {
    const p = owned(req, res);
    if (!p) return;
    fs.writeFileSync(path.join(root, p.id, "cancel"), "1");
    res.json({ ok: true });
  });
  // The native player can seek without first downloading a complete video Blob.
  app.get('/api/films/:id/media/:file', requireAuth, (req, res) => {
    const project = owned(req, res);
    if (!project) return;
    const file = req.params.file;
    if (!/^[a-zA-Z0-9_-]+\.(png|jpg|mp4|wav|mp3|m4a|aac|ogg)$/.test(file) ||
        !fs.existsSync(path.join(root, project.id, file))) return res.sendStatus(404);
    const link = filmAssetLink(root, project.id, file, '');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ url: /\.(png|jpg)$/.test(file) ? link + '&preview=1' : link });
  });
  app.get("/api/films/:id/files/:file", requireAuth, (req, res) => {
    const p = owned(req, res);
    if (!p) return;
    const file = req.params.file;
    if (!/^[a-zA-Z0-9_-]+\.(png|jpg|mp4|srt|json|wav|mp3|m4a|aac|ogg)$/.test(file))
      return res.sendStatus(404);
    res.sendFile(path.resolve(root, p.id, file));
  });
  if (worker) {
    let child;
    let stopping = false;
    const launch = () => {
      child = fork(new URL("./filmWorker.js", import.meta.url), [], {
        env: { ...process.env, FILM_ROOT: root },
        stdio: "inherit",
      });
      child.on("exit", (code) => {
        if (!stopping) {
          console.error("Film worker stopped, restarting:", code);
          setTimeout(launch, 3000).unref();
        }
      });
    };
    process.once("exit", () => { stopping = true; child?.kill(); });
    launch();
  }
  return { root, read, write };
}
