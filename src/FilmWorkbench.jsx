import { userError } from './userErrors.js'
import { CharacterDecision } from "./FilmCharacters.jsx";
import FilmActivity from './FilmActivity.jsx';
import {filmMediaIndex} from '../shared/filmMediaIndex.js';
import {useEffect,useRef,useState} from 'react';
import {workflowStages} from '../shared/filmWorkflow.js';
import {filmTaskName} from '../shared/filmProgress.js';
import FilmEditor from './FilmEditor.jsx';
import FilmTimeline from './FilmTimeline.jsx';
import ComposerSelect from './ComposerSelect.jsx';
import './filmWorkbench.css';
const labels={queued:'等待调度',running:'正在制作',pausing:'正在暂停调度',paused:'已暂停',cancelled:'已暂停',failed:'执行失败',review:'等待分镜确认','needs-input':'需要人工处理',succeeded:'成片已完成'};
export default function FilmWorkbench({project:p,lastSynced,request,onProject,onDownload}) {
  const key='film-workbench:'+p.id;
  const [stage,setStage]=useState(()=>{const value=localStorage.getItem(key+':stage')||'script';return ['images','videos','audio'].includes(value)?'media':value;}),[selected,setSelected]=useState(()=>localStorage.getItem(key+':selected')||''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[limit,setLimit]=useState(60),[panel,setPanel]=useState(()=>localStorage.getItem(key+':panel')||'conversation'),[settings,setSettings]=useState(false);
  const [timelineOpen,setTimelineOpen]=useState(null);
  const timelinePanel = useRef(null);
  const timelineTrigger = useRef(null);
  useEffect(() => {
    function placeTimeline() {
      const trigger = timelineTrigger.current;
      const sheet = timelinePanel.current;
      if (!trigger || !sheet) return;
      const rect = trigger.getBoundingClientRect();
      const nav = trigger.closest('nav')?.getBoundingClientRect();
      const left = Math.max(rect.right, nav?.right || 0) + 12;
      const narrow = window.innerWidth - left < 240;
      sheet.style.left = narrow ? '12px' : left + 'px';
      sheet.style.right = '12px';
      sheet.style.bottom = narrow ? Math.max(12, window.innerHeight - rect.top + 12) + 'px' : '12px';
      sheet.style.maxHeight = Math.max(120, (narrow ? rect.top - 24 : window.innerHeight - 36)) + 'px';
    }
    placeTimeline();
    window.addEventListener('resize', placeTimeline);
    window.addEventListener('scroll', placeTimeline, true);
    const observer = new ResizeObserver(placeTimeline);
    if (timelineTrigger.current) observer.observe(timelineTrigger.current);
    return () => {
      window.removeEventListener('resize', placeTimeline);
      window.removeEventListener('scroll', placeTimeline, true);
      observer.disconnect();
    };
  }, [timelineOpen]);

  useEffect(() => {
    if (!timelineOpen) return;
    function dismissOutside(event) {
      if (timelinePanel.current?.contains(event.target) || event.target.closest?.('[data-fw-timeline-trigger], .film-floating-menu')) return;
      setTimelineOpen(false);
    }
    document.addEventListener('click', dismissOutside, true);
    return () => document.removeEventListener('click', dismissOutside, true);
  }, [timelineOpen]);
  function closeTimeline() {
    setTimelineOpen(false);
    timelineTrigger.current?.focus();
  }
  const hasStarted = (stage) => stage.done > 0 ||
    (stage.active && ['running', 'pausing'].includes(p.status)) ||
    (stage.id === 'storyboard' && p.shots.some(shot => shot.frame || shot.video || shot.frameTask || shot.frameError || shot.videoTask || shot.videoError)) ||
    (p.tasks || []).some(task => task.startedAt && (task.stage === stage.id ||
      (stage.id === 'storyboard' && ['images','frames','videos','quality'].includes(task.stage)) ||
      (stage.id === 'editing' && task.stage === 'render')));
  const feed=useRef(null),submitting=useRef(false);const stages=workflowStages(p).filter(s=>!['images','videos','audio'].includes(s.id)).map(s=>s.id==='storyboard'?{...s,done:p.shots.filter(shot=>shot.frame&&shot.video).length,total:p.shots.length,complete:p.shots.length>0&&p.shots.every(shot=>shot.frame&&shot.video),active:['storyboard','images','frames','videos','quality','audio'].includes(p.stage)}:s),complete=stages.filter(s=>s.complete).length;const phaseLabel=({plan:'导演规划',script:'剧本编写',characters:'角色设定',scenes:'场景设定',storyboard:'分镜规划',assets:'角色与场景制作',frames:'分镜图片生成',images:'图片生成',videos:'视频生成',quality:'镜头审核',audio:'声音处理',editing:'成片剪辑',render:'成片合成',done:'已完成'})[p.stage]||'等待调度';const mediaCount=filmMediaIndex(p).length;
  useEffect(()=>{localStorage.setItem(key+':stage',stage);localStorage.setItem(key+':selected',selected);localStorage.setItem(key+':panel',panel);},[key,stage,selected,panel]);
  async function send(type,body={}) {if(submitting.current)return false;submitting.current=true;setBusy(true);setNotice('');try{const result=await request('/'+p.id+'/commands',{type,body});if(result.project)onProject(result.project);setNotice('操作已保存，后台将在安全点应用；已完成结果会保留。');return true;}catch(e){setNotice(userError(e.message));return false;}finally{submitting.current=false;setBusy(false);}}
  function chooseStage(value){setStage(value);setSelected('');setPanel('editor');}
  function chooseTask(id){const task=p.tasks?.find(t=>t.id===id);const resource=p.resources?.find(r=>r.id===(task?.resourceId||id));if(resource){setStage(resource.category);setSelected(resource.id);}else if(p.shots?.some(s=>s.id===(task?.resourceId||id))){setStage('storyboard');setSelected(task?.resourceId||id);}else if(task?.stage){setStage(stages.some(s=>s.id===task.stage)?task.stage:'script');}setPanel('editor');}
  const blockedSettings = p.status === 'needs-input' && p.stage === 'assets' && p.referenceWorkflow
    ? (p.resources || []).filter(r => ['face','wardrobe','environment'].includes(r.type) &&
      (!r.output || r.stale || (r.approvedVersion !== r.revision &&
        (r.assetReview?.version !== r.revision || r.assetReview?.file !== r.output.file || r.assetReview?.status === 'repair'))))
    : [];
  const needsSettings = blockedSettings.length > 0;
  const firstSetting = blockedSettings.find(r => r.output) || blockedSettings[0];
  function openBlockedSetting(resource) {
    chooseTask(resource.id);
    requestAnimationFrame(() => {
      const card = document.getElementById('film-asset-' + resource.id);
      card?.scrollIntoView({block:'nearest'});
      card?.focus({preventScroll:true});
    });
  }
  const events=(p.events||[]).filter(e=>!['dispatch','started'].includes(e.type));
  return <div className="film-workbench"><header className="fw-control"><div><h2>{filmTaskName(p).replace(/^一键成片 · /, "")}</h2><p>{p.duration == null ? "时长自动" : `${p.duration} 秒`} · {p.ratio} · {p.settings?.style||'电影写实'}{p.status!=='succeeded'&&` · ${phaseLabel}`}</p></div><div className="fw-control-actions"><span className={`fw-state ${p.status}`}>{labels[p.status]||p.status}</span>{p.status!=='succeeded'&&<b>{complete} / {stages.length} 阶段</b>}{!p.awaitingCharacters&&(p.schedulingPaused||['paused','cancelled','failed','needs-input','review'].includes(p.status)?<button className="film-primary" disabled={busy} onClick={()=>needsSettings ? openBlockedSetting(firstSetting) : send('resume',{all:false})}>{needsSettings?'查看待处理设定图':'继续自动制作'}</button>:p.status!=='succeeded'&&<button disabled={busy} onClick={()=>send('pause')}>暂停新任务</button>)}{p.output&&<button className="film-primary" onClick={onDownload}>下载成片</button>}{p.output && p.replacementReady && <button className="film-primary" disabled={busy || Boolean(p.replacement)} onClick={()=>send('export-replacement')}>替换新素材并重新合成</button>}{!['output','media'].includes(stage)&&<button disabled={busy} onClick={()=>send('stage-pause',{stage,paused:!p.pausedStages?.[stage]})}>{p.pausedStages?.[stage]?'恢复当前阶段':'暂停当前阶段'}</button>}<button aria-expanded={settings} onClick={()=>setSettings(!settings)}>项目设置</button></div></header>

    {p.awaitingCharacters && <CharacterDecision project={p} request={request} send={send} busy={busy}/>}
    {settings&&<ProjectSettings project={p} send={send}/>}
    {needsSettings && <section className="fw-notice" aria-label="待处理设定图">
      <strong>处理设定图后继续制作</strong>
      <div className="fw-actions">{[...blockedSettings].sort((a,b)=>Number(Boolean(b.output))-Number(Boolean(a.output))).map(resource =>
        <button key={resource.id} type="button" onClick={()=>openBlockedSetting(resource)}>
          {resource.name} · {resource.output ? '查看审核' : '等待生成'}
        </button>
      )}</div>
    </section>}
    {p.error && !needsSettings && <p className="fw-caption" role="status">{userError(p.error)}</p>}
    {notice && <div className="fw-notice" role="status">{notice}</div>}
    {p.pendingChanges?.length>0&&<p className="fw-caption">{p.pendingChanges.length} 项操作已保存，正在等待执行器应用。外部已提交任务不会被当作已取消。</p>}
    <div className="fw-mobile-tabs"><button className={panel==='conversation'?'active':''} onClick={()=>setPanel('conversation')}>制作记录</button><button className={panel==='editor'?'active':''} onClick={()=>setPanel('editor')}>成果与编辑</button></div>
    <div className={`fw-columns show-${panel}`}><nav className="fw-stage-nav" aria-label="制作流程">{stages.map((s,i)=><button key={s.id} className={stage===s.id?'active':''} onClick={()=>chooseStage(s.id)} aria-current={stage===s.id?'step':undefined}><span className="fw-step-marker" aria-hidden="true">{s.complete?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4 10-10"/></svg>:i+1}</span><b>{s.label}</b><small className={s.id === 'storyboard' && hasStarted(s) ? 'fw-storyboard-counts' : undefined}>{p.pausedStages?.[s.id] ? '已暂停' : !hasStarted(s) ? '等待' : s.id === 'storyboard' ? <>
          <span>{p.shots.filter(shot => shot.frame).length}/{p.shots.length}</span><span>图片</span>
          <span>{p.shots.filter(shot => shot.video).length}/{p.shots.length}</span><span>视频</span>
        </> : p.pausedStages?.[s.id]?'已暂停':s.complete?'已完成':s.total?`${s.done}/${s.total}`:s.active?'进行中':'等待'}</small></button>)}<div className="fw-stage-library"><button type="button" className={stage==='media'?'active':''} onClick={()=>chooseStage('media')}>
          <b>全部素材</b><small>{mediaCount} 个文件</small></button><button type="button" ref={timelineTrigger} data-fw-timeline-trigger aria-expanded={Boolean(timelineOpen)} aria-controls={timelineOpen === null ? undefined : "fw-timeline-panel"} className={timelineOpen?"active":""} onClick={()=>setTimelineOpen(open=>!open)}><b>剪辑时间线</b><small>{timelineOpen?'已展开':'查看轨道'}</small></button></div></nav>
      <section className="fw-conversation" aria-label="Agent协作工作过程"><header className="fw-panel-heading"><h3>制片过程</h3></header><div className="fw-current-tasks" aria-live="polite">{['running','queued','pausing'].includes(p.status) && (() => {
        const running = (p.tasks || []).filter(task => task.status === 'running');
        const jobs = p.activeJobs?.length ? p.activeJobs : running.map(task => ({ id: task.id, message: task.input?.name || task.name || task.stage }));
        return jobs.length ? <><b>正在进行</b>{jobs.map(job => <button type="button" key={job.id} onClick={() => chooseTask(job.id)}>{job.message}</button>)}</> : <b>正在进行 · {stages.find(item => item.id === p.stage)?.label || p.stage || '准备制作'}</b>;
      })()}</div><div className="fw-feed" ref={feed}><FilmActivity events={events} project={p} history details={false} limit={limit} onMore={()=>setLimit(limit+80)} onSelect={chooseTask}/>
        {(p.activeJobs||[]).length>0&&<details className="fw-live-tasks"><summary>{p.activeJobs.length} 项正在制作中</summary>{p.activeJobs.map(job=><button key={job.id} onClick={()=>chooseTask(job.id)}>{job.message}</button>)}</details>}</div>
      </section>
      <div className="fw-inspector-scroll"><aside className="fw-inspector" aria-label="成果预览与编辑"><header className="fw-panel-heading"><h3>{stage==='media'?'全部素材':stages.find(s=>s.id===stage)?.label||'成果'} · 预览与编辑</h3>{stage==='media'&&<small>图片 · 视频 · 音频</small>}</header><div className="fw-inspector-body"><FilmEditor project={p} stage={stage} selected={selected} onSelect={id=>stage==='media'?chooseTask(id):setSelected(id)} send={send} request={request} notice={setNotice} onOpenTimeline={()=>setTimelineOpen(true)}/></div></aside></div>
    </div>
    {timelineOpen !== null && <div id="fw-timeline-panel" className="fw-timeline-sheet" ref={timelinePanel} hidden={!timelineOpen}>
      <button type="button" className="fw-timeline-close" onClick={closeTimeline}>关闭时间线</button>
      <FilmTimeline
        key={p.id + ':' + p.shots.map(s => s.id).join(',')}
        project={p} request={request} send={send} notice={setNotice}
        onSelect={id => { chooseStage('storyboard'); setSelected(id); setTimelineOpen(false); }}
      />
    </div>}
  </div>;
}
function ProjectSettings({project:p,send}) {
  const [value,setValue]=useState(p.settings||{});
  return <section className="fw-settings"><h3>项目设置</h3><p>图片：{p.imageModel}；视频：{p.videoModel}。当前接入按单段不超过10秒调度，复杂分镜会拆分。</p><div className="fw-field-row"><ComposerSelect portal label="镜头转场" value={value.transition||'cut'} options={[{value:'cut',label:'直接切换'},{value:'fade',label:'淡入淡出'}]} onChange={transition=>setValue({...value,transition})}/><label>原生音轨音量<input type="number" min="0" max="2" step=".1" value={value.sourceVolume??1} onChange={e=>setValue({...value,sourceVolume:Number(e.target.value)})}/></label></div><label><input type="checkbox" checked={value.subtitles!==false} onChange={e=>setValue({...value,subtitles:e.target.checked})}/>输出对白字幕</label><label><input type="checkbox" checked={Boolean(value.allowSilent)} onChange={e=>setValue({...value,allowSilent:e.target.checked})}/>允许没有原生语音的片段静音导出</label><button onClick={()=>send('settings',{settings:value})}>保存设置并更新导出</button><p>暂停仅停止新任务调度。当前供应商未接入可靠的取消接口，已提交任务将继续回收结果。</p></section>;
}
