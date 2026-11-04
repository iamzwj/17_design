import { CharacterLibrary, WarehouseIcon } from "./FilmCharacters.jsx";
import {filmStatusLabel} from '../shared/filmPresentation.js';
import {knowledgeRequest} from './knowledgeApi.js';
import { filmTaskName } from '../shared/filmProgress.js';
import FilmWorkbench from './FilmWorkbench.jsx';
import { useEffect, useRef, useState } from "react";
import { getAuthToken } from "./api.js";
import ComposerSelect from "./ComposerSelect.jsx";
import "./filmStudio.css";
const base = () =>
  String(
    window.XIAODIE_CONFIG?.API_BASE_URL ||
      import.meta.env.VITE_API_BASE_URL ||
      "",
  ).replace(/\/$/, "");
async function request(path = "", body) {
  const r = await fetch(base() + "/api/films" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "读取制作项目失败");
  return d;
}
export default function FilmStudio({ user, onLogin }) {
  const [characterLibrary, setCharacterLibrary] = useState(false);
  const selectedKey = "dgen-film-selected-user:" + user?.id;
  const viewKey = "dgen-film-view-user:" + user?.id;
  const initialId = () => new URLSearchParams(window.location.search).get("filmProject") || localStorage.getItem(selectedKey) || localStorage.getItem("dgen-film-selected-" + getAuthToken().slice(-12)) || "";
  const firstLoad = useRef(true);
  const firstSelectedId = useRef(initialId());
  const [references,setReferences]=useState({brands:[],skills:[]});
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState(() => new URLSearchParams(window.location.search).get("filmProject") ? "project" : localStorage.getItem(viewKey) || (initialId() ? "project" : "tasks"));
  const [projects, setProjects] = useState([]),
    [id, setId] = useState(initialId),
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
            automatic: true,
          }
        );
      } catch {
        return {
          story: "",
          duration: 30,
          ratio: "16:9",
          imageModel: "gpt-image-2.5",
          videoModel: "minimax-h3",
          automatic: true,
        };
      }
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [lastSynced, setLastSynced] = useState(0);
  const p = projects.find((p) => p.id === id);
  useEffect(() => {
    if (!user) return;
    let live = true;
    const refresh = () =>
      request()
        .then((d) => {
          if (live) {
            setProjects(previous => [...d.projects, ...previous.filter(old => !d.projects.some(item => item.id === old.id))]); setLastSynced(Date.now()); setLoaded(true);
            if (firstLoad.current) {
              firstLoad.current = false;
              if (!d.projects.length && !firstSelectedId.current) setView("create");
            }
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    refresh();
    const t = setInterval(refresh, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [user]);
  useEffect(() => {
    localStorage.setItem(
      "dgen-film-draft-" + getAuthToken().slice(-12),
      JSON.stringify(form),
    );
  }, [form]);
  useEffect(() => {
    localStorage.setItem(selectedKey, id);

  }, [id, selectedKey]);
  useEffect(() => {
    localStorage.setItem(viewKey, view);
    const url = new URL(window.location.href);
    if (view === "project" && id) url.searchParams.set("filmProject", id);
    else url.searchParams.delete("filmProject");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [id, view, viewKey]);
  function openProject(projectId) { setId(projectId); setView("project"); }

  useEffect(()=>{if(!user)return;let live=true;Promise.allSettled([knowledgeRequest('/brands'),fetch(base()+'/api/skills?target=video',{headers:{Authorization:`Bearer ${getAuthToken()}`}}).then(r=>r.json())]).then(results=>{if(live)setReferences({brands:results[0].status==='fulfilled'?results[0].value.brands||[]:[],skills:results[1].status==='fulfilled'?results[1].value.skills||[]:[]});});return()=>{live=false;};},[user]);
  const field = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function action(path, body) {
    setBusy(true);
    setError("");
    try {
      const d = await request(path, body);
      if (d.project) {
        setProjects((ps) => [
          d.project,
          ...ps.filter((x) => x.id !== d.project.id),
        ]);
        openProject(d.project.id);
      }
    } catch (e) {
      setError(e.message);
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
      setError(e.message);
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
      <header>
        <div>
          <small>AI 导演工作台</small>
          <h1>一键成片</h1>
          <p>把故事变成一部短片，让角色、场景与镜头共同讲述。</p>
        </div>
        <div className="film-header-actions"><button onClick={() => setCharacterLibrary(true)}><WarehouseIcon/> 角色库</button><button onClick={() => setView("tasks")}>任务列表{projects.length ? ` (${projects.length})` : ''}</button><button onClick={() => { setId(""); setView("create"); }}>新建短片</button></div>
      </header>
      {characterLibrary && <CharacterLibrary request={request} onClose={() => setCharacterLibrary(false)}/>}
      {error && (
        <p className="film-error" role="alert">
          {error}
        </p>
      )}
      <div className={`film-layout ${view === "project" ? "is-project" : ""}`}>
        <aside>
          <h3>任务列表</h3>
          {!loaded ? <p role="status">正在恢复任务…</p> : !projects.length && <p>开始制作后，任务会自动保存在这里。</p>}
          {projects.map((x) => (
            <button
              key={x.id}
              className={view === "project" && id === x.id ? "active" : ""}
              onClick={() => openProject(x.id)}
            >
              <b title={filmTaskName(x)}>{filmTaskName(x)}</b>
              <small>
                {filmStatusLabel(x)}
              </small>
            </button>
          ))}
        </aside>
        <main>
          {!loaded && !p ? <div className="film-restoring" role="status"><h2>正在恢复制作任务</h2><p>正在读取后台保存的进度和素材…</p></div> : view === "tasks" ? <section className="film-task-overview" aria-label="成片任务列表"><h2>任务列表</h2><p>所有制作任务保存在账号中，刷新或离开页面后可继续查看。</p>{!projects.length ? <button className="film-primary" onClick={() => setView("create")}>创建第一个成片任务</button> : projects.map(task => <button className="film-task-row" key={task.id} onClick={() => openProject(task.id)}><div><b>{filmTaskName(task)}</b><small>{new Date(task.createdAt).toLocaleDateString('zh-CN')} · {task.duration}秒</small></div><span>{filmStatusLabel(task)}</span></button>)}</section> : view === "project" && !p ? <div className="film-restoring"><h2>暂未找到该任务</h2><p>任务可能属于其他账号，请返回列表查看。</p><button onClick={() => setView("tasks")}>返回任务列表</button></div> : view === "create" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action("", { ...form, requestId: crypto.randomUUID() });
              }}
            >
              <h2>从一个故事开始</h2>
              <textarea
                required
                maxLength={12000}
                value={form.story}
                onChange={(e) => field("story", e.target.value)}
                placeholder="描述故事、人物、画面风格，以及希望人物说的话…"
              />
              <label className="film-style-field">视频风格<input value={form.style||"电影写实"} maxLength={200} onChange={e=>field("style",e.target.value)} placeholder="如电影写实、温暖动画、纪实摄影"/></label>
              <div className="film-options"><ComposerSelect label="品牌规范" value={form.brandId||''} options={[{value:'',label:'不关联品牌'},...references.brands.map(b=>({value:b.id,label:b.name}))]} onChange={v=>field('brandId',v)}/><ComposerSelect label="创作Skill" value={form.skillId||''} options={[{value:'',label:'不使用 Skill'},...references.skills.map(s=>({value:s.id,label:s.title}))]} onChange={v=>field('skillId',v)}/></div>
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
              <p>
                导演模型：Gemini 3.1
                Pro。对白、环境音随视频生成，实际发音和口型需在成片中核对。
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={!form.automatic}
                  onChange={(e) => field("automatic", !e.target.checked)}
                />{" "}
                仅生成分镜，确认后再制作成片
              </label>
              <p className="film-caption">
                将调用所选模型生成角色、场景、分镜图和视频，按供应商实际用量计费。离开页面后后台继续制作。
              </p>
              <button
                className="film-primary"
                disabled={busy || !form.story.trim()}
              >
                {busy ? "正在创建…" : form.automatic ? "一键生成成片" : "生成分镜"}
              </button>
            </form>
          ) : (
            <FilmWorkbench key={p.id} project={p} lastSynced={lastSynced} request={request} onDownload={download} onProject={(project)=>setProjects(all=>[project,...all.filter(item=>item.id!==project.id)])}/>

          )}
        </main>
      </div>
    </section>
  );
}
