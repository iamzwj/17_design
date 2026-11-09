import { filmProgress } from '../shared/filmProgress.js';
import { filmAssetLink } from "../server/filmLinks.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { fork, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { installFilms } from "../server/films.js";
test("film project survives worker restart, renders MP4, and remakes only selected shots", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "film-test-")),
    clip = path.join(dir, "fixture.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=purple:s=320x180:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    clip,
  ]);
  const png = await sharp({
    create: { width: 320, height: 180, channels: 3, background: "purple" },
  })
    .png()
    .toBuffer();
  let imageCalls = 0,
    videoCalls = 0;
  let imageInFlight=0, videoInFlight=0, imagePeak=0, videoPeak=0;
  let holdResults=false;
  const kinds = new Map();
  let origin;
  const upstream = http.createServer(async (req, res) => {
    if (req.url === "/image.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(png);
      return;
    }
    if (req.url === "/video.mp4") {
      res.end(fs.readFileSync(clip));
      return;
    }
    let raw = "";
    for await (const c of req) raw += c;
    const b = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    let d;
    if (req.url.includes("generateContent")) {
      d = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    status: "pass",
                    summary: "测试参考一致",
                  }),
                },
              ],
            },
          },
        ],
      };
    } else if (req.url === "/v1/chat/completions") {
      const revision = b.messages[0].content.includes("JSON数组");
      d = {
        choices: [
          {
            message: {
              content: JSON.stringify(
                revision
                  ? [
                      {
                        id: "s1",
                        prompt: "夜晚场景人物微笑",
                        dialogue: "欢迎回家",
                      },
                    ]
                  : {
                      title: "验收短片",
                      summary: "测试故事",
                      assets: [{ id: "a1", name: "角色", prompt: "人物" }],
                      shots: Array.from({ length: b.messages[1].content.includes("十镜头测试") ? 10 : 3 }, (_, i) => i + 1).map((i) => ({
                        id: "s" + i,
                        duration: b.messages[1].content.includes("十镜头测试") ? 6 : 5,
                        assetIds: ["a1"],
                        prompt: "白天人物走向花园",
                        dialogue: i === 1 ? "欢迎回家" : "",
                      })),
                    },
              ),
            },
          },
        ],
      };
    } else if (req.url === "/v1/api/generate") {
      const id = randomUUID();
      const image =
        b.model.startsWith("gpt-image") || b.model.startsWith("nano-");
      kinds.set(id, image);
      if (image) imageCalls++;
      else videoCalls++;
      if (image) { imageInFlight++; imagePeak=Math.max(imagePeak,imageInFlight); }
      else { videoInFlight++; videoPeak=Math.max(videoPeak,videoInFlight); }
      await new Promise(r=>setTimeout(r,80));
      if (image) imageInFlight--; else videoInFlight--;
      d = { id, status: "running" };
    } else {
      const id = new URL(req.url, origin).searchParams.get("id");
      d = {
        id,
        status: holdResults ? "running" : "succeeded",
        results: [
          { url: origin + (kinds.get(id) ? "/image.png" : "/video.mp4") },
        ],
      };
    }
    res.end(JSON.stringify(d));
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + upstream.address().port;
  const app = express();
  app.use(express.json());
  const film = installFilms(app, {
    dataDir: dir,
    worker: false,
    requireAuth: (req, res, next) => {
      req.user = { id: req.headers["x-user"] || "alice" };
      next();
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  let child;
  const start = () => {
    child = fork(new URL("../server/filmWorker.js", import.meta.url), [], {
      env: {
        ...process.env,
        FILM_ROOT: film.root,
        GRSAI_BASE_URL: origin,
        GRSAI_API_KEY: "test",
      },
      stdio: "ignore",
    });
  };
  const stop = async () => {
    child.kill();
    await new Promise((r) => child.once("exit", r));
  };
  const api = async (url, b, user = "alice") => {
    const r = await fetch(base + "/api/films" + url, {
      method: b ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-user": user },
      ...(b ? { body: JSON.stringify(b) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  let id;
  async function until(status) {
    for (let i = 0; i < 600; i++) {
      const p = (await api("/" + id)).data.project;
      if (p.status === "failed") throw Error(p.error);
      if (p.status === status) return p;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("timeout");
  }
  try {
    start();
    const input = {
      requestId: randomUUID(),
      story: "测试短片",
      imageModel: "gpt-image-2.5",
      videoModel: "minimax-h3",
      ratio: "16:9",
      duration: 15,
      automatic: false,
    };
    holdResults = true;
    const created = await api("", input);
    id = created.data.project.id;
    const legacy=film.read(id);legacy.schemaVersion=1;film.write(legacy);
    assert.equal(created.status, 202);
    assert.equal((await api("", input)).data.project.id, id);
    assert.equal((await api("/" + id, undefined, "bob")).status, 404);
    assert.equal(created.data.project.automatic, true);
    for (let i=0;i<100;i++) {
      const inFlight=(await api("/" + id)).data.project;
      if (inFlight.assets[0]?.imageTask) break;
      await new Promise(r=>setTimeout(r,50));
    }
    assert.equal(imageCalls,1);
    assert.ok((await api("/" + id)).data.project.assets[0].imageTask);
    await stop(); holdResults=false; start();
    const done = await until("succeeded");
    const signed = filmAssetLink(
      film.root,
      id,
      done.assets[0].image.file,
      base,
    );
    const assetResponse = await fetch(signed);
    assert.equal(assetResponse.status, 200);
    assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), png);
    assert.equal(
      (await fetch(signed.replace(/signature=[a-f0-9]+/, "signature=invalid")))
        .status,
      404,
    );
    assert.equal(
      (await fetch(signed.replace(/expires=\d+/, "expires=1"))).status,
      404,
    );
    assert.equal((await fetch(signed.split("?")[0])).status, 404);
    assert.equal(imageCalls, 4);
    assert.equal(videoCalls, 3);
    assert.equal(filmProgress(done).completed, 6);
    assert.ok(done.tasks.some(t => t.kind === "frame" && t.status === "succeeded"));
    assert.ok(done.events.some(e => e.key.startsWith("output:")));
    assert.ok(done.activity.startedAt);
    const meta = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_format",
          "-of",
          "json",
          path.join(film.root, id, done.output),
        ],
        { encoding: "utf8" },
      ),
    );
    assert.ok(Math.abs(Number(meta.format.duration) - 15) < 0.2);
    assert.ok(
      fs
        .readFileSync(path.join(film.root, id, "subtitles.srt"), "utf8")
        .includes("欢迎回家"),
    );
    await api("/" + id + "/resume", { redo: 1 });
    await until("succeeded");
    assert.equal(videoCalls, 4);
    assert.equal(imageCalls, 4);
    await api("/" + id + "/revise", { change: "修改第一个镜头" });
    await until("succeeded");
    assert.equal(videoCalls, 5);
    assert.equal(imageCalls, 5);
    const edited = await api("/" + id + "/assets/" + done.assets[0].id, { prompt: "更新角色衣着" });
    assert.equal(edited.data.project.status, "queued");
    assert.equal(edited.data.project.assets[0].image, null);
    assert.ok(edited.data.project.shots.filter(s => s.assetIds.includes(done.assets[0].id)).every(s => !s.frame && !s.video));
    assert.equal(videoCalls, 5);
    assert.equal(imageCalls, 5);

    // Default one-click creation must finish without a resume request.
    const automatic = await api("", { ...input, requestId: randomUUID(), automatic: true, duration: 60, story: "十镜头测试" });
    id = automatic.data.project.id;
    const legacyAuto=film.read(id);legacyAuto.schemaVersion=1;film.write(legacyAuto);
    const autoDone = await until("succeeded");
    assert.ok(autoDone.output);
    assert.equal(imagePeak, 5);
    assert.equal(videoPeak, 10);
    assert.equal(filmProgress(autoDone).completed, 6);
    assert.equal((await fetch(base + "/api/films/" + id + "/files/" + autoDone.output)).status, 200);

  } finally {
    if (child && !child.killed) await stop();
    await new Promise((r) => server.close(r));
    await new Promise((r) => upstream.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
