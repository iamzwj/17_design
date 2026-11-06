import sharp from 'sharp';
import {prepareFilmAudio,renderFilmTimeline,probe} from './filmEditing.js';
import { readFilmProject, drainFilmCommands, pendingCommands, beginTask, finishTask, event, taskId, clone, applyCommand } from './filmState.js';
import { createFilmAgents } from './filmAgents.js';
import { filmPool } from './filmPool.js';
import { createFilmDispatcher } from './filmScheduler.js';
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
  readFilmProject(root,id);
function save(p) {
  drainFilmCommands(root,p);
  if(p.activeJobs?.length)p.status=p.schedulingPaused?"pausing":"running";
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
function check(p, inflight=false) {
  drainFilmCommands(root,p);
  if (fs.existsSync(path.join(root, p.id, "cancel"))) throw Error("制作已暂停；上游已提交任务可能继续计费");
  if(p.schedulingPaused && !inflight)throw Object.assign(Error('已暂停新任务调度，已提交的外部任务继续保存结果'),{code:'PAUSED'});
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
// Headless validation without a public file host may reuse the provider's own
// generated asset URL. Production defaults to private 30-minute signed links.
function referenceImage(p,output) {
  return process.env.FILM_REFERENCE_SOURCE==='provider'&&output.url?output.url:filmAssetLink(root,p.id,output.file,process.env.FILM_PUBLIC_BASE_URL||'https://17design.fun');
}
async function generate(p,slot,key,body,file) {
  if(slot[key] || slot.paused || slot.stale)return;
  check(p);if(slot.locked)throw Object.assign(Error('锁定资产缺少有效产物，需要人工处理'),{code:'INPUT'});
  const version=slot.revision||1, snapshot=clone(slot), id=taskId(slot.id,key,version);
  let t=p.tasks.find(t=>t.id===id);
  if(!t)t=beginTask(p,id,p.stage,key==='video'?'visual':'visual',{name:slot.name || `镜头 ${slot.id} ${key}`,version,model:body.model},slot.resourceIds||slot.dependencies||[]);
  t.kind=key;t.resourceId=slot.id;t.version=version;t.requestBody=body;t.fileBase=file;t.resourceSnapshot ||= snapshot;t.status='running';
  t.providerId ||= slot[key+'Task'];t.submitting ||= slot[key+'Submitting'];
  const job={id,stage:p.stage,message:`正在制作${slot.name||('镜头 '+slot.id)}${key==='video'?'视频':key==='frame'?'首帧':''}`,startedAt:t.startedAt||Date.now(),resourceId:slot.id,version};
  p.activeJobs ||= [];p.activeJobs.push(job);slot[key+'Error']=null;save(p);
  try {
    if(!t.providerId) {
      if(t.submitting)throw Object.assign(Error('生成提交结果未知，已停止重复提交，请核对供应商任务'),{code:'INPUT'});
      slot[key+'Attempts']=(slot[key+'Attempts']||0)+1;t.submitting=true;slot[key+'Submitting']=true;save(p);
      let response;
      try {response=await api('/v1/api/generate',{...body,replyType:'async'});}catch(e){throw Object.assign(Error('生成提交未确认：'+e.message),{code:'INPUT'});}
      if(!response.id)throw Object.assign(Error('生成服务未返回任务编号，禁止重复扣费提交'),{code:'INPUT'});
      t.providerId=response.id;t.submitting=false;
      if(slot.revision===version || (!slot.revision&&version===1)){slot[key+'Task']=response.id;slot[key+'Submitting']=false;}
      save(p);
    }
    for(let i=0;i<180;i++) {
      check(p,true);
      const result=await api('/v1/api/result?id='+encodeURIComponent(t.providerId));
      t.providerStatus=result.status;t.updatedAt=Date.now();
      if((slot.revision||1)===version){slot[key+'Status']=result.status;slot[key+'CheckedAt']=Date.now();}save(p);
      if(result.status==='failed'){t.providerId=null;if((slot.revision||1)===version)slot[key+'Task']=null;throw Error(result.error||'模型生成失败');}
      if(result.status==='succeeded') {
        const url=result.results?.[0]?.url;if(!url)throw Error('生成结果缺少文件');
        const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('下载生成文件失败');
        const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>150*1024*1024)throw Error('生成文件过大');
        const actual=file.replace(/\.(png|mp4)$/,`-${String(t.providerId).replace(/[^a-zA-Z0-9_-]/g,'')}.$1`);
        if(key==='video') {fs.writeFileSync(path.join(root,p.id,actual),bytes);const meta=await probe(path.join(root,p.id,actual));if(!meta.streams.some(s=>s.codec_type==='video'))throw Error('生成视频无法解码');}
        else {const image=sharp(bytes,{limitInputPixels:50000000});const meta=await image.metadata();if(!meta.width||!meta.height)throw Error('生成图片无法解码');await image.rotate().png().toFile(path.join(root,p.id,actual));if(meta.format!=='png')fs.writeFileSync(path.join(root,p.id,actual.replace(/\.png$/,`.original.${meta.format==='jpeg'?'jpg':meta.format}`)),bytes);}
        save(p);
        const output={file:actual,url};finishTask(p,t,output);
        if((slot.revision||1)===version && [...p.resources,...p.assets,...p.shots].includes(slot)){slot[key]=output;if(key==='image')slot.output=output;}
        else {t.status='superseded';slot.history ||= [];slot.history.push({version,at:Date.now(),value:{...snapshot,[key]:output,output:key==='image'?output:undefined}});event(p,'director',id,'旧版本结果已归档，不覆盖你正在修改的新版本',{type:'superseded'});}
        return;
      }
      await sleep(8000);
    }
    throw Error('上游仍在制作，已保留任务编号，稍后继续查询不会重复提交');
  } catch(error) {
    finishTask(p,t,null,error);t.status=error.code==='INPUT'?'needs-input':'failed';
    if((slot.revision||1)===version)slot[key+'Error']=error.message;
    throw error;
  } finally {p.activeJobs=p.activeJobs.filter(j=>j.id!==id);save(p);}
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
          "你是短片总导演。只输出JSON，不要代码块。title根据故事梗概拟定一个简洁片名（5至12个汉字），不要截取故事开头。结构：title,summary,assets:[{id,name,prompt}],shots:[{id,duration,assetIds,prompt,dialogue}]。最多2个角色、2个场景，assets分别生成角色或场景独立图。镜头每段3至10秒，合计等于目标时长，最多12镜。每镜prompt按时间、场景、人物服装、构图、动作、光线、运镜、声音、连续性详细描述；中文台词写进dialogue，视频模型应同步生成对白及环境音，不要背景字幕。所有角色/场景引用既有assetIds，镜头参考图最多3张。避免多人长对白。",
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
    typeof j.title !== "string" || !j.title.trim() || j.title.length > 40 ||
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
  p.title = j.title.trim();
  p.assets = j.assets;
  p.shots = j.shots;
  p.status = "running";
  filmEvent(p, "plan:ready", `导演已安排 ${p.shots.length} 个镜头、${p.assets.length} 份角色与场景素材`);
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
      revision: (s.revision||1)+1,
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
  if (p.status === "review" || p.pausedStages?.videos) return;
  p.stage = "videos";
  save(p);
  await filmPool(p.shots, 10, async (s, i) => {
    if(!s.frame || s.paused || s.stale)return;
    const references=p.referenceWorkflow
      ? (s.referenceVersions||[]).filter(r=>p.resources.some(asset=>asset.id===r.id && usableSetting(asset) && asset.output.file===r.file))
      : [];
    const videoRefs=references.slice(0,p.videoModel==='wan-3.0'?9:8);
    await generate(
      p,
      s,
      "video",
      {
        model: p.videoModel,
        prompt:
          s.prompt +
          (videoRefs.length ? "。图1提供镜头构图与动作起点，后续图仅供核对场景、身份与服装；角色造型和空间细节以当前设定图版本为准；禁止生成拼版或参考图中的多视角布局。" : "") +
          (s.dialogue
            ? "。指定中文对白：" +
              s.dialogue +
              "。人物说出上述台词，声音与口型同步。"
            : ""),
        images: [
          referenceImage(p,s.frame),
          ...videoRefs.map(r=>referenceImage(p,r)),
        ],
        aspectRatio:
          p.videoModel === "minimax-h3"
            ? p.ratio === "16:9"
              ? "landscape"
              : "portrait"
            : p.ratio,
        resolution: "480p",
        duration: Math.max(p.videoModel==='wan-3.0'?2:1,Math.ceil(s.duration)),
      },
      `shot-${i}.mp4`,
    );
  });
}
async function quality(p) {
  if (p.status === "review") return;
  p.stage = "quality";
  save(p);
  await filmPool(p.shots,10,async (shot,i)=>{
    check(p);
    if(!shot.video || shot.stale || shot.paused)return;
    if(shot.manualApprovedVersion===shot.revision){shot.review={file:shot.video.file,status:"pass",summary:"用户已确认保留当前版本",manual:true};return;}
    if(shot.review?.file===shot.video.file)return;
    const reviewedVersion=shot.revision,reviewVideo=shot.video.file,reviewFrame=shot.frame?.file;let reviewResult;
    const reviewTask=beginTask(p,taskId(shot.id,"review",reviewedVersion),"quality","quality",{name:`镜头 ${i+1} 一致性检查`});
    p.activeJobs ||= [];p.activeJobs.push({id:reviewTask.id,stage:"quality",resourceId:shot.id,message:`正在审核镜头 ${i+1}`,startedAt:Date.now()});save(p);

    activity(p, `quality:${reviewVideo}`, `正在核对镜头 ${i + 1} 的人物、服装与场景`);
    try {
      const dir = path.join(root, p.id),
        image = path.join(dir, `check-${shot.id}-v${reviewedVersion}.jpg`);
      await exec(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-i",
          path.join(dir, reviewVideo),
          "-vf",
          "fps=1,scale=320:-1,tile=3x1",
          "-frames:v",
          "1",
          image,
        ],
        { timeout: 60000 },
      );
      const prompt =
        '对比第一张分镜首帧与第二张视频连续抽帧，只检查能确认的人物服装、重要道具、场景和主体完整性错误，不把审美偏好判错。只输出JSON：{status:"pass"或"review",summary:"简短观察，证据不足要说明",issues:[{type:"角色/服装/场景/动作/不确定",evidence:"可见证据",confidence:"high/low"}]}。镜头要求：' +
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
                    .readFileSync(path.join(dir, reviewFrame))
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
      reviewResult = {
        file: reviewVideo,
        status: result.status === "pass" ? "pass" : "review",
        summary: String(result.summary || "请核对镜头").slice(0, 500),
        issues: Array.isArray(result.issues)?result.issues:[], evidence: {frame:reviewFrame,video:reviewVideo,contact:`check-${shot.id}-v${reviewedVersion}.jpg`},
      };
    } catch (e) {
      reviewResult = {
        file: reviewVideo,
        status: "review",
        summary:
          "自动画面检查未完成，请人工核对；已生成镜头保留。" +
          String(e.message).slice(0, 100),
      };
    }
    save(p);
    if(shot.revision===reviewedVersion)shot.review=reviewResult;
    p.activeJobs=p.activeJobs.filter(j=>j.id!==reviewTask.id);
    finishTask(p,reviewTask,reviewResult);
    if(shot.revision!==reviewedVersion)reviewTask.status="superseded";
    filmEvent(p, `checked:${reviewVideo}`, `镜头 ${i + 1} 画面检查已结束${reviewResult.status === "pass" ? "" : "，需要人工核对"}`);
    save(p);
  });
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
const agents=createFilmAgents({api,save,check});
const settingChecks = {
  face: '一张图有正面、45°、90°面部特写，三处五官、脸型、发际线和肤色属于同一人；有原始参考时核对身份',
  wardrobe: '与参考面部图同一身份；全身正面、侧面、背面穿同一套服装，呈现鞋履、配饰和必要细节',
  environment: '同一空间的白天和夜晚主视角，建筑、机位、家具、固定道具位置相同；另有环境、照明与道具细节',
};

function approvedSetting(resource) {
  return resource?.output && !resource.stale &&
    (resource.type === 'reference-original' ||
      resource.approvedVersion === resource.revision);
}

function usableSetting(resource) {
  return approvedSetting(resource) || Boolean(resource?.output && !resource.stale &&
    resource.assetReview?.version === resource.revision && resource.assetReview.file === resource.output.file);
}

async function reviewSetting(p, resource, references) {
  const {revision, output} = resource;
  const id = taskId(resource.id, 'asset-review', revision);
  const task = beginTask(p,id,'assets','director',{name:resource.name+' · 导演审核'});
  save(p);
  let review;
  try {
    const parts = [{text: '你是 AI 总导演。第一张图为待审设定图，后续为已确定的身份参考。依据实际图像核对：'+settingChecks[resource.type]+
      '。设计要求：'+resource.prompt+
      '。只返回 JSON {status:"pass"|"repair"|"review",confidence:"high"|"low",summary:"可见证据",correction:"明确错误的具体修正"}。看不清、缺证据或不确定一律 review。只有确认符合全部要求且有依据才 pass。'}];
    for(const image of [output,...references]) {
      const data = await sharp(path.join(root,p.id,image.file)).resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true}).png().toBuffer();
      parts.push({inline_data:{mime_type:'image/png',data:data.toString('base64')}});
    }
    const response = await api('/v1beta/models/gemini-3.1-pro:generateContent',{contents:[{role:'user',parts}],generationConfig:{temperature:0.1}});
    const raw = (response.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('').trim();
    review = JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
    if(!['pass','repair','review'].includes(review.status) || typeof review.summary!=='string' || !review.summary.trim())throw Error('审核返回缺少有效证据');
    if(review.confidence!=='high')review.status='review';
    finishTask(p,task,review);
  } catch(error) {
    review = {status:'review',confidence:'low',summary:'自动审核未完成，请核对设定图。'+error.message};
    finishTask(p,task,review,error);
  }
  check(p);
  if(!p.resources.includes(resource) || resource.revision!==revision || resource.output?.file!==output.file)return;
  resource.assetReview = {...review,file:output.file,version:revision};
  if(review.status==='pass')resource.approvedVersion=revision;
  event(p,'director',id,resource.name+' · '+(review.status==='pass'?'通过并锁定引用版本':'记录风险')+' · '+review.summary,{type:'decision'});
  save(p);
}

async function referenceAssets(p) {
  if(p.pausedStages?.images)return;
  const strict=p.referenceWorkflow===true;
  const resources=p.resources.filter(r=>settingChecks[r.type]);
  p.stage='assets';
  save(p);
  const inventoryKey='reference-inventory:'+p.scriptRevision;
  if(strict && !p.events.some(e=>e.taskId===inventoryKey))event(p,'director',inventoryKey,`识别了 ${p.characters.length} 名角色、${p.scenes.length} 个场景，安排制作 ${resources.length} 张设定图`);
  for(const group of [resources.filter(r=>r.type!=='wardrobe'),resources.filter(r=>r.type==='wardrobe')]) {
    await filmPool(group,10,async r=>{
      if(p.pausedStages?.images || r.paused || r.stale || p.pausedStages?.[r.category])return;
      const dependencies=(r.dependencies||[]).map(id=>p.resources.find(x=>x.id===id));
      if(dependencies.some(dep=>strict ? !usableSetting(dep) : !dep?.output || dep.stale))return;
      const references=r.characterReference?[r.characterReference]:dependencies.map(dep=>dep.output);
      const nano=p.imageModel.startsWith('nano-');
      const landscape=r.type==='environment';
      const aspectRatio=nano?(landscape?'16:9':'1:1'):(landscape?'1536x1024':'1024x1024');
      while(true) {
        if(!r.output) {
          await generate(p,r,'image',{
            model:p.imageModel,
            prompt:[p.settings.style,references.length?'以参考图为准，保持明确要求保留的身份与特征。':'',r.prompt,r.reviewCorrection].filter(Boolean).join('；'),
            images:references.map(image=>referenceImage(p,image)),
            aspectRatio,...(nano?{imageSize:'1K'}:{quality:'auto'}),
          },`asset-${r.id}-v${r.revision}.png`);
        }
        if(!strict || !r.output || approvedSetting(r))return;
        if(r.assetReview?.version!==r.revision || r.assetReview.file!==r.output.file)await reviewSetting(p,r,references);
        const review=r.assetReview;
        if(review?.version!==r.revision || review.status!=='repair' || typeof review.correction!=='string' ||
          !review.correction.trim() || r.locked || r.qualityRetryUsed)return;
        applyCommand(p,{id:'asset-repair:'+taskId(r.id,'image',r.revision),type:'regenerate',body:{id:r.id}});
        r.qualityRetryUsed=true;
        r.reviewCorrection=review.correction;
        event(p,'director',r.id,'自动修正一次：'+review.correction,{type:'recovery'});
        save(p);
      }
    });
  }
  if(!strict) {
    await filmPool(p.resources.filter(r=>r.output && !r.stale && r.type!=='reference-original'),10,async r=>{
      if(r.assetReview?.file===r.output.file)return;
      const version=r.revision,file=r.output.file,t=beginTask(p,taskId(r.id,'asset-review',version),'images','quality',{name:r.name+'设定图检查'});save(p);
      try {
        const requirement=r.type==='face'?'一张完整设定图中，同一个人物是否包含正面、45度、90度面部特写三种角度，身份一致':r.type==='wardrobe'?'是否是一张独立的服饰设定图，展示全身正面、侧面、背面和鞋履配饰，而不是面部特写图':r.type==='environment'?'是否在一张完整环境设定图中体现同一空间的白天与夜晚，建筑布局和固定道具一致':'是否符合该视觉参考的明确要求';
        const response=await api('/v1beta/models/gemini-3.1-pro:generateContent',{contents:[{role:'user',parts:[{text:`只检查可见事实，不评判审美。${requirement}。返回JSON {status:"pass"|"review",summary:"具体依据",confidence:"high"|"low"}。不确定必须明确说明。`},{inline_data:{mime_type:'image/png',data:fs.readFileSync(path.join(root,p.id,file)).toString('base64')}}]}],generationConfig:{temperature:0.1}});
        const raw=(response.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('');const review=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
        save(p);if(r.revision===version)r.assetReview={...review,file};finishTask(p,t,{...review,file});
      }catch(e){if(r.revision===version)r.assetReview={file,status:'review',confidence:'low',summary:'设定图自动检查未完成，需人工核对：'+e.message};finishTask(p,t,r.assetReview);}
      save(p);
    });
    return;
  }
  check(p);
  if(p.needsRerun)return;
  const pending=resources.filter(r=>!usableSetting(r));
  if(pending.length && !pending.some(r=>r.paused || p.pausedStages?.[r.category]))throw Error('设定图缺少可用成果：'+pending.map(r=>r.name).join('、'));
  const handoffKey='reference-handoff:'+resources.map(r=>r.id+'-'+r.revision).join(',');
  if(!p.events.some(e=>e.taskId===handoffKey))event(p,'director',handoffKey,'设定图已交给分镜与视频制作，审核意见保留在设定图记录中。',{type:'dispatch'});
}

async function framesV2(p) {
  p.stage='images';save(p);if(p.pausedStages?.images)return;
  const link=r=>referenceImage(p,r.output);
  await filmPool(p.shots,10,async shot=>{
    if(shot.paused||shot.stale)return;
    const refs=(shot.resourceIds||[]).map(id=>p.resources.find(r=>r.id===id));if(refs.some(r=>!r?.output||r.stale))return;
    if(p.referenceWorkflow && refs.some(r=>!usableSetting(r)))return;
    if(!shot.frame)shot.referenceVersions=refs.map(r=>({id:r.id,version:r.revision,file:r.output.file}));
    await generate(p,shot,'frame',{model:p.imageModel,prompt:`${shot.time}；电影分镜首帧，${p.settings.style}，严格保持参考图身份、服装、环境布局一致。角色造型和空间细节以当前设定图版本为准。根据镜头时间与天气选取场景参考中的对应状态，只生成一幅电影画面，不复制参考板拼版。${shot.firstFramePrompt||shot.prompt}`,images:refs.map(link),aspectRatio:p.imageModel.startsWith('nano-')?p.ratio:p.ratio==='16:9'?'1536x1024':'1024x1536',...(p.imageModel.startsWith('nano-')?{imageSize:'1K'}:{quality:'auto'})},`frame-${shot.id}-v${shot.revision}.png`);
    if(shot.tailFramePrompt && shot.frame)await generate(p,shot,'tail',{model:p.imageModel,prompt:shot.tailFramePrompt,images:[referenceImage(p,shot.frame)],aspectRatio:p.imageModel.startsWith('nano-')?p.ratio:p.ratio==='16:9'?'1536x1024':'1024x1536'},`frame-tail-${shot.id}-v${shot.revision}.png`);
  });
}
async function directorReview(p) {
  const issues=p.shots.filter(s=>s.video && s.review?.status!=='pass' && s.manualApprovedVersion!==s.revision);
  const unresolvedSettings=(p.resources||[]).filter(r=>r.output&&!r.stale&&r.assetReview&&r.assetReview.status!=='pass');
  const assetIssues=p.referenceWorkflow?[]:unresolvedSettings;
  p.reviewWarning=issues.length+unresolvedSettings.length+Number(p.continuityReview?.status==='manual');
  if(!issues.length&&!assetIssues.length)return;
  const id=taskId('review-'+issues.map(s=>s.id+'-'+s.revision).join('-'),'director'),t=beginTask(p,id,'quality','director',{name:'导演审核与有限修复',assetIssues:assetIssues.map(r=>({id:r.id,locked:r.locked,prompt:r.prompt,review:r.assetReview})),issues:issues.map(s=>({id:s.id,locked:s.locked,attempts:s.repairAttempts||0,prompt:s.prompt,review:s.review}))});save(p);
  try {
    const d=await api('/v1/chat/completions',{model:'gemini-3.1-pro',response_format:{type:'json_object'},messages:[{role:'system',content:'根据质检证据作导演决策。只返回{decision:"accept"|"repair"|"manual",reason,repairs:[{id,action:"frame"|"video"|"image",prompt}]}。证据不足或审美偏好不能当作确定错误；可accept附人工建议。明确人物/服装/场景错误可修复，最多自动修复一次，锁定资产必须manual。修复prompt第一部分必须明确时间，保留未出问题的要求。不得无限重复同一提示词。'},{role:'user',content:JSON.stringify(t.input)}]});
    const raw=d.choices?.[0]?.message?.content||'';const decision=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
    if(!['accept','repair','manual'].includes(decision.decision))throw Error('导演审核决策无效');
    finishTask(p,t,decision);event(p,'director',id,decision.reason||'已完成导演审核',{type:'decision'});
    if(decision.decision==='repair') {
      let repaired=false;
      if(!Array.isArray(decision.repairs)||!decision.repairs.length)throw Error('未给出可执行修复计划');
      for(const fix of decision.repairs) {
        const shot=issues.find(s=>s.id===fix.id)||assetIssues.find(r=>r.id===fix.id);if(!shot||shot.locked||(shot.repairAttempts||0)>=1||!['frame','video','image'].includes(fix.action)||typeof fix.prompt!=='string')continue;
        if(fix.action==='video'){applyCommand(p,{id:`repair:${id}:${shot.id}`,type:'regenerate',body:{id:shot.id,videoOnly:true}});shot.prompt=fix.prompt;}else applyCommand(p,{id:`repair:${id}:${shot.id}`,type:'edit',body:{id:shot.id,patch:{prompt:fix.prompt}}});shot.repairAttempts=(shot.repairAttempts||0)+1;repaired=true;
      }
      if(repaired)p.status='queued';
    }
    save(p);
  }catch(e){finishTask(p,t,null,e);save(p);}
}
async function recoverDetached(p) {
  for(const t of p.tasks.filter(t=>t.providerId && ['running','failed'].includes(t.status))) {
    const current=[...(p.schemaVersion===2?p.resources:p.assets),...p.shots].find(r=>r.id===t.resourceId);
    if(!current || (current.revision===t.version && !p.schedulingPaused))continue;
    try{const d=await api('/v1/api/result?id='+encodeURIComponent(t.providerId));if(d.status==='failed'){t.status='failed';t.providerId=null;save(p);}else if(d.status==='succeeded'){
      const r=await fetch(d.results[0].url,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('旧版本结果下载失败');const file=t.fileBase.replace(/\.(png|mp4)$/,`-archived-${String(t.providerId).replace(/[^a-zA-Z0-9_-]/g,'')}.$1`);fs.writeFileSync(path.join(root,p.id,file),Buffer.from(await r.arrayBuffer()));t.output={file};t.status=current.revision===t.version?'succeeded':'superseded';if(current.revision===t.version){current[t.kind]={file};if(t.kind==='image')current.output={file};p.activeJobs=(p.activeJobs||[]).filter(j=>j.id!==t.id);}current.history ||= [];current.history.push({version:t.version,at:Date.now(),value:{...t.resourceSnapshot,[t.kind]:{file},...(t.kind==='image'?{output:{file}}:{})}});save(p);
    }}catch(e){t.recoveryError=e.message;save(p);}
  }
}
async function recoverFailure(p,error) {
  const t=[...p.tasks].reverse().find(t=>['failed','needs-input'].includes(t.status));
  if(!t || error.code==='INPUT' || error.code==='PAUSED' || p.schedulingPaused)return false;
  if(t.providerId && (t.automaticRetries||0)<2) {
    t.automaticRetries=(t.automaticRetries||0)+1;p.status='queued';p.nextRunAt=Date.now()+10000;
    event(p,'director',t.id,'保留原生成请求，稍后自动继续查询；不会再次提交计费任务',{type:'recovery'});save(p);return true;
  }
  const r=[...p.resources,...p.shots].find(r=>r.id===t.resourceId);
  if(!r || r.locked || (r.failureRepairs||0)>=1 || t.providerStatus!=='failed')return false;
  try {
    const response=await api('/v1/chat/completions',{model:'gemini-3.1-pro',response_format:{type:'json_object'},messages:[{role:'system',content:'分析这次生成明确失败的原因，返回{decision:"repair"|"manual",reason,prompt}。只在能通过优化提示词修复时repair，保留用户需求，镜头提示词先写时间；不能重复原词盲目重试。'},{role:'user',content:JSON.stringify({error:error.message,prompt:r.prompt,model:t.input.model})}]});
    const d=JSON.parse(response.choices[0].message.content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
    if(d.decision!=='repair'||typeof d.prompt!=='string'||d.prompt===r.prompt)return false;
    applyCommand(p,{id:'failure-repair:'+t.id,type:'edit',body:{id:r.id,patch:{prompt:d.prompt}}});r.failureRepairs=(r.failureRepairs||0)+1;event(p,'director',t.id,d.reason||'已分析失败原因并调整生成输入',{type:'recovery'});p.status='queued';save(p);return true;
  }catch{return false;}
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
      await fn(p);save(p);
      if(p.schedulingPaused){p.status='paused';save(p);return {...state,halted:true};}
      if(p.needsRerun){p.needsRerun=false;p.status='queued';save(p);return {...state,halted:true};}
      return { ...state, halted: ["review","queued","needs-input"].includes(p.status) };
    } catch (e) {
      if(p.schemaVersion===2 && await recoverFailure(p,e))return {...state,halted:true};
      p.status = fs.existsSync(path.join(root, p.id, "cancel"))
        ? "cancelled"
        : e.code==='PAUSED' ? "paused" : e.code==='INPUT' ? "needs-input" : "failed";
      p.error = e.message;
      filmEvent(p, `stop:${Date.now()}`, p.status === "cancelled" ? "已暂停后续制作，已完成素材保留" : "制作遇到问题，已保留当前成果等待重试");
      save(p);
      return { ...state, halted: true };
    }
  };
const graph = new StateGraph(State)
  .addNode('director',stage(async p=>{await recoverDetached(p);if(p.schemaVersion===2){await agents.director(p);await agents.revise(p);}else {await plan(p);await revise(p);await agents.revise(p);}},true))
  .addNode('screenwriter',stage(async p=>{if(p.schemaVersion===2)await agents.writer(p);}))
  .addNode('character_scene',stage(async p=>{if(p.schemaVersion===2){const results=await Promise.allSettled([agents.characters(p),agents.scenes(p)]);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;}}))
  .addNode('reference_assets',stage(async p=>{if(p.schemaVersion===2 && p.referenceWorkflow)await referenceAssets(p);}))
  .addNode('storyboard',stage(async p=>{if(p.schemaVersion===2)await agents.storyboard(p);if(p.schemaVersion===2)await agents.continuity(p);}))
  .addNode('visual_assets',stage(async p=>{if(p.schemaVersion===2){if(!p.referenceWorkflow)await referenceAssets(p);if(p.status!=='review')await framesV2(p);}else await images(p);}))
  .addNode('video_shots',stage(videos))
  .addNode('visual_review',stage(async p=>{await quality(p);if(p.schemaVersion===2)await directorReview(p);}))
  .addNode('audio',stage(async p=>{if(p.pausedStages?.audio)return;if(p.schemaVersion===2 || p.useTimeline)await prepareFilmAudio(p,{root,api,save,check});}))
  .addNode('final_render',stage(async p=>{if(p.output){p.status='succeeded';p.stage='done';save(p);return;}if(p.schemaVersion===2 || p.useTimeline)await renderFilmTimeline(p,{root,save,check});else await render(p);}))
  .addEdge(START,'director').addEdge('director','screenwriter').addEdge('screenwriter','character_scene').addEdge('character_scene','reference_assets').addEdge('reference_assets','storyboard').addEdge('storyboard','visual_assets').addEdge('visual_assets','video_shots').addEdge('video_shots','visual_review').addEdge('visual_review','audio').addEdge('audio','final_render').addEdge('final_render',END).compile();
// Each project owns one asynchronous execution. Waiting for a provider in one
// project must not block another project, or start a second writer for itself.
const dispatch = createFilmDispatcher(async p => {
  drainFilmCommands(root,p);save(p);
  if(p.schedulingPaused){await recoverDetached(p);p.status='paused';save(p);return;}
  if(!['queued','running'].includes(p.status)){await recoverDetached(p);return;}
  await graph.invoke({id:p.id});
}, error => console.error('Film project:',error.message));
while(true) {
  try {
    const projects=fs.readdirSync(root).filter(x=>/^[a-f0-9-]{36}$/.test(x)).flatMap(id=>{try{return [read(id)];}catch{return [];}});
    dispatch(projects,p=>pendingCommands(root,p).length>0);
    await sleep(1500);
  }catch(e){console.error('Film worker:',e.message);await sleep(3000);}
}
