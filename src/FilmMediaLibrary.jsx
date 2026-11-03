import {useState} from 'react';
import {filmMediaIndex} from '../shared/filmMediaIndex.js';
import FilmMedia from './FilmMedia.jsx';
import {FileButton} from './FilmEditor.jsx';
export default function FilmMediaLibrary({project:p,onSelect}) {
 const [filter,setFilter]=useState('all'),[history,setHistory]=useState(false);
 const all=filmMediaIndex(p,history),items=all.filter(item=>filter==='all'||item.kind===filter);
 return <section className="fw-media-library" aria-label="项目素材库"><header><h3>素材库</h3><p>此项目的图片、视频和音频集中管理，分镜页仍保留图与视频对应预览。</p></header><div className="fw-library-filters">{[['all','全部'],['image','图片'],['video','视频'],['audio','音频']].map(([id,name])=><button key={id} className={filter===id?'active':''} onClick={()=>setFilter(id)}>{name} {id==='all'?all.length:all.filter(m=>m.kind===id).length}</button>)}<label><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)}/>包含历史版本</label></div><div className="fw-library-grid">{items.map(m=><article key={m.id}><FilmMedia project={p.id} file={m.file} video={m.kind==='video'} audio={m.kind==='audio'}/><b>{m.name}</b><small>{m.current?'当前素材':'历史版本'}{m.version?` · v${m.version}`:''}</small><div className="fw-actions"><FileButton project={p.id} file={m.file}/>{m.resourceId&&<button onClick={()=>onSelect(m.resourceId)}>定位到对应成果</button>}</div></article>)}</div>{!items.length&&<div className="fw-empty">此类素材生成或上传完成后，会自动加入。</div>}</section>;
}
