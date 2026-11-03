export const FILM_AGENT_NAMES={director:'AI 总导演',writer:'编剧 Agent',character:'角色 Agent',scene:'场景 Agent',storyboard:'分镜 Agent',visual:'视觉 Agent',quality:'质检 Agent',audio:'声音服务',editor:'剪辑服务',user:'你'};
export const WORKFLOW_STAGES=[['script','剧本'],['characters','角色'],['scenes','场景'],['storyboard','分镜'],['images','图片'],['videos','视频'],['audio','音频'],['editing','剪辑'],['output','成片']];
export function workflowStages(p) {
  const resources=p.resources||[],shots=p.shots||[];
  const counts={script:[p.script||p.plan?1:0,1],characters:[resources.filter(r=>r.category==='characters'&&r.output).length,resources.filter(r=>r.category==='characters').length],scenes:[resources.filter(r=>r.category==='scenes'&&r.output).length,resources.filter(r=>r.category==='scenes').length],storyboard:[shots.length,shots.length],images:[shots.filter(s=>s.frame&&!s.stale).length,shots.length],videos:[shots.filter(s=>s.video&&!s.stale).length,shots.length],audio:[shots.filter(s=>s.audio&&s.audio.source===s.video?.file).length,shots.length],editing:[p.output?1:0,1],output:[p.output?1:0,1]};
  const active=({plan:'script',assets:'images',frames:'images',quality:'videos',render:'editing',done:'output'})[p.stage]||p.stage;
  return WORKFLOW_STAGES.map(([id,label])=>({id,label,done:counts[id][0],total:counts[id][1],complete:counts[id][1]>0&&counts[id][0]===counts[id][1],active:active===id}));
}
