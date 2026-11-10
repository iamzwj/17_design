import { FILM_VIDEO_MODELS, filmVideoResolution, filmVideoResolutions } from '../shared/filmVideoModels.js';
import { VIBBIT_FLARE_MODEL } from '../shared/vibbitImageModels.js';
import { userError, localizeErrors } from './userErrors.js'
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';
import { CharacterLibrary } from "./FilmCharacters.jsx";
import { filmTaskName } from '../shared/filmProgress.js';
import FilmWorkbench from './FilmWorkbench.jsx';
import { useEffect, useState } from "react";
import { getAuthToken } from "./api.js";
import ComposerSelect from "./ComposerSelect.jsx";
import "./filmStudio.css";
import { filmNarrativePresets } from "../shared/filmNarrativePresets.js";
const base = () =>
  String(
      import.meta.env.VITE_API_BASE_URL ||
      "",
  ).replace(/\/$/, "");
export async function filmRequest(path = "", body) {
  const r = await fetch(base() + "/api/films" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json().then(localizeErrors);
  if (!r.ok) throw Error(d.error || "读取制作项目失败");
  return d;
}
const request = filmRequest;
const filmStylePresets = [
  { label: "院线电影写实", image: "cinematic", prompt: "真人电影摄影。保留自然肤质和真实衣料，柔和侧光、低饱和冷暖对比与细微胶片颗粒。各镜头色调统一，背景适度虚化。" },
  { label: "日系二维动画", image: "anime", prompt: "手绘二维动画。清晰轮廓、两层赛璐璐阴影与水彩背景。固定线宽、角色比例和色板，动作有清晰的关键姿势。" },
  { label: "三维卡通动画", image: "cartoon", prompt: "三维卡通动画。角色轮廓圆润、比例适度夸张，采用哑光材质和柔和漫反射光。固定脸型、服装配色与材质，表情清楚有弹性。" },
  { label: "黏土定格", image: "clay", prompt: "手工黏土定格动画。角色和道具保留轻微指纹与捏塑痕迹，实体微缩布景，柔和棚灯，动作呈逐格定格节奏。" },
  { label: "黑白黑色电影", image: "noir", prompt: "高反差黑白电影摄影。使用硬侧光、深黑背景、窗格投影和细微胶片颗粒。高光克制，各镜头明暗层次统一。" },
];

export default function FilmStudio({ user, onLogin, projectId, onCreated, onNew }) {
  const [characterLibrary, setCharacterLibrary] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const cacheKey = user?.id && projectId ? `dgen-film-project-${user.id}-${projectId}` : '';
  const [project, setProject] = useState(() => {
    if (!cacheKey) return null;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      return cached?.id === projectId && cached?.userId === user.id ? cached : null;
    } catch {
      return null;
    }
  });
  const [id, setId] = useState(projectId || ""),
    [form, setForm] = useState(() => {
      const defaults = {
        story: "",
        duration: 30,
        ratio: "16:9",
        imageModel: "gpt-image-2.5",
        videoModel: "minimax-h3",
        style: filmStylePresets[0].prompt,
        narrativeStyleId: filmNarrativePresets[0].id,
      };
      try {
        const saved = JSON.parse(localStorage.getItem("dgen-film-draft-" + getAuthToken().slice(-12)));
        const style = filmStylePresets.find((preset) => preset.prompt === saved?.style)?.prompt;
        return { ...defaults, ...saved, style: style ?? defaults.style };
      } catch {
        return defaults;
      }
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [lastSynced, setLastSynced] = useState(0);
  const p = project?.id === id ? project : null;
  const videoResolution = filmVideoResolution(form.videoModel, form.videoResolution);
  useEffect(() => {
    if (!user?.id || !project?.id || project.userId !== user.id) return;
    try {
      localStorage.setItem(`dgen-film-project-${user.id}-${project.id}`, JSON.stringify(project));
    } catch {
      // A full browser store must not stop the server-backed project from working.
    }
  }, [user?.id, project]);

  useEffect(() => {
    if (!user || !id) return;
    let live = true;
    const refresh = () => request("/" + encodeURIComponent(id)).then(({ project }) => {
      if (live) {
        setProject(project);
        setLastSynced(Date.now());
        setLoaded(true);
      }
    }).catch((error) => {
      if (live) {
        setLoaded(true);
        setError(userError(error.message));
      }
    });
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [user, id]);
  useEffect(() => {
    localStorage.setItem(
      "dgen-film-draft-" + getAuthToken().slice(-12),
      JSON.stringify(form),
    );
  }, [form]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("filmProject", id);
    else url.searchParams.delete("filmProject");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [id]);

  const field = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function action(path, body) {
    const token = getAuthToken();
    setBusy(true);
    setError("");
    try {
      const d = await request(path, body);
      if (d.project && token === getAuthToken()) {
        setProject(d.project);
        setId(d.project.id);
        onCreated?.(d.project);
        setForm((current) => ({ ...current, story: "" }));
      }
    } catch (e) {
      setError(userError(e.message));
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    try {
      const r = await fetch(base() + `/api/films/${p.id}/files/${p.output}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!r.ok) throw Error("下载失败");
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = filmTaskName(p) + ".mp4";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(userError(e.message));
    }
  }
  if (!user)
    return (
      <section className="film-studio">
        <h1>一键成片</h1>
        <p>登录后创建自己的短片项目，制作进度和素材会持续保存。</p>
        <button onClick={onLogin}>登录后开始制作</button>
      </section>
    );
  return (
    <section className={id ? "film-studio" : "film-studio film-studio-create"}>
      {document.querySelector(".workspace-title-slot") && createPortal(
        <div className="film-title-actions">
          <button type="button" className="film-library-button" onClick={() => setCharacterLibrary(true)}>
            <Icon name="person" size={18}/><span>角色库</span>
          </button>
          {id && <button type="button" className="film-title-new" onClick={onNew}>新建短片</button>}
        </div>,
        document.querySelector(".workspace-title-slot"),
      )}
      {characterLibrary && <CharacterLibrary request={request} onClose={() => setCharacterLibrary(false)}/>}
      {error && (
        <p className="film-error" role="alert">
          {error}
        </p>
      )}
      <div className={`film-layout ${id ? "is-project" : "is-create"}`}>
        <main>
          {id && !p ? <div className="film-restoring" role="status"><h2>{loaded ? "暂未找到该任务" : "正在读取成片任务…"}</h2></div> : !id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const { brandId, skillId, ...filmSettings } = form;
                void brandId; void skillId;
                action("", { ...filmSettings, videoResolution, requestId: crypto.randomUUID() });
              }}
            >
              <header className="film-create-heading">
                <div>
                  <h1>一键成片</h1>
                  <label htmlFor="film-story">故事梗概</label>
                </div>

              </header>
              <textarea
                id="film-story"
                required
                maxLength={12000}
                value={form.story}
                onChange={(e) => field("story", e.target.value)}
                placeholder="描述故事、人物、画面风格，以及希望人物说的话…"
              />
              <div className="film-style-field">
                <label id="film-style-label">视频风格</label>
                <div className="film-style-presets" role="group" aria-labelledby="film-style-label">
                  {filmStylePresets.map(({ label, prompt, image }) => (
                    <button
                      key={label}
                      type="button"
                      className={form.style === prompt ? "active" : undefined}
                      aria-pressed={form.style === prompt}
                      onClick={() => field("style", prompt)}
                    >
                      <img src={`/film-presets/${image}.webp`} alt="" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <section className="film-narrative-field" aria-labelledby="film-narrative-label">
                <label id="film-narrative-label">叙事风格</label>
                <div className="film-style-presets" role="group" aria-label="叙事风格预设">
                  {filmNarrativePresets.map((preset) => (
                    <button key={preset.id} type="button"
                      aria-pressed={form.narrativeStyleId === preset.id}
                      onClick={() => field("narrativeStyleId", form.narrativeStyleId === preset.id ? "" : preset.id)}>
                      <img src={`/film-presets/${preset.id}.webp`} alt="" />
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </section>
              <div className="film-create-settings">
                <ComposerSelect
                  label="成片时长"
                  value={form.duration}
                  options={[15, 30, 60, 90, 120].map((v) => ({
                    value: v,
                    label: v + "秒",
                  }))}
                  onChange={(v) => field("duration", v)}
                />
                <ComposerSelect
                  label="画面比例"
                  value={form.ratio}
                  options={[
                    { value: "16:9", label: "16:9 横屏" },
                    { value: "9:16", label: "9:16 竖屏" },
                  ]}
                  onChange={(v) => field("ratio", v)}
                />
                <ComposerSelect
                  label="图片模型"
                  value={form.imageModel}
                  options={[
                    { value: "gpt-image-2.5", label: "GPT Image 2.5" },
                    { value: VIBBIT_FLARE_MODEL, label: "GPT Image 2.5 Flare (2K)" },
                    { value: "nano-banana-2.1", label: "Nano Banana 2.1" },
                  ]}
                  onChange={(v) => field("imageModel", v)}
                />
                <ComposerSelect
                  label="视频模型"
                  value={form.videoModel}
                  options={FILM_VIDEO_MODELS}
                  onChange={(videoModel) => setForm((current) => ({
                    ...current,
                    videoModel,
                    videoResolution: filmVideoResolution(videoModel, current.videoResolution),
                  }))}
                />
                <ComposerSelect
                  label="视频分辨率"
                  value={videoResolution}
                  options={filmVideoResolutions(form.videoModel).map((value) => ({ value, label: value === '4k' ? '4K' : value }))}
                  onChange={(value) => field("videoResolution", value)}
                />
              </div>
              <div className="film-create-footer">
              <p className="film-caption">
                按模型实际用量计费。
              </p>
              <button
                className="film-primary"
                disabled={busy || !form.story.trim()}
              >
                {busy ? "正在创建…" : "一键生成成片"}
              </button>
              </div>
            </form>
          ) : (
            <FilmWorkbench key={p.id} project={p} lastSynced={lastSynced} request={request} onDownload={download} onProject={setProject}/>

          )}
        </main>
      </div>
    </section>
  );
}
