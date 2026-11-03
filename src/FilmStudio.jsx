import { filmShotState, filmTaskName } from '../shared/filmProgress.js';
import FilmProduction from './FilmProduction.jsx';
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
function Media({ project, file, video = false }) {
  const [url, setUrl] = useState(""), [mediaError, setMediaError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!file) return;
    setUrl("");
    setMediaError(false);
    let live = true,
      src;
    fetch(base() + `/api/films/${project}/files/${file}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
      .then((r) => {
        if (!r.ok) throw Error("读取素材失败");
        return r.blob();
      })
      .then((b) => {
        src = URL.createObjectURL(b);
        if (live) setUrl(src);
        else URL.revokeObjectURL(src);
      })
      .catch(() => { if (live) setMediaError(true); });
    return () => {
      live = false;
      if (src) URL.revokeObjectURL(src);
    };
  }, [project, file, retry]);
  return url ? (
    video ? (
      <video src={url} controls preload="metadata" />
    ) : (
      <img src={url} alt="制作素材" />
    )
  ) : (
    mediaError ? <button onClick={() => setRetry(v => v + 1)}>素材读取失败，点击重试</button> : <span>素材读取中…</span>
  );
}
function ShotStatus({ project, shot, index }) {
  const status = filmShotState(project, shot, index);
  return <div className={`film-shot-status ${status.state}`}><b><i aria-hidden="true"/>{status.label}</b><span>{status.detail}</span></div>;
}
const stages = {
  plan: "导演正在编写剧本与分镜",
  assets: "正在制作角色与场景",
  frames: "正在生成分镜首帧",
  videos: "正在制作视频镜头",
  quality: "正在检查人物、服装与场景",
  render: "正在合成成片",
  done: "成片已完成",
};
export default function FilmStudio({ user, onLogin }) {
  const selectedKey = "dgen-film-selected-user:" + user?.id;
  const viewKey = "dgen-film-view-user:" + user?.id;
  const initialId = () => new URLSearchParams(window.location.search).get("filmProject") || localStorage.getItem(selectedKey) || localStorage.getItem("dgen-film-selected-" + getAuthToken().slice(-12)) || "";
  const firstLoad = useRef(true);
  const firstSelectedId = useRef(initialId());
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
    [tab, setTab] = useState("shots"),
    [edits, setEdits] = useState({}),
    [change, setChange] = useState(""),
    [lastSynced, setLastSynced] = useState(0);
  const p = projects.find((p) => p.id === id),
    running = p && ["queued", "running"].includes(p.status);
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
    setEdits({});
  }, [id, selectedKey]);
  useEffect(() => {
    localStorage.setItem(viewKey, view);
    const url = new URL(window.location.href);
    if (view === "project" && id) url.searchParams.set("filmProject", id);
    else url.searchParams.delete("filmProject");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [id, view, viewKey]);
  function openProject(projectId) { setId(projectId); setView("project"); }
  useEffect(() => { if (p?.output) setTab("output"); }, [p?.id, p?.output]);
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
        <div className="film-header-actions"><button onClick={() => setView("tasks")}>任务列表{projects.length ? ` (${projects.length})` : ''}</button><button onClick={() => { setId(""); setView("create"); }}>新建短片</button></div>
      </header>
      {error && (
        <p className="film-error" role="alert">
          {error}
        </p>
      )}
      <div className="film-layout">
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
                {x.status === "failed"
                  ? "需要处理"
                  : x.status === "succeeded"
                    ? "已完成"
                    : stages[x.stage] || x.status}
              </small>
            </button>
          ))}
        </aside>
        <main>
          {!loaded && !p ? <div className="film-restoring" role="status"><h2>正在恢复制作任务</h2><p>正在读取后台保存的进度和素材…</p></div> : view === "tasks" ? <section className="film-task-overview" aria-label="成片任务列表"><h2>任务列表</h2><p>所有制作任务保存在账号中，刷新或离开页面后可继续查看。</p>{!projects.length ? <button className="film-primary" onClick={() => setView("create")}>创建第一个成片任务</button> : projects.map(task => <button className="film-task-row" key={task.id} onClick={() => openProject(task.id)}><div><b>{filmTaskName(task)}</b><small>{new Date(task.createdAt).toLocaleDateString('zh-CN')} · {task.duration}秒</small></div><span>{task.status === 'succeeded' ? '查看成片' : task.status === 'failed' ? '需要处理' : task.status === 'review' ? '待确认分镜' : task.status === 'cancelled' ? '已暂停' : stages[task.stage] || '等待调度'}</span></button>)}</section> : view === "project" && !p ? <div className="film-restoring"><h2>暂未找到该任务</h2><p>任务可能属于其他账号，请返回列表查看。</p><button onClick={() => setView("tasks")}>返回任务列表</button></div> : view === "create" ? (
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
              <div className="film-options">
                <ComposerSelect
                  label="成片时长"
                  value={form.duration}
                  options={[15, 30, 60].map((v) => ({
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
            <>
              <div className="film-project-heading"><h2>{filmTaskName(p)}</h2><span>{p.duration}秒 · {p.ratio === '16:9' ? '横屏' : '竖屏'}</span></div>
              <FilmProduction project={p} lastSynced={lastSynced} onStage={(stage) => setTab(stage === 'assets' ? 'assets' : stage === 'render' ? 'output' : 'shots')}/>
              {p.reviewWarning > 0 && (
                <p className="film-error">
                  有 {p.reviewWarning}{" "}
                  个镜头需要人工核对，可在分镜中查看检查说明。
                </p>
              )}
              {p.error && <p className="film-error">{p.error}</p>}
              <div className="film-actions film-production-actions">
                {running ? (
                  <button onClick={() => action("/" + p.id + "/cancel", {})}>
                    暂停后续制作
                  </button>
                ) : (
                  <button
                    className="film-primary"
                    disabled={busy || (Boolean(p.output) && !p.shots.some((s, i) => edits[i] !== undefined && edits[i] !== s.prompt))}
                    onClick={() =>
                      action("/" + p.id + "/resume", {
                        shots: p.shots.map((s, i) => ({
                          ...s,
                          prompt: edits[i] ?? s.prompt,
                        })),
                      })
                    }
                  >
                    {p.status === "failed" || p.status === "cancelled" ? "继续生成成片" : p.output ? "应用修改并重新成片" : "确认分镜，一键成片"}
                  </button>
                )}
                {p.output ? <><button className="film-primary" onClick={() => setTab("output")}>播放成片</button><button onClick={download}>下载成片 MP4</button></> : <span className="film-delivery-note">{running ? "完成后自动合成 MP4，无需逐镜头提交。" : "确认后自动完成素材、镜头与成片合成。"}</span>}
              </div>
              {!running && p.plan && (
                <div className="film-director">
                  <label>
                    和导演一起修改镜头
                    <textarea
                      aria-label="导演修改要求"
                      value={change}
                      onChange={(e) => setChange(e.target.value)}
                      placeholder="例如：把第3个镜头改为人物看向镜头，说出欢迎回家…"
                    />
                  </label>
                  <button
                    disabled={busy || !change.trim()}
                    onClick={() => {
                      action("/" + p.id + "/revise", { change });
                      setChange("");
                    }}
                  >
                    修改并重新制作受影响镜头
                  </button>
                </div>
              )}
              <nav className="film-tabs" aria-label="制作成果">
                {[
                  ["shots", "剧本与分镜"],
                  ["assets", "角色与场景"],
                  ["output", "成片"],
                ].map(([v, t]) => (
                  <button
                    className={tab === v ? "active" : ""}
                    onClick={() => setTab(v)}
                    key={v}
                  >
                    {t}
                  </button>
                ))}
              </nav>
              {tab === "shots" && (
                <>
                  {p.plan?.summary ? <p className="film-story-summary">{p.plan.summary}</p> : <div className="film-planning-state"><h3>导演正在安排这部短片</h3><p>制作计划返回后，会在这里逐一展示镜头、画面与对白。</p><div className="film-storyboard-skeleton" aria-hidden="true">{[1,2,3].map(i => <div key={i}><span>镜头 {i}</span><i/><i/></div>)}</div></div>}
                  <div className="film-grid">
                    {p.shots.map((s, i) => (
                      <article key={s.id}>
                        <h3>
                          镜头 {i + 1} <small>{s.duration}秒</small>
                        </h3>
                        <ShotStatus project={p} shot={s} index={i}/>
                        {s.video ? (
                          <Media project={p.id} file={s.video.file} video />
                        ) : s.frame ? (
                          <Media project={p.id} file={s.frame.file} />
                        ) : (
                          <div className="film-placeholder">等待制作</div>
                        )}
                        <textarea
                          aria-label={"镜头" + (i + 1) + "提示词"}
                          disabled={running}
                          value={edits[i] ?? s.prompt}
                          onChange={(e) =>
                            setEdits((x) => ({ ...x, [i]: e.target.value }))
                          }
                        />
                        {s.review && <p>画面检查：{s.review.summary}</p>}
                        {s.dialogue && <p>对白：{s.dialogue}</p>}
                        {!running && s.video && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              action("/" + p.id + "/resume", { redo: i })
                            }
                          >
                            仅重做此镜头
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                </>
              )}
              {tab === "assets" && (
                <div className="film-grid">
                  {p.assets.map((a) => (
                    <article key={a.id}>
                      <h3>{a.name}</h3>
                      {a.image && <Media project={p.id} file={a.image.file} />}
                      <textarea
                        disabled={running}
                        aria-label={a.name + "设定"}
                        value={edits["asset:" + a.id] ?? a.prompt}
                        onChange={(e) =>
                          setEdits((v) => ({
                            ...v,
                            ["asset:" + a.id]: e.target.value,
                          }))
                        }
                      />
                      {!running && (
                        <button
                          disabled={
                            busy || !(edits["asset:" + a.id] || "").trim()
                          }
                          onClick={() =>
                            action(
                              "/" +
                                p.id +
                                "/assets/" +
                                encodeURIComponent(a.id),
                              { prompt: edits["asset:" + a.id] },
                            )
                          }
                        >
                          更新设定并标记相关镜头
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {tab === "output" &&
                (p.output ? (
                  <Media project={p.id} file={p.output} video />
                ) : (
                  <div className="film-output-waiting"><span aria-hidden="true">▷</span><h3>{running ? "成片正在制作中" : "还没有生成成片"}</h3><p>全部镜头完成后，导演会自动合成 MP4，保留生成音轨并添加对白字幕。</p><small>完成后可在此播放或下载，无需自己拼接镜头。</small></div>
                ))}
            </>
          )}
        </main>
      </div>
    </section>
  );
}
