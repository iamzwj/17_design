import {useEffect,useState} from "react";
import {getAuthToken} from "./api.js";
const base=()=>String(window.XIAODIE_CONFIG?.API_BASE_URL||import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");
export default function FilmMedia({ project, file, video = false, audio = false }) {
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
    audio ? <audio src={url} controls preload="metadata"/> : video ? (
      <video src={url} controls preload="metadata" />
    ) : (
      <img src={url} alt="制作素材" />
    )
  ) : (
    mediaError ? <button onClick={() => setRetry(v => v + 1)}>素材读取失败，点击重试</button> : <span>素材读取中…</span>
  );
}
