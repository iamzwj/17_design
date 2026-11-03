import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { filmEvent } from '../shared/filmProgress.js';
export const clone = value => JSON.parse(JSON.stringify(value));
export const AGENTS = { director:'AI 总导演', writer:'编剧 Agent', character:'角色 Agent', scene:'场景 Agent', storyboard:'分镜 Agent', visual:'视觉 Agent', quality:'质检 Agent', audio:'声音服务', editor:'剪辑服务', user:'你' };
export const taskId = (id, kind, revision=1) => `${id}:${kind}:v${revision}`;
export function migrateFilm(p) {
  p.shots ||= [];p.assets ||= [];
  p.schemaVersion ||= 1; p.resources ||= []; p.tasks ||= []; p.events ||= []; p.appliedCommands ||= [];
  p.settings ||= { style:'电影写实', transition:'cut', sourceVolume:1, subtitles:true };
  p.timeline ||= { clips:[], tracks:[], captions:[] };
  for (const a of p.assets || []) { a.revision ||= 1; a.history ||= []; a.kind ||= /场景|环境/.test(a.name) ? 'scene' : 'legacy'; }
  for (const s of p.shots || []) { s.revision ||= 1; s.history ||= []; if(!s.time){const match=/^(?:时间[：:]\s*)?([^；。;\n]{1,25})[；。;]/.exec(s.prompt||'');if(match&&/(白天|夜晚|早晨|清晨|上午|中午|下午|黄昏|傍晚|深夜|凌晨|[0-9]+点)/.test(match[1]))s.time=match[1].trim();} }
  if (p.schemaVersion < 2 && p.plan) {
    p.legacy = true; // Keep already paid/generated projects on their original path.
    for(const a of p.assets) if(!p.resources.some(r=>r.id===a.id)) p.resources.push({ ...clone(a), sourceId:a.id, category:a.kind==='scene'?'scenes':'characters', type:'reference', output:a.image, agent:'visual' });
    p.assets=p.assets.map(a=>p.resources.find(r=>r.id===a.id)||a);
  }
  return p;
}
export function event(p, agent, id, message, extra={}) {
  filmEvent(p, `${id}:${Date.now()}:${randomUUID().slice(0,6)}`, message);
  Object.assign(p.events.at(-1), { agent, taskId:id, ...extra });
}
export function beginTask(p,id,stage,agent,input,dependencies=[]) {
  let t=p.tasks.find(t=>t.id===id);
  if(!t) { t={id,projectId:p.id,stage,agent,input:clone(input),dependencies,status:'waiting',attempts:0,createdAt:Date.now()};p.tasks.push(t); }
  if(agent!=='director')event(p,'director',id,`将「${input.name || stage}」交给${AGENTS[agent]||agent}`,{type:'dispatch'});
  t.status='running'; t.startedAt ||= Date.now(); t.updatedAt=Date.now(); t.attempts++;
  event(p,agent,id,'开始执行：'+(input.name || stage),{type:'started'});
  return t;
}
export function finishTask(p,t,output,error) {
  t.status=error?'failed':'succeeded'; t.output=output; t.error=error?.message || null; t.updatedAt=Date.now();t.completedAt=Date.now();
  event(p,t.agent,t.id,error?`执行遇到问题：${t.error}`:`成果已提交：${t.input.name || t.stage}`,{type:error?'error':'result'});
}
function archive(o) { o.history ||= []; o.history.push({version:o.revision||1,at:Date.now(),value:clone({...o,history:undefined})}); }
function invalidateShot(p,s,reason) {
  if(s.locked) { s.stale=true;s.staleReason=reason;return; }
  archive(s);s.revision++;s.frame=null;s.tail=null;s.video=null;s.audio=null;s.review=null;
  for(const key of ['frame','tail','video']) { s[key+'Task']=null;s[key+'Submitting']=false;s[key+'Attempts']=0;s[key+'Error']=null; }
  s.stale=false;
  p.output=null;p.audioReady=false;
}
export function invalidateResource(p,r,reason,seen=new Set()) {
  if(seen.has(r.id))return;seen.add(r.id);
  for(const child of p.resources.filter(child=>(child.dependencies||[]).includes(r.id))) {
    if(child.locked){child.stale=true;child.staleReason=reason;}
    else {archive(child);child.revision++;child.output=null;child.image=null;child.imageTask=null;child.imageSubmitting=false;child.imageAttempts=0;}
    invalidateResource(p,child,reason,seen);
  }
  for(const s of p.shots || []) if((s.resourceIds || s.assetIds || []).includes(r.id) || (r.sourceId && (s.assetIds || []).includes(r.sourceId))) invalidateShot(p,s,reason);
  p.output=null;p.audioReady=false;
}
export function applyCommand(p,c) {
  migrateFilm(p);
  if(p.appliedCommands.includes(c.id)) return;
  const {type,body={}}=c;
  const target=p.resources.find(r=>r.id===body.id) || p.shots?.find(s=>s.id===body.id);
  const isShot=target && p.shots.includes(target);
  const requireTarget=()=>{if(!target)throw Error('未找到目标任务或成果');};
  const mutable=()=>{requireTarget();if(target.locked)throw Error('成果已锁定，请先解锁');};
  if(type==='pause') { p.schedulingPaused=true; p.status=p.activeJobs?.length?'pausing':'paused'; }
  else if(type==='resume') { p.schedulingPaused=false;p.nextRunAt=0;p.status='queued';p.error=null;for(const r of [...p.resources,...p.shots]) if(body.all)r.paused=false; }
  else if(type==='stage-pause') {p.pausedStages ||= {};p.pausedStages[body.stage]=Boolean(body.paused);if(!body.paused && !p.schedulingPaused)p.status='queued';}
  else if(type==='lock') { requireTarget();target.locked=Boolean(body.locked); }
  else if(type==='task-pause') { requireTarget();target.paused=Boolean(body.paused);if(!body.paused && !p.schedulingPaused)p.status='queued'; }
  else if(type==='keep') { requireTarget();target.stale=false;target.staleReason=null;if(isShot)target.manualApprovedVersion=target.revision;p.status=p.schedulingPaused?'paused':'queued'; }
  else if(type==='edit' || type==='regenerate' || type==='restore' || type==='upload') {
    mutable();
    const changed=type==='edit'?Object.keys(body.patch||{}).filter(key=>JSON.stringify(target[key])!==JSON.stringify(body.patch[key])):[];
    if(type==='edit'&&!changed.length){p.appliedCommands.push(c.id);event(p,'user',target.id,'内容未变化，复用已有成果');return;}
    const previousVersion=target.revision;
    if(isShot) {
      if((type==='regenerate' && body.videoOnly) || type==='upload' || (type==='edit'&&changed.every(key=>['dialogue','duration','subtitleText'].includes(key)))) {
        archive(target); target.revision++;target.video=null;target.videoTask=null;target.videoSubmitting=false;target.videoAttempts=0;target.review=null;target.audio=null;
      } else invalidateShot(p,target,'镜头版本已更新');
    } else { archive(target);target.revision++;target.output=null;target.image=null;target.imageTask=null;target.imageSubmitting=false;target.imageAttempts=0;invalidateResource(p,target,'上游素材版本已更新'); }
    if(type==='restore') {
      const old=target.history.findLast(h=>h.version===Number(body.version));
      if(!old)throw Error('历史版本不存在');
      const currentHistory=target.history, revision=target.revision;
      Object.assign(target,clone(old.value),{history:currentHistory,revision,locked:false,stale:false});
    } else if(type==='upload') {
      if(target.type==='face' && p.schemaVersion===2) {
        const sourceId=`${target.sourceId}-source-${c.id.slice(0,8)}`;
        p.resources.push({id:sourceId,sourceId:target.sourceId,name:`${target.name} · 原始参考图`,category:'characters',type:'reference-original',agent:'character',output:{file:body.file},image:{file:body.file},prompt:'用户原始人物参考，未经解锁不可替换',locked:true,revision:1,history:[]});
        target.dependencies=[sourceId];target.originalReferences=[...(target.originalReferences||[]),sourceId];target.locked=false;
      }else {target.output={file:body.file};target.image=target.output;target.locked=body.locked!==false;if(isShot){target.video=target.output;target.output=null;}}
    }
    else if(type==='edit') {
      const allowed=isShot?['prompt','dialogue','duration','time','sceneId','characterIds','outfitIds','resourceIds','firstFramePrompt','tailFramePrompt','camera','action','continuity','subtitleText']:['prompt','name','attributes'];
      for(const key of allowed) if(body.patch && body.patch[key]!==undefined)target[key]=clone(body.patch[key]);
      if(isShot && body.patch?.prompt && body.patch.firstFramePrompt===undefined && changed.includes('prompt'))target.firstFramePrompt=body.patch.prompt;
    }
    p.needsRerun=true;
    target.stale=false;target.updatedAt=Date.now();
    p.output=null;p.audioReady=false;p.lastImpact={sourceId:target.id,fromVersion:previousVersion,toVersion:target.revision,shots:isShot?[target.id]:p.shots.filter(s=>(s.resourceIds||s.assetIds||[]).includes(target.id)||(target.sourceId&&(s.assetIds||[]).includes(target.sourceId))).map(s=>s.id)};
    p.status=p.schedulingPaused?'paused':'queued';
  }
  else if(type==='add-outfit') {
    requireTarget();const sourceId=target.sourceId;
    if(!sourceId || !p.characters?.some(c=>c.id===sourceId))throw Error('角色不存在');
    const outfitId='outfit-'+c.id.slice(0,8),id=`${sourceId}-look-${outfitId}`;
    p.resources.push({id,sourceId,outfitId,category:'characters',type:'wardrobe',agent:'character',dependencies:[`${sourceId}-face`],name:body.name||'新服装',prompt:body.prompt||'保持同一人物面部身份，生成独立全身正侧背穿搭设定',revision:1,history:[]});
    p.characters.find(c=>c.id===sourceId).outfits.push({id:outfitId,name:body.name||'新服装',prompt:body.prompt||''});p.status=p.schedulingPaused?'paused':'queued';
  }
  else if(type==='script') {
    if(p.scriptLocked)throw Error('剧本已锁定');
    if([...p.resources,...p.shots].some(r=>r.locked))throw Error('修改整部剧本会影响锁定资产，请先解锁或局部修改');
    p.scriptHistory ||= [];p.scriptHistory.push({at:Date.now(),script:clone(p.script)});p.script=clone(body.script);p.needsRerun=true;p.scriptRevision=(p.scriptRevision||1)+1;
    for(const r of p.resources) {archive(r);r.stale=true;}
    p.retiredResources ||= [];p.retiredResources.push(...p.resources,...p.shots);p.timelineHistory ||= [];p.timelineHistory.push(clone(p.timeline));p.timeline={clips:[],tracks:[],captions:[]};
    p.resources=[];p.characters=null;p.scenes=null;p.storyboardReady=false;p.shots=[];p.plan=null;p.output=null;p.audioReady=false;p.status=p.schedulingPaused?'paused':'queued';
  }
  else if(type==='script-lock') {p.scriptLocked=Boolean(body.locked);}
  else if(type==='revise') {p.revisionRequest={text:body.text,targetId:body.id||null,at:Date.now()};p.status=p.schedulingPaused?'paused':'queued';}
  else if(type==='inventory') { p.uploads ||= [];p.uploads.push({...body,at:Date.now()}); }
  else if(type==='settings') {p.useTimeline=true;p.settings={...p.settings,...body.settings};p.output=null;p.status=p.schedulingPaused?'paused':'queued';}
  else if(type==='timeline') {p.useTimeline=true;p.timeline=clone(body.timeline);p.timeline.revision=(p.timeline.revision||0)+1;p.output=null;p.status=p.schedulingPaused?'paused':'queued';}
  else throw Error('未知任务操作');
  p.appliedCommands.push(c.id);
  event(p,'user',body.id || 'project',c.label || ({pause:'暂停新任务调度；已提交的外部任务继续回收结果',resume:'恢复自动制作',lock:body.locked?'锁定当前成果':'解除成果锁定',edit:'更新成果并计算下游影响',regenerate:'重新生成选中任务',restore:'恢复历史版本',upload:'上传并保留原始参考素材',timeline:'更新剪辑工程，仅重新导出成片',revise:'向总导演提交修改要求'}[type]||'更新项目'),{type:'command',commandId:c.id});
}
export function queueFilmCommand(root,id,type,body={}) {
  const command={id:randomUUID(),type,body,createdAt:Date.now()};
  const dir=path.join(root,id,'commands');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,`${String(command.createdAt).padStart(16,'0')}-${command.id}.json`);
  fs.writeFileSync(file+'.next',JSON.stringify(command),{mode:0o600});fs.renameSync(file+'.next',file);return command;
}
export function pendingCommands(root,p) {
  const dir=path.join(root,p.id,'commands');if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort().map(f=>JSON.parse(fs.readFileSync(path.join(dir,f)))).filter(c=>!p.appliedCommands.includes(c.id));
}
export function drainFilmCommands(root,p) {
  migrateFilm(p);
  for(const c of pendingCommands(root,p)) {
    try{applyCommand(clone(p),c);applyCommand(p,c);}catch(error){p.appliedCommands.push(c.id);event(p,'director',c.body?.id||'project',`操作未应用：${error.message}`,{type:'error'});}
  }
}

export function readFilmProject(root,id) {
  const file=path.join(root,id,'project.json'),raw=fs.readFileSync(file,'utf8'),p=JSON.parse(raw);
  if((p.schemaVersion||1)<2) {const backup=path.join(root,id,'project-schema1-backup.json');if(!fs.existsSync(backup)){try{fs.writeFileSync(backup,raw,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}}
  return migrateFilm(p);
}
