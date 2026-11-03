import { filmLinkKey, validFilmLink } from "./filmLinks.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
export function installFilms(app, { dataDir, requireAuth, worker = true }) {
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
      return JSON.parse(fs.readFileSync(path.join(root, id, "project.json")));
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
  app.post("/api/films", requireAuth, (req, res) => {
    const b = req.body || {};
    if (!String(b.story || "").trim() || String(b.story).length > 12000)
      return res.status(400).json({ error: "请填写故事，最多12000字" });
    if (
      !["gpt-image-2.5", "nano-banana-2.1"].includes(b.imageModel) ||
      !["minimax-h3", "wan-3.0"].includes(b.videoModel) ||
      !["16:9", "9:16"].includes(b.ratio) ||
      ![15, 30, 60].includes(Number(b.duration))
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
    const p = {
      id: requestId,
      userId: req.user.id,
      title: String(b.story).slice(0, 22),
      story: b.story,
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
    write(p);
    res.status(202).json({ project: p });
  });
  app.get("/api/films/:id", requireAuth, (req, res) => {
    const p = owned(req, res);
    if (p) res.json({ project: p });
  });
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
      p.shots[req.body.redo].video = null;
      p.shots[req.body.redo].videoTask = null;
      p.shots[req.body.redo].videoAttempts = 0;
      p.shots[req.body.redo].videoSubmitting = false;
    }
    p.output = null;
    p.error = null;
    p.status = "queued";
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
    if (!/^[a-zA-Z0-9_-]+\.(png|mp4|srt|json)$/.test(file))
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
