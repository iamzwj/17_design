import { userError } from './userErrors.js'
import {FILM_AGENT_NAMES} from '../shared/filmWorkflow.js';
import {filmPhaseLabels,historyMessage,historyDate,filmErrorResolved} from '../shared/filmPresentation.js';
export default function FilmActivity({events,project,history,details,limit,onMore,onSelect}){
 const live = ['running','queued','pausing'].includes(project.status)
   ? (project.tasks || []).filter(task => task.status === 'running').map(task => ({
       key: 'live-' + task.id, taskId: task.id, agent: task.agent, stage: task.stage,
       at: task.startedAt || project.updatedAt || Date.now(), type: 'running',
       message: task.input?.name || task.name || task.stage,
     })) : [];
 const current = live.length ? live : ['running','queued'].includes(project.status)
   ? (project.activeJobs || []).map(job => ({ key: 'live-' + job.id, taskId: job.id, at: job.startedAt || Date.now(), stage: job.stage, type: 'running', message: job.message })) : [];
 const translate = value => String(value || '')
   .replace(/storyboard-scene-([a-zA-Z0-9_-]+)/g, (_, id) => {
     const scene = project.script?.scenes?.find(item => item.id === id);
     const index = project.script?.scenes?.findIndex(item => item.id === id);
     return '第' + (index >= 0 ? index + 1 : '') + '场分镜规划' + (scene?.location ? ' · ' + scene.location : '');
   })
   .replace(/The operation was aborted due to timeout|The operation timed out|TimeoutError|signal timed out/gi, '服务响应超时')
   .replace(/Agent/g, '助手')
   .replace(/^(storyboard|characters|scenes|script|director-plan|images|videos|audio|render)$/, value => ({storyboard:'分镜规划',characters:'角色设定',scenes:'场景设定',script:'剧本编写','director-plan':'导演规划',images:'分镜图片生成',videos:'视频生成',audio:'声音制作',render:'成片合成'})[value]);
 const sorted=[...events, ...current].sort((a,b)=>new Date(a.at)-new Date(b.at));const shown=history?sorted.slice(-limit).reverse():sorted.slice(-limit);let date='';
 return <>{events.length>limit&&<button className="fw-history-load" onClick={onMore}>显示较早的 {Math.min(80,events.length-limit)} 条记录</button>}{!shown.length&&<p className="fw-caption">没有符合条件的记录。</p>}{shown.map((e,i)=>{const day=historyDate(e.at),newDay=day!==date;date=day;const index=/镜头\s*s?(\d+)/.exec(e.message||'');const target=e.taskId||(index?project.shots?.[Number(index[1])-1]?.id:null);const resolved=filmErrorResolved(e,project);const label=FILM_AGENT_NAMES[e.agent]||filmPhaseLabels[e.stage]||'制作进度';return <div key={e.key||`${e.at}:${i}`}>
  {newDay&&<h4 className="fw-history-date">{day}</h4>}
  <article className={`fw-activity-row ${e.type==='running'?'is-running':e.type==='error'?'error':''} ${history?'history':''}`}><time dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}</time><div><header><b>{translate(label)}</b>{e.type&&<small>{({running:'正在进行',result:'成果完成',decision:'导演意见',error:'异常',command:'操作已应用',delivery:'成片交付',recovery:'恢复处理',superseded:'已归档旧版本',started:'开始执行',dispatch:'分配任务'})[e.type]||''}</small>}{resolved&&<span className="fw-error-resolved">已解决</span>}</header><p>{translate(e.type==='error'?userError(historyMessage(e)):(history||!e.agent?historyMessage(e):e.message))}</p>{target&&<button className="fw-task-link" onClick={()=>onSelect(target)}>{details?`定位任务 · ${target}`:'查看对应成果'}</button>}{details&&<small className="fw-record-id">{e.commandId?`操作 ${e.commandId}`:e.taskId?`任务 ${e.taskId}`:''}</small>}</div></article>
 </div>;})}</>;
}
