import {FILM_AGENT_NAMES} from '../shared/filmWorkflow.js';
import {filmPhaseLabels,historyMessage,historyDate} from '../shared/filmPresentation.js';
export default function FilmActivity({events,project,history,details,limit,onMore,onSelect}){
 const sorted=[...events].sort((a,b)=>new Date(a.at)-new Date(b.at));const shown=history?sorted.slice(-limit).reverse():sorted.slice(-limit);let date='';
 return <>{events.length>limit&&<button className="fw-history-load" onClick={onMore}>显示较早的 {Math.min(80,events.length-limit)} 条记录</button>}{!shown.length&&<p className="fw-caption">没有符合条件的记录。</p>}{shown.map((e,i)=>{const day=historyDate(e.at),newDay=day!==date;date=day;const index=/镜头\s*s?(\d+)/.exec(e.message||'');const target=e.taskId||(index?project.shots?.[Number(index[1])-1]?.id:null);const label=FILM_AGENT_NAMES[e.agent]||filmPhaseLabels[e.stage]||'制作进度';return <div key={e.key||`${e.at}:${i}`}>
  {newDay&&<h4 className="fw-history-date">{day}</h4>}
  <article className={`fw-activity-row ${e.type==='error'?'error':''} ${history?'history':''}`}><time dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:history?'2-digit':undefined,hour12:false})}</time><div><header><b>{label}</b>{e.type&&<small>{({result:'成果完成',decision:'导演意见',error:'异常',command:'操作已应用',delivery:'成片交付',recovery:'恢复处理',superseded:'已归档旧版本',started:'开始执行',dispatch:'分配任务'})[e.type]||''}</small>}</header><p>{history||!e.agent?historyMessage(e):e.message}</p>{target&&<button className="fw-task-link" onClick={()=>onSelect(target)}>{details?`定位任务 · ${target}`:'查看对应成果'}</button>}{details&&<small className="fw-record-id">{e.commandId?`操作 ${e.commandId}`:e.taskId?`任务 ${e.taskId}`:''}</small>}</div></article>
 </div>;})}</>;
}
