export const FILM_STEPS = [
  { id: 'plan', label: '剧本分镜', work: '导演编排故事与镜头' },
  { id: 'assets', label: '角色场景', work: '制作统一的角色和场景参考' },
  { id: 'frames', label: '分镜首帧', work: '安排每个镜头的画面与构图' },
  { id: 'videos', label: '视频镜头', work: '按分镜生成视频和声音' },
  { id: 'quality', label: '画面检查', work: '对照首帧检查人物和场景' },
  { id: 'render', label: '合成成片', work: '拼接镜头、处理音轨与字幕' },
];
export function filmProgress(project) {
  const assets = project.assets || [], shots = project.shots || [];
  const counts = {
    plan: [project.plan ? 1 : 0, 1],
    assets: [assets.filter(a => a.image).length, assets.length],
    frames: [shots.filter(s => s.frame).length, shots.length],
    videos: [shots.filter(s => s.video).length, shots.length],
    quality: [shots.filter(s => s.video && s.review?.file === s.video.file).length, shots.length],
    render: [project.output ? 1 : 0, 1],
  };
  const steps = FILM_STEPS.map(step => {
    const [done, total] = counts[step.id];
    return { ...step, done, total, complete: total > 0 && done === total };
  });
  const active = steps.find(s => s.id === project.stage) || steps[0];
  const working = project.status === 'running';
  return { steps, active, working, completed: steps.filter(s => s.complete).length };
}
// Persist factual production events, never inferred model thoughts or timed fake progress.
export function filmEvent(project, key, message, now = Date.now()) {
  project.events ||= [];
  if (project.events.at(-1)?.key === key) return;
  project.events.push({ key, message, stage: project.stage, at: now });
  project.events = project.events.slice(-80);
}
export function filmShotState(project, shot, index) {
  if (shot.video) return { state:'complete', label:'视频已完成', detail:'可直接播放此镜头，成片合成无需等待操作' };
  const job = project.status === 'running' && project.activeJobs?.find(j => j.id === `videos:${index}` || j.id === `frames:${index}`);
  if (job || (project.status === 'running' && project.stage === 'videos' && shot.videoTask)) return { state:'working', label:job?.stage === 'frames' ? '首帧生成中' : '视频生成中', detail:shot.videoStatus === 'queued' || shot.videoStatus === 'pending' ? '模型排队中，生成完成后自动展示视频' : '后台正在制作，完成后自动展示视频' };
  if (shot.videoError || shot.frameError) return { state:'error', label:'生成遇到问题', detail:shot.videoError || shot.frameError };
  if (['failed','cancelled'].includes(project.status)) return { state:'pending', label:'已暂停', detail:'已保留素材，继续制作后自动恢复' };
  return { state:'pending', label:shot.frame ? '等待生成视频' : '等待首帧', detail:shot.frame ? '已准备好首帧，等待导演调度视频生成' : '角色与场景就绪后自动生成首帧' };
}

export function filmTaskName(project) {
  return `一键成片 · ${project.plan ? project.title : '导演命名中'}`;
}
