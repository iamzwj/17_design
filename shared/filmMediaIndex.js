export function filmMediaIndex(p,history=false) {
  const files=new Map();
  const add=(output,kind,name,resourceId,version,current=true)=>{if(!output?.file)return;if(!history&&!current)return;if(!files.has(output.file))files.set(output.file,{id:output.file,file:output.file,kind,name,resourceId,version,current});};
  for(const r of p.resources||[]){add(r.output||r.image,'image',r.name,r.id,r.revision);if(history)for(const h of r.history||[])add(h.value.output||h.value.image,'image',`${r.name} · 历史`,r.id,h.version,false);}
  for(const [i,s] of (p.shots||[]).entries()){add(s.frame,'image',`镜头 ${i+1} · 分镜图`,s.id,s.revision);add(s.tail,'image',`镜头 ${i+1} · 尾帧`,s.id,s.revision);add(s.video,'video',`镜头 ${i+1} · 视频`,s.id,s.revision);add(s.audio,'audio',`镜头 ${i+1} · 原生声音`,s.id,s.revision);if(history)for(const h of s.history||[]){add(h.value.frame,'image',`镜头 ${i+1} · 历史分镜图`,s.id,h.version,false);add(h.value.video,'video',`镜头 ${i+1} · 历史视频`,s.id,h.version,false);add(h.value.audio,'audio',`镜头 ${i+1} · 历史声音`,s.id,h.version,false);}}
  for(const u of p.uploads||[])add(u,u.kind,u.name||'上传素材',null,null);
  for(const [i,r] of (p.renders||[]).entries())add(r,'video',`成片版本 ${i+1}`,null,i+1,r.file===p.output||history);
  return [...files.values()];
}
