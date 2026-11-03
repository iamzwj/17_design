import { useEffect, useState } from 'react';
import { filmProgress } from '../shared/filmProgress.js';
const elapsed = ms => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
};
export default function FilmProduction({ project: p, lastSynced, onStage }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const { steps, active, working, completed } = filmProgress(p);
  const paused = ['failed', 'cancelled'].includes(p.status);
  const waiting = p.status === 'review';
  const finished = Boolean(p.output);
  const status = finished ? '成片已就绪' : paused ? '制作已暂停' : waiting ? '等待你的确认' : p.status === 'queued' ? '排队中' : '正在统筹制作';
  const detail = finished ? '镜头、音轨和字幕已合成，打开下方成片即可播放。' : paused ? '已保留完成的素材与镜头，继续制作时将复用。' : waiting ? '分镜已完成。确认后，导演将接着调度图片、视频与成片合成。' : p.status === 'queued' ? '已加入后台制作队列，轮到项目后自动开始。' : (p.activeJobs?.length > 1 ? `正在同时制作 ${p.activeJobs.length} 项${active.id === 'videos' ? '视频镜头' : '图片素材'}` : p.activeJobs?.[0]?.message || p.activity?.message || active.work);
  const jobs = working ? (p.activeJobs || []) : [];
  const next = steps.find(s => !s.complete && s.id !== active.id);
  const events = (p.events || []).slice(-7);
  return <section className="film-production" aria-label="AI导演制作进度">
    <div className="film-director-heading"><div className={`film-director-mark ${working ? 'working' : ''}`} aria-hidden="true">导</div><div><h3>AI 导演 <span>Gemini 3.1 Pro</span></h3><p role="status">{status}</p></div><b className="film-stage-total">{completed}<span> / 6 阶段</span></b></div>
    <ol className="film-stage-track" aria-label="成片制作流程">{steps.map((step, i) => {
      const current = p.stage === step.id && !finished;
      const state = step.complete ? 'complete' : current ? paused ? 'paused' : working ? 'working' : 'current' : 'pending';
      return <li key={step.id} className={state} aria-current={current ? 'step' : undefined}><button onClick={() => onStage(step.id)} aria-label={`查看${step.label}`}><span className="film-stage-dot">{step.complete ? '✓' : i + 1}</span><b>{step.label}</b><small>{step.complete ? '已完成' : current && paused ? '已暂停' : current && working ? '进行中' : step.total > 0 && step.id !== 'plan' && step.id !== 'render' ? `${step.done}/${step.total}` : '待开始'}</small></button></li>;
    })}</ol>
    <div className="film-production-body"><div className="film-current-work"><div className="film-work-label"><b>{finished ? '制作完成' : waiting ? '分镜待确认' : paused ? '需要处理' : '当前调度'}</b>{working && jobs.length === 0 && p.activity?.startedAt && <small>本项已用时 {elapsed(now - p.activity.startedAt)}</small>}</div><p aria-live="polite">{detail}</p>{jobs.length > 0 && <ul className="film-active-jobs" aria-label="正在并行制作的任务">{jobs.map(job => <li key={job.id}><span>{job.message.replace('正在制作', '')}</span><small>{elapsed(now - job.startedAt)}</small></li>)}</ul>}<div className="film-work-counts">{steps.filter(s => ['assets','frames','videos'].includes(s.id)).map(s => <span key={s.id}>{s.label}<b>{s.total ? `${s.done} / ${s.total}` : '待规划'}</b></span>)}</div><p className="film-next">{finished ? '可以继续向导演提出修改要求，或单独重做某个镜头。' : waiting ? '下一步：确认分镜，一键生成成片。' : paused ? '下一步：处理下方提示后继续制作。' : next ? `后续安排：${next.work}。` : '后续安排：完成合成后开放播放与下载。'}</p><small className="film-sync">{lastSynced && now - lastSynced > 15000 ? '进度暂未更新，正在重新连接；后台任务继续保存。' : '后台持续制作，切换页面后可回来查看。'}进度按实际完成项更新。</small></div>
      <details className="film-director-log" open><summary>导演调度记录</summary>{events.length ? <ol>{events.map((e, i) => <li key={`${e.at}:${i}`}><time>{new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time><span>{e.message}</span></li>)}</ol> : <p>{p.plan ? '已完成分镜编排，正在按当前制作计划执行。' : '故事已交给 AI 导演，正在等待制作计划。'}</p>}</details>
    </div>
  </section>;
}
