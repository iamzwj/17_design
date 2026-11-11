import {useEffect,useState,useRef} from "react";
import {getAuthToken} from "./api.js";
const base=()=>String(import.meta.env.VITE_API_BASE_URL||"").replace(/\/$/,"");
export default function FilmMedia({ project, file, characterId, video = false, audio = false }) {
  const [url, setUrl] = useState(""), [mediaError, setMediaError] = useState(false), [retry, setRetry] = useState(0);
  const container=useRef(null);const [visible,setVisible]=useState(false);
  useEffect(()=>{if(!('IntersectionObserver' in window)){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});if(container.current)observer.observe(container.current);return()=>observer.disconnect();},[]);
  useEffect(() => {
    if ((!file && !characterId) || !visible) return;
    setUrl("");
    setMediaError(false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let live = true,
      src;
    fetch(base() + (characterId ? `/api/films/characters/${characterId}/image` : `/api/films/${project}/media/${file}`), {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
      .then((r) => {
        if (!r.ok) throw Error("读取素材失败");
        return characterId ? r.blob() : r.json();
      })
      .then((result) => {
        if (characterId) {
          src = URL.createObjectURL(result);
          if (live) setUrl(src);
          else URL.revokeObjectURL(src);
        } else {
          if (!result.url) throw Error("素材链接不可用");
          if (live) setUrl(base() + result.url);
        }
      })
      .catch(() => { if (live) setMediaError(true); })
      .finally(() => clearTimeout(timeout));
    return () => {
      live = false;
      clearTimeout(timeout);
      controller.abort();
      if (src) URL.revokeObjectURL(src);
    };
  }, [project, file, characterId, retry, visible]);
  return <div className="film-media" ref={container}>{url ? (
    audio ? <audio onError={() => { setUrl(""); setMediaError(true); }} src={url} controls preload="metadata"/> : video ? (
      <video onError={() => { setUrl(""); setMediaError(true); }} src={url} controls preload="metadata" />
    ) : (
      <img onError={() => { setUrl(""); setMediaError(true); }} src={url} alt="制作素材" />
    )
  ) : (
    mediaError ? <button onClick={() => setRetry(v => v + 1)}>素材读取失败，点击重试</button> : <span>素材读取中…</span>
  )}</div>;
}
