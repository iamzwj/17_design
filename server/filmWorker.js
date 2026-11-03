import { filmPool } from './filmPool.js';
import { filmEvent } from '../shared/filmProgress.js';
import { filmAssetLink } from "./filmLinks.js";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
const exec = promisify(execFile),
  root = process.env.FILM_ROOT,
  base = (process.env.GRSAI_BASE_URL || "https://grsaiapi.com").replace(
    /\/$/,
    "",
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (id) =>
  JSON.parse(fs.readFileSync(path.join(root, id, "project.json")));
function save(p) {
  p.updatedAt = Date.now();
  const f = path.join(root, p.id, "project.json");
  fs.writeFileSync(f + ".worker", JSON.stringify(p));
  fs.renameSync(f + ".worker", f);
}
function activity(p, key, message) {
  if (p.activity?.key === key) return;
  p.activity = { key, message, startedAt: Date.now() };
  filmEvent(p, key, message);
  save(p);
}
function check(p) {
  if (fs.existsSync(path.join(root, p.id, "cancel")))
    throw Error("制作已暂停；上游已提交任务可能继续计费");
}
async function api(endpoint, body) {
  const r = await fetch(base + endpoint, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${process.env.GRSAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  const d = await r.json();
  if (!r.ok || (d.error && !d.id))
    throw Error(
      typeof d.error === "string" ? d.error : JSON.stringify(d.error || d),
    );
  return d.data || d;
}
async function generateItem(p, slot, key, body, file) {
  if (slot[key]) return;
  check(p);
  const taskKey = key + "Task";
  const index = key === "image" ? p.assets.indexOf(slot) : p.shots.indexOf(slot);
  const subject = key === "image" ? `角色 / 场景「${slot.name}」` : `镜头 ${index + 1} 的${key === "frame" ? "首帧" : "视频"}`;

  if (!slot[taskKey]) {
    if (slot[key + "Submitting"])
      throw Error(
        "上次提交结果尚未确认，请核对供应商任务后再处理，避免重复计费",
      );
    if ((slot[key + "Attempts"] || 0) >= 3)
      throw Error("该镜头已达到3次生成上限，请调整后重做");
    slot[key + "Attempts"] = (slot[key + "Attempts"] || 0) + 1;
    slot[key + "Submitting"] = true;
    save(p);
    let d;
    try {
      d = await api("/v1/api/generate", { ...body, replyType: "async" });
    } catch (e) {
      throw Error("生成提交未确认：" + e.message);
    }
    if (!d.id) throw Error("生成服务没有返回任务编号");
    slot[taskKey] = d.id;
    slot[key + "Submitting"] = false;
    save(p);
  }
  for (let i = 0; i < 180; i++) {
    check(p);
    const d = await api(
      "/v1/api/result?id=" + encodeURIComponent(slot[taskKey]),
    );
    slot[key + "Status"] = d.status;
    slot[key + "CheckedAt"] = Date.now();
    save(p);
    if (d.status === "failed") {
      slot[taskKey] = null;
      save(p);
      throw Error(d.error || "生成失败，可重试该镜头");
    }
    if (d.status === "succeeded") {
      const url = d.results?.[0]?.url;
      if (!url) throw Error("生成结果缺少文件");
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw Error("下载生成文件失败");
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > 150 * 1024 * 1024) throw Error("生成文件过大");
      file = file.replace(
        /\.(png|mp4)$/,
        `-${slot[taskKey].replace(/[^a-zA-Z0-9_-]/g, "")}.$1`,
      );
      fs.writeFileSync(path.join(root, p.id, file), bytes);
      slot[key] = { file, url };
      filmEvent(p, `ready:${file}`, `${subject}已完成`);
      save(p);
      return;
    }
    await sleep(8000);
  }
  throw Error("上游生成仍未完成，已保留任务编号，重试将继续查询");
}
async function generate(p, slot, key, body, file) {
  if (slot[key]) return;
  check(p);
  const index = key === "image" ? p.assets.indexOf(slot) : p.shots.indexOf(slot);
  const id = `${p.stage}:${index}`;
  const message = key === "image" ? `正在制作角色 / 场景「${slot.name}」` : `正在制作镜头 ${index + 1} 的${key === "frame" ? "首帧" : "视频"}`;
  p.activeJobs ||= [];
  p.activeJobs.push({ id, stage: p.stage, message, startedAt: Date.now() });
  slot[key + "Error"] = null;
  activity(p, `${id}:${slot[key + "Attempts"] || 0}`, message);
  save(p);
  try { await generateItem(p, slot, key, body, file); }
  catch (error) {
    slot[key + "Error"] = error.message;
    filmEvent(p, `error:${id}:${Date.now()}`, `${message.replace("正在制作", "制作")}遇到问题；其他已提交任务继续保存`);
    throw error;
  } finally {
    p.activeJobs = p.activeJobs.filter(job => job.id !== id);
    save(p);
  }
}
async function plan(p) {
  if (p.plan) return;
  check(p);
  p.stage = "plan";
  activity(p, p.revision ? `revision:${p.revision}` : "plan:start", p.revision ? "导演正在调整受影响镜头，保留其他素材" : "导演正在编写故事节奏、角色设定与分镜");
  const d = await api("/v1/chat/completions", {
    model: "gemini-3.1-pro",
    messages: [
      {
        role: "system",
        content:
          "你是短片总导演。只输出JSON，不要代码块。结构：title,summary,assets:[{id,name,prompt}],shots:[{id,duration,assetIds,prompt,dialogue}]。最多2个角色、2个场景，assets分别生成角色或场景独立图。镜头每段3至10秒，合计等于目标时长，最多12镜。每镜prompt按时间、场景、人物服装、构图、动作、光线、运镜、声音、连续性详细描述；中文台词写进dialogue，视频模型应同步生成对白及环境音，不要背景字幕。所有角色/场景引用既有assetIds，镜头参考图最多3张。避免多人长对白。",
      },
      {
        role: "user",
        content: `目标${p.duration}秒，${p.ratio}，故事：${p.story}`,
      },
    ],
  });
  const t = d.choices?.[0]?.message?.content || "";
  let j;
  try {
    j = JSON.parse(t.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
  } catch {
    throw Error("导演未返回有效制作计划，请重试");
  }
  if (
    !Array.isArray(j.shots) ||
    !j.shots.length ||
    j.shots.length > 12 ||
    !Array.isArray(j.assets) ||
    j.assets.length > 4
  )
    throw Error("制作计划结构无效");
  const ids = new Set(j.assets.map((a) => a.id));
  if (
    j.shots.some(
      (s) =>
        !Number.isFinite(s.duration) ||
        s.duration < 1 ||
        s.duration > 10 ||
        typeof s.prompt !== "string" ||
        !Array.isArray(s.assetIds) ||
        s.assetIds.some((id) => !ids.has(id)),
    ) ||
    Math.abs(j.shots.reduce((a, s) => a + s.duration, 0) - p.duration) > 1
  )
    throw Error("分镜时长或素材引用未通过校验，请重试");
  p.plan = j;
  p.title = j.title || p.title;
  p.assets = j.assets;
  p.shots = j.shots;
  p.status = p.automatic ? "running" : "review";
  filmEvent(p, "plan:ready", `导演已安排 ${p.shots.length} 个镜头、${p.assets.length} 份角色与场景素材`);
  if (!p.automatic) filmEvent(p, "plan:confirm", "等待你确认分镜，再继续生成成片");
  save(p);
}
async function revise(p) {
  if (!p.revision) return;
  check(p);
  p.stage = "plan";
  activity(p, p.revision ? `revision:${p.revision}` : "plan:start", p.revision ? "导演正在调整受影响镜头，保留其他素材" : "导演正在编写故事节奏、角色设定与分镜");
  const d = await api("/v1/chat/completions", {
    model: "gemini-3.1-pro",
    messages: [
      {
        role: "system",
        content:
          "根据用户要求修改镜头，只输出JSON数组，每项为{id,prompt,dialogue}，仅输出需要修改的镜头。不得修改镜头数量、时长、角色和场景身份。prompt必须含时间、场景、人物、动作、运镜和声音要求。",
      },
      {
        role: "user",
        content: JSON.stringify({
          shots: p.shots.map(({ id, prompt, dialogue }) => ({
            id,
            prompt,
            dialogue,
          })),
          change: p.revision,
        }),
      },
    ],
  });
  const t = d.choices?.[0]?.message?.content || "";
  let edits;
  try {
    edits = JSON.parse(
      t.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
    );
  } catch {
    throw Error("导演修改结果格式无效");
  }
  if (
    !Array.isArray(edits) ||
    !edits.length ||
    edits.some(
      (e) =>
        !p.shots.some((s) => s.id === e.id) || typeof e.prompt !== "string",
    )
  )
    throw Error("导演未能定位修改镜头，请明确镜头编号");
  for (const e of edits) {
    const s = p.shots.find((s) => s.id === e.id);
    Object.assign(s, {
      prompt: e.prompt.slice(0, 6000),
      dialogue: String(e.dialogue || ""),
      frame: null,
      video: null,
      frameTask: null,
      videoTask: null,
      frameSubmitting: false,
      videoSubmitting: false,
      frameAttempts: 0,
      videoAttempts: 0,
    });
  }
  p.lastRevision = p.revision;
  p.revision = null;
  p.output = null;
  save(p);
}
async function images(p) {
  if (p.status === "review") return;
  p.stage = "assets";
  save(p);
  await filmPool(p.assets, 10, async (a, i) => {
    await generate(
      p,
      a,
      "image",
      {
        model: p.imageModel,
        prompt: a.prompt,
        images: [],
        aspectRatio: p.imageModel.startsWith("nano-") ? "1:1" : "1024x1024",
        ...(p.imageModel.startsWith("nano-")
          ? { imageSize: "1K" }
          : { quality: "auto" }),
      },
      `asset-${i}.png`,
    );
  });
  p.stage = "frames";
  save(p);
  await filmPool(p.shots, 10, async (s, i) => {
    await generate(
      p,
      s,
      "frame",
      {
        model: p.imageModel,
        prompt:
          "生成电影分镜首帧，保持参考人物服装和场景一致，不要文字。" + s.prompt,
        images: p.assets
          .filter((a) => s.assetIds.includes(a.id))
          .map((a) =>
            filmAssetLink(
              root,
              p.id,
              a.image.file,
              process.env.FILM_PUBLIC_BASE_URL || "https://17design.fun",
            ),
          ),
        aspectRatio: p.imageModel.startsWith("nano-")
          ? p.ratio
          : p.ratio === "16:9"
            ? "1536x1024"
            : "1024x1536",
        ...(p.imageModel.startsWith("nano-")
          ? { imageSize: "1K" }
          : { quality: "auto" }),
      },
      `frame-${i}.png`,
    );
  });
}
async function videos(p) {
  if (p.status === "review") return;
  p.stage = "videos";
  save(p);
  await filmPool(p.shots, 10, async (s, i) => {
    await generate(
      p,
      s,
      "video",
      {
        model: p.videoModel,
        prompt:
          s.prompt +
          (s.dialogue
            ? "。指定中文对白：" +
              s.dialogue +
              "。人物说出上述台词，声音与口型同步。"
            : ""),
        images: [
          filmAssetLink(
            root,
            p.id,
            s.frame.file,
            process.env.FILM_PUBLIC_BASE_URL || "https://17design.fun",
          ),
        ],
        aspectRatio:
          p.videoModel === "minimax-h3"
            ? p.ratio === "16:9"
              ? "landscape"
              : "portrait"
            : p.ratio,
        resolution: "480p",
        duration: Math.round(s.duration),
      },
      `shot-${i}.mp4`,
    );
  });
}
async function quality(p) {
  if (p.status === "review") return;
  p.stage = "quality";
  save(p);
  for (let i = 0; i < p.shots.length; i++) {
    check(p);
    const shot = p.shots[i];
    if (shot.review?.file === shot.video.file) continue;
    activity(p, `quality:${shot.video.file}`, `正在核对镜头 ${i + 1} 的人物、服装与场景`);
    try {
      const dir = path.join(root, p.id),
        image = path.join(dir, `check-${i}.jpg`);
      await exec(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-i",
          path.join(dir, shot.video.file),
          "-vf",
          "fps=1,scale=320:-1,tile=3x1",
          "-frames:v",
          "1",
          image,
        ],
        { timeout: 60000 },
      );
      const prompt =
        '对比第一张分镜首帧与第二张视频连续抽帧，只检查能确认的人物服装、重要道具、场景和主体完整性错误，不把审美偏好判错。只输出JSON：{status:"pass"或"review",summary:"简短观察，证据不足要说明"}。镜头要求：' +
        shot.prompt;
      const d = await api("/v1beta/models/gemini-3.1-pro:generateContent", {
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/png",
                  data: fs
                    .readFileSync(path.join(dir, shot.frame.file))
                    .toString("base64"),
                },
              },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: fs.readFileSync(image).toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      });
      const text = (d.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || "")
        .join("");
      const result = JSON.parse(
        text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
      );
      shot.review = {
        file: shot.video.file,
        status: result.status === "pass" ? "pass" : "review",
        summary: String(result.summary || "请核对镜头").slice(0, 500),
      };
    } catch (e) {
      shot.review = {
        file: shot.video.file,
        status: "review",
        summary:
          "自动画面检查未完成，请人工核对；已生成镜头保留。" +
          String(e.message).slice(0, 100),
      };
    }
    filmEvent(p, `checked:${shot.video.file}`, `镜头 ${i + 1} 画面检查已结束${shot.review.status === "pass" ? "" : "，需要人工核对"}`);
    save(p);
  }
  p.reviewWarning = p.shots.filter((s) => s.review?.status !== "pass").length;
  save(p);
}

async function render(p) {
  if (p.status === "review") return;
  check(p);
  p.stage = "render";
  activity(p, `render:${Date.now()}`, "导演正在汇总镜头，合成音轨、字幕与最终短片");
  const dir = path.join(root, p.id),
    w = p.ratio === "16:9" ? 1280 : 720,
    h = p.ratio === "16:9" ? 720 : 1280;
  for (let i = 0; i < p.shots.length; i++) {
    check(p);
    const s = p.shots[i],
      input = path.join(dir, s.video.file);
    const meta = JSON.parse(
      (
        await exec("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-of",
          "json",
          input,
        ])
      ).stdout,
    );
    if (!meta.streams.some((s) => s.codec_type === "video"))
      throw Error("镜头文件无法解码");
    const hasAudio = meta.streams.some((s) => s.codec_type === "audio");
    await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-i",
        input,
        ...(hasAudio
          ? []
          : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]),
        "-map",
        "0:v:0",
        "-map",
        hasAudio ? "0:a:0" : "1:a:0",
        "-vf",
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=10`,
        "-af",
        "apad",
        "-t",
        String(s.duration),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "21",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        path.join(dir, `clip-${i}.mp4`),
      ],
      { timeout: 300000, maxBuffer: 2e6 },
    );
  }
  fs.writeFileSync(
    path.join(dir, "concat.txt"),
    p.shots.map((_, i) => `file 'clip-${i}.mp4'`).join("\n"),
  );
  await exec(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      path.join(dir, "concat.txt"),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      path.join(dir, "assembly.mp4"),
    ],
    { timeout: 300000 },
  );
  let cursor = 0;
  const stamp = (t) => {
    const ms = Math.round(t * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  let n = 0;
  const captions = p.shots
    .map((s) => {
      const start = cursor;
      cursor += s.duration;
      return s.dialogue
        ? `${++n}\n${stamp(start)} --> ${stamp(cursor)}\n${String(s.dialogue).replace(/[\r\n]+/g, " ")}\n`
        : "";
    })
    .filter(Boolean)
    .join("\n");
  fs.writeFileSync(path.join(dir, "subtitles.srt"), captions);
  if (
    captions &&
    (await exec("ffmpeg", ["-filters"])).stdout.includes(" subtitles ")
  ) {
    p.subtitleMode = "burned";
    await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-i",
        path.join(dir, "assembly.mp4"),
        "-vf",
        `subtitles=${path.join(dir, "subtitles.srt")}`,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "21",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        path.join(dir, "film.mp4"),
      ],
      { timeout: 300000 },
    );
  } else if (captions) {
    p.subtitleMode = "embedded";
    await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-i",
        path.join(dir, "assembly.mp4"),
        "-i",
        path.join(dir, "subtitles.srt"),
        "-map",
        "0",
        "-map",
        "1",
        "-c",
        "copy",
        "-c:s",
        "mov_text",
        "-metadata:s:s:0",
        "language=zho",
        "-movflags",
        "+faststart",
        path.join(dir, "film.mp4"),
      ],
      { timeout: 300000 },
    );
  } else
    fs.copyFileSync(path.join(dir, "assembly.mp4"), path.join(dir, "film.mp4"));
  p.output = `film-${Date.now()}.mp4`;
  fs.copyFileSync(path.join(dir, "film.mp4"), path.join(dir, p.output));
  p.renders ??= [];
  p.renders.push({ file: p.output, createdAt: Date.now() });
  p.status = "succeeded";
  p.stage = "done";
  filmEvent(p, `output:${p.output}`, "成片已生成，可以播放和下载 MP4");
  save(p);
}
const State = Annotation.Root({ id: Annotation(), halted: Annotation() });
const stage =
  (fn, first = false) =>
  async (state) => {
    if (state.halted) return state;
    const p = read(state.id);
    try {
      if (first) {
        p.status = "running";
        p.activeJobs = [];
        p.error = null;
        save(p);
      }
      await fn(p);
      return { ...state, halted: p.status === "review" };
    } catch (e) {
      p.status = fs.existsSync(path.join(root, p.id, "cancel"))
        ? "cancelled"
        : "failed";
      p.error = e.message;
      filmEvent(p, `stop:${Date.now()}`, p.status === "cancelled" ? "已暂停后续制作，已完成素材保留" : "制作遇到问题，已保留当前成果等待重试");
      save(p);
      return { ...state, halted: true };
    }
  };
const graph = new StateGraph(State)
  .addNode(
    "director",
    stage(async (p) => {
      await plan(p);
      await revise(p);
    }, true),
  )
  .addNode("visual_assets", stage(images))
  .addNode("video_shots", stage(videos))
  .addNode("visual_review", stage(quality))
  .addNode("final_render", stage(render))
  .addEdge(START, "director")
  .addEdge("director", "visual_assets")
  .addEdge("visual_assets", "video_shots")
  .addEdge("video_shots", "visual_review")
  .addEdge("visual_review", "final_render")
  .addEdge("final_render", END)
  .compile();

while (true) {
  try {
    const p = fs
      .readdirSync(root)
      .filter((x) => /^[a-f0-9-]{36}$/.test(x))
      .map(read)
      .find((p) => ["queued", "running"].includes(p.status));
    if (p) await graph.invoke({ id: p.id });
    else await sleep(1500);
  } catch (e) {
    console.error("Film worker:", e.message);
    await sleep(3000);
  }
}
