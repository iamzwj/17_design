const STAGES = {
  plan: '导演规划',
  script: '剧本编写',
  characters: '角色设定',
  scenes: '场景设定',
  assets: '角色与场景',
  frames: '分镜图片',
  images: '图片生成',
  videos: '视频镜头',
  quality: '画面检查',
  audio: '声音处理',
  editing: '成片剪辑',
  render: '成片合成',
};

export function filmActiveJobs(project) {
  const tasks = ['running', 'queued', 'pausing'].includes(project.status)
    ? (project.tasks || []).filter((task) => task.status === 'running').map((task) => ({
      id: task.id,
      stage: task.stage,
      resourceId: task.resourceId,
      message: task.input?.name || task.name || task.stage,
    }))
    : [];
  if (tasks.length) return tasks;
  return ['running', 'queued', 'pausing'].includes(project.status)
    ? (project.activeJobs || []).map((job) => ({
      id: job.id,
      stage: job.stage,
      resourceId: job.resourceId,
      message: job.message,
    }))
    : [];
}

function progressFor(project, stage) {
  const shots = project.shots || [];
  const resources = project.resources || project.assets || [];
  if (stage === 'assets') return [resources.filter((item) => item.output || item.image).length, resources.length];
  if (['frames', 'images'].includes(stage)) return [shots.filter((item) => item.frame).length, shots.length];
  if (stage === 'videos') return [shots.filter((item) => item.video).length, shots.length];
  if (stage === 'quality') return [shots.filter((item) => item.video && item.review?.file === item.video.file).length, shots.length];
  return [];
}

// The activity feed stays readable until someone chooses to inspect live jobs.
export function filmActiveJobSummary(project) {
  const groups = new Map();
  for (const job of filmActiveJobs(project)) {
    const stage = job.stage || project.stage || 'plan';
    const current = groups.get(stage) || { stage, label: STAGES[stage] || '制作任务', count: 0 };
    current.count += 1;
    groups.set(stage, current);
  }
  return [...groups.values()].map((group) => ({ ...group, progress: progressFor(project, group.stage) }));
}

export function filmActiveWorkLabel(project) {
  const names = {plan:'剧本',script:'剧本',characters:'角色',scenes:'场景',storyboard:'分镜',assets:'角色与场景',frames:'分镜',images:'分镜',videos:'视频',quality:'画面检查',audio:'声音',editing:'剪辑',render:'成片'};
  const stages = filmActiveJobSummary(project).map(group => group.stage);
  const kinds = [...new Set((stages.length ? stages : [project.stage]).map(stage => names[stage]).filter(Boolean))];
  return `正在制作${kinds.join('、')}`;
}
