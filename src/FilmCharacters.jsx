import { userError } from './userErrors.js'
import { useEffect, useRef, useState } from "react";
import FilmMedia from "./FilmMedia.jsx";
import "./filmCharacters.css";

export function WarehouseIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13H3Zm4 0V11h10v10M7 15h10M7 18h10"/></svg>;
}

export function readImage(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024)
    throw Error("请上传 10 MB 以内的 PNG、JPEG 或 WebP 图片");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("图片读取失败，请重试"));
    reader.readAsDataURL(file);
  });
}

function UploadButton({ label, disabled, onFile }) {
  const input = useRef(null);
  return <>
    <button type="button" disabled={disabled} onClick={() => input.current.click()}>{label}</button>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (file) onFile(file);
    }}/>
  </>;
}

export function CharacterLibrary({ request, onClose, onSelect, roleName }) {
  const dialog = useRef(null);
  const [data, setData] = useState(null);
  const [section, setSection] = useState("personal");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    request("/characters").then((result) => {
      if (active) setData(result);
    }).catch((error) => {
      if (active) setError(userError(error.message));
    });
    return () => { active = false; };
  }, [request, retry]);
  async function perform(work) {
    setBusy(true);
    setError("");
    try { await work(); }
    catch (error) { setError(userError(error.message)); }
    finally { setBusy(false); }
  }
  const items = section === "brand" ? data?.brandIPs : data?.characters;
  return <dialog ref={dialog} className="film-character-dialog" aria-labelledby="film-character-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header>
      <div><h2 id="film-character-title">{roleName ? "为「" + roleName + "」选择形象" : "角色库"}</h2></div>
      <button disabled={busy} onClick={onClose}>关闭</button>
    </header>
    <div className="film-character-actions">
      <button aria-pressed={section === "personal"} onClick={() => setSection("personal")}>我的角色</button>
      <button aria-pressed={section === "brand"} onClick={() => setSection("brand")}>品牌 IP</button>
      {section === "personal" && <UploadButton label={busy ? "处理中…" : "上传角色"} disabled={busy || !data} onFile={(file) => perform(async () => {
        const { character } = await request("/characters", { name: file.name.replace(/\.[^.]+$/, ""), image: await readImage(file) });
        setData((current) => ({ ...current, characters: [character, ...current.characters] }));
      })}/>}
    </div>
    {error && <p className="film-error" role="alert">{error}</p>}
    {!data && (error ? <button onClick={() => { setError(""); setRetry((value) => value + 1); }}>重新读取</button> : <p role="status">正在读取角色库…</p>)}
    {items?.length === 0 && <p>{section === "brand" ? "素材库暂无可用的品牌 IP 图片。" : "上传图片，或在生成的角色图上选择「加入角色库」。"}</p>}
    <div className="film-character-grid">
      {items?.map((item) => <article key={item.id}>
        {item.source === "brand" ? <img src={item.file} alt={item.name} loading="lazy"/> : <FilmMedia characterId={item.id}/>}
        <b>{item.name}</b>
        {onSelect && <button disabled={busy} onClick={() => perform(() => onSelect(item))}>使用此形象</button>}
      </article>)}
    </div>
  </dialog>;
}

export function CharacterDecision({ project, request, send, busy }) {
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(null);
  const custom = project.characterMode === "custom";
  const pending = waiting && !project.appliedCommands?.includes(waiting);
  const disabled = busy || uploading || Boolean(pending);
  async function reference(id, body) {
    const result = await request("/" + project.id + "/character-reference", { id, ...body });
    setWaiting(result.commandId);
  }
  async function choose(body) {
    if (await send("character-mode", body)) return;
    setError("角色制作方式未保存，请重试。");
  }
  return <section className="film-character-decision" aria-label="导演确认角色">
    <h3>{custom ? "为角色指定形象" : "是否自定义角色？"}</h3>
    {custom && <p>未指定的角色将自动生成。</p>}
    {error && <p className="film-error" role="alert">{error}</p>}
    {pending && <p role="status">正在保存角色参考…</p>}
    {custom && <div className="film-character-grid">
      {project.resources.filter((role) => role.type === "face").map((role) => <article key={role.id}>
        <b>{project.characters?.find((item) => item.id === role.sourceId)?.name || role.name}</b>
        {role.characterReference && <><FilmMedia project={project.id} file={role.characterReference.file}/><small>{role.characterReference.name}</small></>}
        <div className="film-character-actions">
          <UploadButton label="上传图片" disabled={disabled} onFile={async (file) => {
            setUploading(true);
            setError("");
            try { await reference(role.id, { image: await readImage(file) }); }
            catch (error) { setError(userError(error.message)); }
            finally { setUploading(false); }
          }}/>
          <button disabled={disabled} onClick={() => setSelected(role)}>角色库</button>
        </div>
      </article>)}
    </div>}
    <div className="film-character-actions">
      {custom ? <button className="film-primary" disabled={disabled} onClick={() => send("resume")}>开始生成角色与成片</button> : <>
        <button disabled={disabled} onClick={() => choose({ custom: false })}>否，继续自动制作</button>
        <button className="film-primary" disabled={disabled} onClick={() => choose({ custom: true })}>是，自定义角色</button>
      </>}
    </div>
    {selected && <CharacterLibrary request={request} roleName={selected.name} onClose={() => setSelected(null)} onSelect={async (item) => {
      await reference(selected.id, { characterId: item.id, source: item.source });
      setSelected(null);
    }}/>}
  </section>;
}

export function SaveCharacterButton({ project, asset, request, notice }) {
  const [state, setState] = useState("idle");
  const dialog = useRef(null);
  const label = state === "saved" ? "已加入角色库" : "加入角色库";
  async function save() {
    setState("saving");
    try {
      await request("/characters", { projectId: project, assetId: asset });
      setState("saved");
      dialog.current.close();
      notice("已加入角色库");
    } catch (error) {
      setState("idle");
      notice(userError(error.message));
    }
  }
  return <>
    <button className="film-character-save" type="button" title={label} aria-label={label} disabled={state !== "idle"} onClick={() => dialog.current.showModal()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill={state === "saved" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>
    </button>
    <dialog ref={dialog} className="film-character-dialog film-character-confirm" aria-label="加入角色库" onCancel={event => { if (state === "saving") event.preventDefault(); }}>
      <h2>加入角色库</h2>
      <div className="film-character-actions">
        <button type="button" disabled={state === "saving"} onClick={() => dialog.current.close()}>取消</button>
        <button type="button" className="film-primary" disabled={state === "saving"} onClick={save}>{state === "saving" ? "正在加入…" : "确认"}</button>
      </div>
    </dialog>
  </>;
}
