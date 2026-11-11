import path from 'node:path';
import sharp from 'sharp';

export async function checkFrameIntegrity(project, shot, kind, {root, api, check, save, applyCommand, event}) {
  const image = shot[kind];
  if (!image) throw Error('缺少待审核分镜图片');
  if (shot[kind+'Integrity']?.file===image.file && shot[kind+'Integrity'].status==='pass') return;
  const version = shot.revision || 1;
  const data = await sharp(path.join(root,project.id,image.file)).resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const text = '审核电影分镜是否是完整单幅画面。检查硬切拼接线、左右建筑或地面透视断裂、多视图拼版、人物肢体被拼接切断。正常柱子、门框、阴影不是拼接。只返回JSON {status:"pass"|"reject"|"uncertain",summary:"具体可见依据"}。明显确定的缺陷用reject，看不清用uncertain。';
  const content = [{type:'text',text},{type:'image_url',image_url:{url:'data:image/png;base64,'+data.toString('base64')}}];
  let result;
  let failure;
  for (const model of ['gpt-5.6-terra','gemini-3.1-pro']) {
    try {
      const response = await api('/v1/chat/completions',{model,response_format:{type:'json_object'},messages:[{role:'user',content}]},30000);
      result = JSON.parse((response.choices?.[0]?.message?.content||'').replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
      if (!['pass','reject','uncertain'].includes(result.status) || typeof result.summary!=='string' || !result.summary.trim()) throw Error('审核缺少有效依据');
      break;
    } catch (error) { result=null; failure=error; }
  }
  check(project);
  if ((shot.revision||1)!==version || shot[kind]?.file!==image.file) throw Object.assign(Error('镜头已经更新'),{code:'PAUSED'});
  if (!result) throw Error('分镜完整性审核暂未完成：'+failure.message);
  shot[kind+'Integrity']={...result,file:image.file};
  event(project,'quality',shot.id+'-'+kind+'-integrity',result.summary,{type:result.status==='pass'?'result':'decision'});
  save(project);
  if (result.status==='pass') return;
  if (result.status==='reject' && !shot.locked && !shot[kind+'IntegrityRepair']) {
    shot[kind+'IntegrityRepair']=true;
    applyCommand(project,{id:shot.id+'-'+kind+'-integrity-repair-v'+version,type:'edit',body:{id:shot.id,patch:{firstFramePrompt:(shot.firstFramePrompt||shot.prompt)+'。重新构图：整个画面必须是同一机位、连续透视的单一空间。禁止中线硬切、左右拼贴及复制参考板。修复依据：'+result.summary}}});
    save(project);
  }
  throw Error('分镜画面审核未通过：'+result.summary);
}
