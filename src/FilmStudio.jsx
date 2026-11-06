import { userError, localizeErrors } from './userErrors.js'
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';
import { CharacterLibrary } from "./FilmCharacters.jsx";
import {knowledgeRequest} from './knowledgeApi.js';
import { filmTaskName } from '../shared/filmProgress.js';
import FilmWorkbench from './FilmWorkbench.jsx';
import { useEffect, useState } from "react";
import { getAuthToken } from "./api.js";
import ComposerSelect from "./ComposerSelect.jsx";
import "./filmStudio.css";
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
export default function FilmStudio({ user, onLogin, projectId, onCreated, onNew }) {
  const [characterLibrary, setCharacterLibrary] = useState(false);
  const [references,setReferences]=useState({brands:[],skills:[]});
  const [loaded, setLoaded] = useState(false);
  const [project, setProject] = useState(null);
  const [id, setId] = useState(projectId || ""),
    [form, setForm] = useState(() => {
      try {
        return (
          JSON.parse(
            localStorage.getItem(
              "dgen-film-draft-" + getAuthToken().slice(-12),
            ),
          ) || {
            story: "",
            duration: 30,
            ratio: "16:9",
            imageModel: "gpt-image-2.5",
            videoModel: "minimax-h3",
          }
        );
      } catch {
        return {
          story: "",
          duration: 30,
          ratio: "16:9",
          imageModel: "gpt-image-2.5",
          videoModel: "minimax-h3",
        };
      }
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [lastSynced, setLastSynced] = useState(0);
  const p = project?.id === id ? project : null;
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

  useEffect(()=>{if(!user)return;let live=true;Promise.allSettled([knowledgeRequest('/brands'),fetch(base()+'/api/skills?target=video',{headers:{Authorization:`Bearer ${getAuthToken()}`}}).then(r=>r.json())]).then(results=>{if(live)setReferences({brands:results[0].status==='fulfilled'?results[0].value.brands||[]:[],skills:results[1].status==='fulfilled'?results[1].value.skills||[]:[]});});return()=>{live=false;};},[user]);
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
    <section className="film-studio">
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
                action("", { ...form, requestId: crypto.randomUUID() });
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
              <label className="film-style-field">视频风格<input value={form.style||"电影写实"} maxLength={200} onChange={e=>field("style",e.target.value)} placeholder="如电影写实、温暖动画、纪实摄影"/></label>
              <div className="film-options film-context-options"><ComposerSelect label="品牌规范" value={form.brandId||''} options={[{value:'',label:'不关联品牌'},...references.brands.map(b=>({value:b.id,label:b.name}))]} onChange={v=>field('brandId',v)}/><ComposerSelect label="创作Skill" value={form.skillId||''} options={[{value:'',label:'不使用 Skill'},...references.skills.map(s=>({value:s.id,label:s.title}))]} onChange={v=>field('skillId',v)}/></div>
              <div className="film-options">
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
                    { value: "nano-banana-2.1", label: "Nano Banana 2.1" },
                  ]}
                  onChange={(v) => field("imageModel", v)}
                />
                <ComposerSelect
                  label="视频模型"
                  value={form.videoModel}
                  options={[
                    { value: "minimax-h3", label: "MiniMax H3" },
                    { value: "wan-3.0", label: "Wan 3.0" },
                  ]}
                  onChange={(v) => field("videoModel", v)}
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
