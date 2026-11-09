import { filmOutputDimensions } from '../shared/filmVideoModels.js';
import {createHash} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {beginTask,finishTask,event,taskId} from './filmState.js';
const exec=promisify(execFile);
export const probe=async file=>JSON.parse((await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{timeout:30000})).stdout);
const stamp=t=>{const ms=Math.round(t*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
export async function prepareFilmAudio(p,{root,api,save,check}) {
  p.stage='audio';save(p);const dir=path.join(root,p.id);
  for(const shot of p.shots.filter(s=>s.video && !s.stale && !s.paused)) {
    check(p);if(shot.audio?.source===shot.video.file)continue;
    const version=shot.revision,id=taskId(shot.id,'audio',version),t=beginTask(p,id,'audio','audio',{name:`镜头 ${shot.id} 声音与字幕`,version},[taskId(shot.id,'video',version)]);save(p);
    try {
      const meta=await probe(path.join(dir,shot.video.file));const hasAudio=meta.streams.some(s=>s.codec_type==='audio');
      const audio={source:shot.video.file,hasAudio,duration:Number(meta.format.duration),alignment:'none'};
      if(hasAudio) {
        audio.file=`audio-${shot.id}-v${version}.m4a`;
        await exec('ffmpeg',['-v','error','-y','-i',path.join(dir,shot.video.file),'-vn','-c:a','aac',path.join(dir,audio.file)],{timeout:120000});
        if(shot.dialogue) {
          try {
            const bytes=fs.readFileSync(path.join(dir,audio.file));if(bytes.length>20e6)throw Error('音轨超过对齐预算');
            const r=await api('/v1beta/models/gemini-3.1-pro:generateContent',{contents:[{role:'user',parts:[{text:'按实际音频转录中文语音，返回JSON {segments:[{start:秒,end:秒,text:实际听到的话}]}。没有听到的对白不得补写。时间必须在音频范围内。'},{inline_data:{mime_type:'audio/mp4',data:bytes.toString('base64')}}]}],generationConfig:{temperature:0.1}});
            const raw=(r.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('');const d=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
            if(!Array.isArray(d.segments)||!d.segments.length||d.segments.some(s=>!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>audio.duration+.2||typeof s.text!=='string'))throw Error('实际语音对齐未得到有效结果');
            audio.segments=d.segments;audio.alignment='audio-model';
          }catch(e){audio.alignment='shot-estimate';audio.note='语音对齐未完成，字幕按镜头暂定，请人工核对：'+e.message;}
        }
      } else if(shot.dialogue && !p.settings.allowSilent && !p.timeline.tracks.some(t=>t.kind==='voice')) throw Object.assign(Error(`镜头 ${shot.id} 没有生成语音，请上传配音、重做视频，或在设置中明确允许静音`),{code:'INPUT'});
      save(p);if(shot.revision===version)shot.audio=audio;finishTask(p,t,audio);save(p);
    }catch(e){finishTask(p,t,null,e);save(p);throw e;}
  }
  p.audioReady=p.shots.every(s=>s.audio&&s.video?.file===s.audio.source);save(p);
}
export async function renderFilmTimeline(p,{root,save,check}) {
  if(p.pausedStages?.editing||!p.shots.length)throw Object.assign(Error('等待上游阶段或已暂停的剪辑阶段恢复'),{code:'INPUT'});
  const invalid=p.shots.filter(s=>!s.video||s.paused||s.stale);
  if(invalid.length)throw Object.assign(Error(`等待 ${invalid.map(s=>s.id).join('、')} 完成或人工处理；其他成果已保留`),{code:'INPUT'});
  check(p);p.stage='editing';const id=taskId('timeline-'+createHash('sha256').update(JSON.stringify({shots:p.shots.map(s=>[s.id,s.revision,s.video?.file]),timeline:p.timeline,settings:p.settings})).digest('hex').slice(0,12),'editor',p.timeline.revision||1),t=beginTask(p,id,'editing','editor',{name:'自动剪辑与成片导出',timeline:p.timeline},p.shots.map(s=>taskId(s.id,'audio',s.revision)));save(p);
  const dir=path.join(root,p.id),renderId=Date.now(),work=path.join(dir,`render-${renderId}`);fs.mkdirSync(work,{recursive:true});
  const [w, h] = filmOutputDimensions(p);
  const clips=p.timeline.clips.length?p.timeline.clips:p.shots.map(s=>({shotId:s.id,trimIn:0,duration:s.duration}));
  p.timeline.clips=clips;
  const signature=()=>JSON.stringify({shots:p.shots.map(s=>[s.id,s.revision,s.video?.file]),clips:p.timeline.clips,tracks:p.timeline.tracks,revision:p.timeline.revision,settings:p.settings});
  const inputSignature=signature();
  const captions=[];let cursor=0;
  try {
    for(let i=0;i<clips.length;i++) {
      check(p);const clip=clips[i],shot=p.shots.find(s=>s.id===clip.shotId);if(!shot?.video)throw Error('时间线引用了不存在的片段');
      const source=path.join(dir,shot.video.file),meta=await probe(source),duration=Number(meta.format.duration);
      if(clip.trimIn+clip.duration>duration+.3)throw Object.assign(Error(`镜头 ${shot.id} 实际仅${duration.toFixed(1)}秒，不能静默补帧成${clip.duration}秒，请调整时间线或重做`),{code:'INPUT'});
      const hasAudio=meta.streams.some(s=>s.codec_type==='audio');
      const fade=p.settings.transition==='fade'?`,fade=t=in:st=0:d=0.2,fade=t=out:st=${Math.max(0,clip.duration-.2)}:d=0.2`:'';
      await exec('ffmpeg',['-v','error','-y','-ss',String(clip.trimIn),'-i',source,...(hasAudio?[]:['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']),'-map','0:v:0','-map',hasAudio?'0:a:0':'1:a:0','-vf',`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24${fade}`,'-af',`volume=${p.settings.sourceVolume??1},apad`,'-t',String(clip.duration),'-c:v','libx264','-preset','fast','-crf','21','-c:a','aac','-ar','48000','-ac','2',path.join(work,`clip-${i}.mp4`)],{timeout:300000});
      const segments=shot.audio?.segments || (shot.dialogue?[{start:0,end:shot.duration,text:shot.subtitleText||shot.dialogue}]:[]);
      for(const s of segments) {const start=Math.max(0,s.start-clip.trimIn),end=Math.min(clip.duration,s.end-clip.trimIn);if(end>start)captions.push({start:cursor+start,end:cursor+end,text:s.text,source:shot.audio?.alignment||'shot-estimate'});}
      cursor+=clip.duration;
    }
    fs.writeFileSync(path.join(work,'concat.txt'),clips.map((_,i)=>`file 'clip-${i}.mp4'`).join('\n'));
    let input=path.join(work,'assembly.mp4');
    await exec('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',path.join(work,'concat.txt'),'-c','copy',input],{timeout:300000});
    if(p.timeline.tracks.length) {
      const tracks=p.timeline.tracks;
      const args=['-v','error','-y','-i',input];for(const track of tracks)args.push(...(track.loop?['-stream_loop','-1']:[]),'-i',path.join(dir,track.file));
      const filters=tracks.map((track,i)=>`[${i+1}:a]volume=${track.volume},adelay=${Math.round(track.start*1000)}:all=1[a${i}]`);
      filters.push(`[0:a]${tracks.map((_,i)=>`[a${i}]`).join('')}amix=inputs=${tracks.length+1}:duration=first:normalize=0[mix]`);
      const mixed=path.join(work,'mixed.mp4');args.push('-filter_complex',filters.join(';'),'-map','0:v','-map','[mix]','-c:v','copy','-c:a','aac','-t',String(cursor),mixed);await exec('ffmpeg',args,{timeout:300000});input=mixed;
    }
    const finalCaptions=p.timeline.captionMode==='manual'?p.timeline.captions:captions;
    if(p.timeline.captionMode!=='manual')p.timeline.captions=finalCaptions;
    const srt=finalCaptions.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${String(c.text).replace(/[\r\n]+/g,' ')}\n`).join('\n');
    const subtitleFile=`subtitles-${renderId}.srt`;fs.writeFileSync(path.join(dir,subtitleFile),srt);
    const output=`film-${renderId}.mp4`;
    if(srt && p.settings.subtitles!==false) {
      const filters=(await exec('ffmpeg',['-filters'])).stdout;
      if(filters.includes(' subtitles ')) {p.subtitleMode='burned';await exec('ffmpeg',['-v','error','-y','-i',input,'-vf',`subtitles=${path.join(dir,subtitleFile)}`,'-c:v','libx264','-preset','fast','-c:a','copy','-movflags','+faststart',path.join(dir,output)],{timeout:300000});}
      else {p.subtitleMode='embedded';await exec('ffmpeg',['-v','error','-y','-i',input,'-i',path.join(dir,subtitleFile),'-map','0','-map','1','-c','copy','-c:s','mov_text','-movflags','+faststart',path.join(dir,output)],{timeout:300000});}
    }else fs.copyFileSync(input,path.join(dir,output));
    const result=await probe(path.join(dir,output));if(!result.streams.some(s=>s.codec_type==='video')||Math.abs(Number(result.format.duration)-cursor)>.5)throw Error('成片解码或总时长校验失败');
    save(p); // Apply edits that arrived during FFmpeg before publishing this version.
    if(p.tasks.some(task=>task.status==='running'&&task.id!==t.id)||p.shots.some(s=>!s.video||s.stale)||signature()!==inputSignature) {finishTask(p,t,{file:output,status:'superseded'});t.status='superseded';p.status='queued';save(p);return;}
    p.output=output;p.stage='done';p.status='succeeded';p.renders ||= [];p.renders.push({file:output,createdAt:Date.now(),subtitleFile,timeline:JSON.parse(JSON.stringify(p.timeline))});
    p.exportFiles={timeline:`timeline-${renderId}.json`,subtitles:subtitleFile};fs.writeFileSync(path.join(dir,p.exportFiles.timeline),JSON.stringify(p.timeline,null,2));
    finishTask(p,t,{file:output,duration:cursor});event(p,'director',t.id,'自动剪辑完成，MP4、原始镜头、音轨、字幕和时间线均已保存',{type:'delivery'});save(p);
  }catch(e){finishTask(p,t,null,e);save(p);throw e;}
}
