import {filmMediaIndex} from '../shared/filmMediaIndex.js';
import {probe} from './filmEditing.js';
import sharp from 'sharp';
import { readFilmProject, clone, applyCommand, pendingCommands, queueFilmCommand } from './filmState.js';
import { filmEvent } from '../shared/filmProgress.js';
import { filmLinkKey, validFilmLink } from "./filmLinks.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
export function installFilms(app, { dataDir, requireAuth, worker = true, prepareContext = async()=>null }) {
  const root = path.join(dataDir, "films");
  fs.mkdirSync(root, { recursive: true });
  const linkKey = filmLinkKey(root);
  app.get("/api/film-assets/:id/:file", (req, res) => {
    const { id, file } = req.params;
    if (
      !validFilmLink(linkKey, id, file, req.query.expires, req.query.signature)
    )
      return res.sendStatus(404);
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(path.resolve(root, id, file));
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
  app.post("/api/films", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (!String(b.story || "").trim() || String(b.story).length > 12000)
      return res.status(400).json({ error: "请填写故事，最多12000字" });
    if (
      !["gpt-image-2.5", "nano-banana-2.1"].includes(b.imageModel) ||
      !["minimax-h3", "wan-3.0"].includes(b.videoModel) ||
      !["16:9", "9:16"].includes(b.ratio) ||
      ![15, 30, 60, 90, 120].includes(Number(b.duration))
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
    const context=await prepareContext(req.user,b);
    const p = {
      context,
      schemaVersion: 2,
      id: requestId,
      userId: req.user.id,
      title: "导演命名中",
      story: b.story,
      settings: { style: String(b.style || "电影写实").slice(0,200), transition:"cut", sourceVolume:1, subtitles:true },
      resources: [], tasks: [], appliedCommands: [],
      ratio: b.ratio,
      duration: Number(b.duration),
      imageModel: b.imageModel,
      videoModel: b.videoModel,
      status: "queued",
      stage: "plan",
      createdAt: Date.now(),
      attempts: 0,
      shots: [],
      assets: [],
      automatic: b.automatic !== false,
    };
    filmEvent(p, "created", "已接收故事，等待 AI 导演开始统筹制作");
    write(p);
    res.status(202).json({ project: p });
  });
  app.get("/api/films/:id", requireAuth, (req, res) => {
    const p = owned(req, res);
    if (p) res.json({ project: {...p, pendingChanges:pendingCommands(root,p).map(c=>({id:c.id,type:c.type,target:c.body?.id}))} });
  });
  app.get('/api/films/:id/media',requireAuth,(req,res)=>{const p=owned(req,res);if(p)res.json({media:filmMediaIndex(p,req.query.history==='1')});});
  const commandRoute = (fn) => async (req,res,next) => { try { await fn(req,res); } catch(e) { if(e.status) return res.status(e.status).json({error:e.message}); if(/锁定|不存在|无效|未知|上限|先解锁/.test(e.message)) return res.status(400).json({error:e.message}); next(e); } };
  const validateCommand = (p,type,body) => {
    const projected=clone(p);for(const command of pendingCommands(root,p))applyCommand(projected,command);p=projected;
    const allowed=['pause','resume','lock','task-pause','keep','edit','regenerate','restore','script','script-lock','revise','settings','timeline','upload','add-outfit','stage-pause'];
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
  app.post('/api/films/:id/commands',requireAuth,commandRoute((req,res)=>{
    const p=owned(req,res);if(!p)return;
    const {type,body={}}=req.body;if(JSON.stringify(body).length>120000)throw Error('操作内容超过上限');validateCommand(p,type,body);
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
    if (!["failed", "review", "cancelled", "succeeded"].includes(p.status))
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
    p.status = "review";
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
