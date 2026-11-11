import {useEffect,useRef,useState} from 'react';
import FilmMedia from './FilmMedia.jsx';
export default function FilmStoryboard({project:p,selected,onSelect,send,renderEditor}) {
  const [editing,setEditing]=useState('');const cards=useRef({});const index=Math.max(0,p.shots.findIndex(s=>s.id===selected));
  useEffect(()=>{if(selected)cards.current[selected]?.scrollIntoView({block:'nearest',inline:'nearest'});},[selected]);
  if(!p.shots.length)return <div className="fw-empty">分镜任务完成后，所有镜头的图片和视频会直接展示在这里。</div>;
  return <section className="fw-storyboard-board" aria-label="全部分镜与视频"><header><div><h3>分镜与镜头视频</h3><p>{p.shots.length} 个镜头 · 图片、视频对应展示</p></div><div className="fw-actions"><button disabled={!index} onClick={()=>onSelect(p.shots[index-1].id)}>上一镜头</button><button disabled={index===p.shots.length-1} onClick={()=>onSelect(p.shots[index+1].id)}>下一镜头</button></div></header><div className="fw-storyboard-grid">{p.shots.map((s,i)=>{const jobs=p.activeJobs||[],frameWorking=jobs.some(j=>j.resourceId===s.id&&j.id.includes(':frame:'))||(p.status==='running'&&['frames','images'].includes(p.stage)&&s.frameTask&&!s.frame&&!s.frameError),videoWorking=jobs.some(j=>j.resourceId===s.id&&j.id.includes(':video:'))||(p.status==='running'&&s.videoTask&&!s.video&&!s.videoError);return <article ref={el=>cards.current[s.id]=el} key={s.id} tabIndex="0" className={selected===s.id?'selected':''} aria-label={`镜头 ${i+1}`} onFocus={()=>{if(selected!==s.id)onSelect(s.id);}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const n=Math.max(0,Math.min(p.shots.length-1,i+(e.key==='ArrowLeft'?-1:1)));onSelect(p.shots[n].id);cards.current[p.shots[n].id]?.focus();}}><div className="fw-shot-card-heading"><b>镜头 {i+1}</b><small>{s.time||'时间见镜头描述'} · {s.duration}秒{s.locked?' · 已锁定':''}</small></div><div className="fw-shot-media"><span>分镜图片</span>{s.frame?<FilmMedia project={p.id} file={s.frame.file}/>:<div className={`fw-shot-wait ${frameWorking?'working':''}`}>{frameWorking?'图片生成中…':s.frameError?'图片生成失败':s.paused?'已暂停':'等待生成图片'}</div>}</div><div className="fw-shot-media"><span>镜头视频</span>{s.video?<FilmMedia project={p.id} file={s.video.file} video/>:<div className={`fw-shot-wait ${videoWorking?'working':''}`} role={videoWorking?'status':undefined}>{videoWorking?'视频生成中…':s.videoError?'视频生成失败':s.paused?'已暂停':s.frame?'等待生成视频':'分镜图片完成后生成视频'}</div>}</div><ShotRetries project={p} shot={s} send={send}/>{jobs.some(j=>j.resourceId===s.id&&j.id.includes(':review:'))?<p className="fw-shot-review" role="status">镜头审核中…</p>:s.review&&<details className="fw-shot-review" open={selected===s.id || undefined}><summary>{s.review.status==='pass'?'已完成审核':'有审核问题'}</summary><p>{s.review.summary}</p></details>}{s.dialogue&&<p className="fw-shot-line">对白：{s.dialogue}</p>}<div className="fw-actions">{[['frame','重做图片'],['tail','重做尾帧'],['video','重做视频'],['audio','重做音轨']].map(([kind,label])=>s[kind]?.file&&<button key={kind} disabled={s.locked || s.paused || s.stale || Boolean(p.replacement) || ['running','queued','pausing'].includes(p.status)} onClick={()=>send('redo-media',{id:s.id,kind})}>{label}</button>)}<button onClick={()=>{onSelect(s.id);setEditing(editing===s.id?'':s.id);}}>{editing===s.id?'收起编辑':'编辑此镜头'}</button><button onClick={()=>onSelect(s.id)}>选为导演修改目标</button></div>{editing===s.id&&<div className="fw-shot-inline-editor">{renderEditor(s)}</div>}</article>;})}</div></section>;
}


const retryLabels = {frame:'分镜图片', tail:'尾帧', video:'镜头视频'};
function ShotRetries({project, shot, send}) {
  const failures = Object.keys(retryLabels).filter(kind =>
    !shot[kind] && shot[kind + 'Error'] &&
    !project.activeJobs?.some(job => job.id === `${shot.id}:${kind}:v${shot.revision || 1}`));
  if (!failures.length) return null;
  return <div className="fw-actions">{failures.map(kind => {
    const uncertain = shot[kind + 'Submitting'] && !shot[kind + 'Task'];
    const paused = project.schedulingPaused || shot.paused || shot.stale ||
      project.pausedStages?.[kind === 'video' ? 'videos' : 'images'];
    return uncertain ? <small key={kind}>{retryLabels[kind]}提交待核对</small>
      : <button key={kind} type="button" disabled={paused || shot.locked}
          onClick={() => send('retry-shot',{id:shot.id,kind,revision:shot.revision || 1})}>
          重试{retryLabels[kind]}
        </button>;
  })}</div>;
}
