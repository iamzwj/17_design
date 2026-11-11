import { editFilmClips, filmClipDuration } from '../shared/filmTimelineEditing.js';
import {useEffect,useRef,useState} from 'react';
import ComposerSelect from './ComposerSelect.jsx';
import {filmUpload} from './filmUpload.js';
import FilmMedia from './FilmMedia.jsx';
import FilmVideoTrack from './FilmVideoTrack.jsx';
export default function FilmTimeline({project:p,request,send,onSelect,notice}) {
  const storage=`film-timeline:${p.id}:${p.timeline?.revision||0}`;
  const initial=()=>{try{const saved=JSON.parse(localStorage.getItem(storage));if(saved)return saved;}catch{/* use server version */}return {...p.timeline,clips:p.timeline?.clips?.length?p.timeline.clips:p.shots.map(s=>({shotId:s.id,trimIn:0,duration:filmClipDuration(s)})),tracks:p.timeline?.tracks||[],captions:p.timeline?.captions||[]};};
  const [draft,setDraft]=useState(initial),[dirty,setDirty]=useState(()=>Boolean(localStorage.getItem(storage))),[uploading,setUploading]=useState(false),[kind,setKind]=useState('music');
  const pendingSave=useRef(null), undo=useRef([]), redo=useRef([]);
  const serverValue=JSON.stringify(p.timeline);
  useEffect(()=>{if(!dirty)setDraft(initial());},[serverValue,dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(dirty)localStorage.setItem(storage,JSON.stringify(draft));},[draft,dirty,storage]);
  function edit(next){undo.current.push(draft);redo.current=[];setDirty(true);setDraft(next);}
  useEffect(() => {
    if (!pendingSave.current || (p.timeline?.revision || 0) <= pendingSave.current.revision) return;
    const clean = value => JSON.stringify({clips:value?.clips,tracks:value?.tracks,captions:value?.captions,captionMode:value?.captionMode});
    if (clean(p.timeline) !== clean(pendingSave.current.value)) return;
    localStorage.removeItem(pendingSave.current.key);
    if (clean(draft) === clean(pendingSave.current.value)) {
      localStorage.removeItem(storage);
      setDirty(false);
      setDraft(p.timeline);
    }
    pendingSave.current=null;
  }, [serverValue, draft, storage, p.timeline]);
  async function saveTimeline() {
    pendingSave.current={value:draft,revision:p.timeline?.revision || 0,key:storage};
    if (!await send('timeline',{timeline:draft})) pendingSave.current=null;
  }
  const track=(i,key,value)=>edit({...draft,tracks:draft.tracks.map((c,n)=>n===i?{...c,[key]:value}:c)});
  const caption=(i,key,value)=>edit({...draft,captionMode:'manual',captions:draft.captions.map((c,n)=>n===i?{...c,[key]:value}:c)});
  async function upload(file){if(!file)return;setUploading(true);try{const result=await filmUpload(request,p.id,file,'audio');edit({...draft,tracks:[...draft.tracks,{id:crypto.randomUUID(),file:result.file,name:file.name,kind,start:0,volume:kind==='music'?.2:1,loop:kind==='music'}]});}catch(e){notice(e.message);}finally{setUploading(false);}}
  return <section className="fw-timeline" aria-label="剪辑时间线"><header className="fw-timeline-heading">剪辑时间线 <span>{draft.clips.length} 个片段 · {draft.clips.reduce((n,c)=>n+Number(c.duration),0).toFixed(1)}秒</span>{dirty&&<b>有未保存修改</b>}</header><div className="fw-timeline-content"><h4>视频轨道</h4>
    <FilmVideoTrack project={p} clips={draft.clips} onChange={clips=>edit(editFilmClips(draft,clips))}
      canUndo={undo.current.length>0} canRedo={redo.current.length>0}
      onUndo={()=>{if(!undo.current.length)return;redo.current.push(draft);setDraft(undo.current.pop());setDirty(true);}}
      onRedo={()=>{if(!redo.current.length)return;undo.current.push(draft);setDraft(redo.current.pop());setDirty(true);}} onSelect={onSelect}/>
    <h4>对白、配音、音乐与环境音</h4>{draft.tracks.map((t,i)=><div className="fw-track" key={t.id}><b>{({music:'音乐',voice:'配音',ambience:'环境音'})[t.kind]} · {t.name}</b><FilmMedia project={p.id} file={t.file} audio/><label>开始（秒）<input type="number" min="0" value={t.start} onChange={e=>track(i,'start',Number(e.target.value))}/></label><label>音量<input type="number" min="0" max="2" step=".1" value={t.volume} onChange={e=>track(i,'volume',Number(e.target.value))}/></label><label><input type="checkbox" checked={Boolean(t.loop)} onChange={e=>track(i,'loop',e.target.checked)}/>循环</label><button onClick={()=>edit({...draft,tracks:draft.tracks.filter((_,n)=>n!==i)})}>移除音轨</button></div>)}<div className="fw-actions"><ComposerSelect portal label="音轨类型" value={kind} options={[{value:'music',label:'背景音乐'},{value:'voice',label:'独立配音'},{value:'ambience',label:'环境音'}]} onChange={setKind}/><label className="fw-file-control">{uploading?'正在上传…':'上传音频'}<input aria-label="上传音频" disabled={uploading} accept="audio/*" type="file" onChange={e=>void upload(e.target.files[0])}/></label></div>
    <details><summary>字幕与对齐（{draft.captions.length} 条）</summary>{draft.captions.length===0&&<p>声音制作后自动加入字幕，也可手动添加。</p>}{draft.captions.map((c,i)=><div className="fw-caption-row" key={i}><label>开始<input type="number" min="0" step=".1" value={c.start} onChange={e=>caption(i,'start',Number(e.target.value))}/></label><label>结束<input type="number" min="0" step=".1" value={c.end} onChange={e=>caption(i,'end',Number(e.target.value))}/></label><input aria-label={`字幕${i+1}`} value={c.text} onChange={e=>caption(i,'text',e.target.value)}/><button onClick={()=>edit({...draft,captionMode:'manual',captions:draft.captions.filter((_,n)=>n!==i)})}>删除</button></div>)}<button onClick={()=>edit({...draft,captionMode:'manual',captions:[...draft.captions,{start:0,end:2,text:''}]})}>添加字幕</button></details>
    <div className="fw-actions"><button className="film-primary" disabled={!draft.clips.length} onClick={saveTimeline}>保存时间线并重新导出</button></div></div></section>;
}
