export const filmPhaseLabels={plan:'导演规划',script:'剧本编写',characters:'角色设定',scenes:'场景设定',storyboard:'分镜规划',assets:'设定图制作',frames:'分镜图片',images:'图片制作',videos:'视频制作',quality:'镜头审核',audio:'声音处理',editing:'成片剪辑',render:'成片合成',done:'完成交付'};
export function filmStatusLabel(p){return ({queued:'等待调度',pausing:'暂停调度中',paused:'已暂停',cancelled:'已暂停',failed:'执行失败','needs-input':'等待人工处理',review:'等待确认',succeeded:'已完成'})[p.status]||filmPhaseLabels[p.stage]||'正在制作';}
export function legacyResourceCategory(r){
 if(['face','wardrobe','reference-original'].includes(r.type))return 'characters';if(r.type==='environment'||r.kind==='scene')return 'scenes';
 if(/场景|空间|门厅|办公室|室内|室外|停车场|客厅|建筑/.test(r.name||''))return 'scenes';
 if(/经纪人|导师|新人|师傅|员工|先生|女士|角色|人物/.test(r.name||''))return 'characters';
 if(/门口|街道|花园|大厅/.test(r.name||''))return 'scenes';
 return r.category||'characters';
}
export function historyMessage(e){const text=String(e.message||'');if(!e.agent)return text.replace(/^正在制作镜头\s*(s?\d+)\s*的?(首帧|视频)?/,'开始生成镜头 $1 $2').replace(/^正在/,'开始');return text;}
export function historyDate(value){return new Date(value).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});}
// A retry being started is not evidence that the original failure is resolved.
export function filmErrorResolved(e, project) {
 if(e.type!=='error' || !e.taskId || e.commandId || String(e.message||'').startsWith('操作未应用'))return false;
 const at=Number(new Date(e.at));
 if(!Number.isFinite(at))return false;
 return (project.events||[]).some(next=>next.taskId===e.taskId && next.type==='result' && Number(new Date(next.at))>at) ||
  (project.tasks||[]).some(t=>t.id===e.taskId && t.status==='succeeded' && Number(new Date(t.completedAt))>at);
}
