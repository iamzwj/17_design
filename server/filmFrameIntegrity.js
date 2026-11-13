import { LANGUAGE_MODELS } from './languageModels.js'
import path from 'node:path';
import sharp from 'sharp';
import { filmScalePrompt } from './filmConsistency.js';

export async function checkFrameIntegrity(project, shot, kind, {root, api, check, save, applyCommand, event}) {
  const image = shot[kind];
  if (!image) throw Error('缺少待审核分镜图片');
  if (shot[kind+'Integrity']?.file===image.file && shot[kind+'Integrity'].scaleChecked && (shot[kind+'Integrity'].status!=='reject' || shot[kind+'Integrity'].deferred)) return;
  const version = shot.revision || 1;
  const data = await sharp(path.join(root,project.id,image.file)).resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const text = '审核电影分镜是否是完整单幅画面。检查硬切拼接线、左右建筑或地面透视断裂、多视图拼版、人物肢体被拼接切断。正常柱子、门框、阴影不是拼接。人物与车辆同框时额外检查比例，先用脚底与轮胎接地点判断景深，再用车门、车顶、车轮及车型判断同景深尺度。考虑合理的近大远小、姿态、广角、遮挡和裁切。只有可见证据明确显示相对尺度失真、且镜头设定未要求夸张时才因比例 reject。看不清时使用 uncertain，并保留其他明确缺陷的判断。只返回JSON {status:"pass"|"reject"|"uncertain",summary:"具体可见依据"}。明显确定的缺陷用reject，看不清用uncertain。镜头设定：' + (kind === 'tail' ? shot.tailFramePrompt : shot.firstFramePrompt || shot.prompt || '');
  const content = [{type:'text',text},{type:'image_url',image_url:{url:'data:image/png;base64,'+data.toString('base64')}}];
  let result;
  for (const model of LANGUAGE_MODELS) {
    try {
      const response = await api('/v1/chat/completions',{model,response_format:{type:'json_object'},messages:[{role:'user',content}]},30000);
      result = JSON.parse((response.choices?.[0]?.message?.content||'').replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
      if (!['pass','reject','uncertain'].includes(result.status) || typeof result.summary!=='string' || !result.summary.trim()) throw Error('审核缺少有效依据');
      break;
    } catch { result=null; }
  }
  check(project);
  if ((shot.revision||1)!==version || shot[kind]?.file!==image.file) throw Object.assign(Error('镜头已经更新'),{code:'PAUSED'});
  if (!result) result = {status:'uncertain',summary:'自动审核暂未完成，可人工核对。'};
  shot[kind+'Integrity']={...result,file:image.file,scaleChecked:true};
  event(project,'quality',shot.id+'-'+kind+'-integrity',result.summary,{type:result.status==='pass'?'result':'decision'});
  save(project);
  if (result.status!=='reject') return;
  const repairKey = kind+'IntegrityRepair';
  const attempts = Number(shot[repairKey] || 0);
  if (!shot.locked && attempts < 2) {
    shot[repairKey]=attempts+1;
    const promptKey = kind === 'tail' ? 'tailFramePrompt' : 'firstFramePrompt';
    const prompt = (shot[promptKey] || shot.prompt) + '。保持单一机位和连续空间，避免拼贴。' + filmScalePrompt + '修复依据：' + result.summary;
    applyCommand(project,{id:shot.id+'-'+kind+'-integrity-repair-v'+version,type:'edit',body:{id:shot.id,patch:{[promptKey]:prompt}}});
    save(project);
    throw Object.assign(Error('导演已安排修正分镜：'+result.summary),{code:'PAUSED'});
  }
  shot[kind+'Integrity'].deferred=true;
  event(project,'director',shot.id+'-'+kind+'-integrity','保留当前分镜继续制作：'+result.summary,{type:'decision'});
  save(project);
}
