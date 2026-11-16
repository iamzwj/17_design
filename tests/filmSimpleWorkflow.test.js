import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import sharp from 'sharp';
import {fork, execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {installFilms} from '../server/films.js';

test('simple workflow creates a playable film from one director plan', {timeout:120000}, async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'simple-film-'));
  const video=path.join(dir,'fixture.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=purple:s=320x180:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-c:a','aac','-shortest',video]);
  const png=await sharp({create:{width:320,height:180,channels:3,background:'purple'}}).png().toBuffer();
  const jobs=new Map(), videoPrompts=[]; let origin, plans=0;
  const provider=http.createServer(async(req,res)=>{
    if(req.url==='/image.png'){res.setHeader('Content-Type','image/png');return res.end(png);}
    if(req.url==='/clip.mp4')return res.end(fs.readFileSync(video));
    let raw=''; for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):{}; let result;
    if(req.url==='/v1/chat/completions'){
      const system=body.messages[0].content;
      if(typeof system==='string' && system.includes('一次规划完整短片')){
        plans++;
        result={title:'邻里相助',script:{summary:'互相帮助',narrator:{characterName:'旁白',gender:'未知',age:'未知'},scenes:[{id:'a',time:'白天',location:'门口',action:'相遇',characters:['小林'],dialogue:[],narration:''}]},characters:[{id:'c1',name:'小林',identity:{gender:'女',age:'成年'},facePrompt:'黑发',outfits:[{id:'o1',name:'工装',prompt:'灰色工装'}]}],scenes:[{id:'scene',name:'门口',layout:'小区门口',prompt:'小区门口',scriptSceneIds:['a']}],shots:[1,2].map(i=>({id:'s'+i,time:'白天',sceneId:'scene',characterIds:['c1'],outfitIds:['o1'],outfitByCharacter:{c1:'o1'},duration:2,shotSize:'中景',angle:'平视',composition:'居中',action:'搬箱子',emotion:'温暖',light:'自然光',camera:'固定',dialogue:i===2?'我来帮你。':'',speakerId:i===2?'c1':'',narration:i===1?'隔壁小林看见了。':'',ambience:'风声',continuity:'相同工装',firstFramePrompt:'站在门口',videoPrompt:'搬箱子'}))};
      } else if(typeof system==='string' && system.includes('审核剧本、角色身份')) result={status:'pass',reason:'动作推进顺序正确',issues:[],repairs:[]};
      else if(Array.isArray(system)) {
        const prompt=system[0]?.text || '';
        result={status:'pass',summary:'通过',issues:[],...(prompt.includes('confidence:"high"或"low",summary:') ? {confidence:'high'} : {})};
      }
      else throw Error('Unexpected language model request');
      result={choices:[{message:{content:JSON.stringify(result)}}]};
    } else if(req.url.includes('generateContent')) result={candidates:[{content:{parts:[{text:JSON.stringify({segments:[{start:0,end:1.5,text:'那是前年腊月二十八快过年了'}]})}]}}]};
    else if(req.url==='/v1/api/generate') {const id=randomUUID(),isImage=body.model.startsWith('gpt')||body.model.startsWith('nano');jobs.set(id,isImage);if(!isImage)videoPrompts.push(body.prompt);result={id,status:'running'};}
    else {const id=new URL(req.url,origin).searchParams.get('id');result={id,status:'succeeded',results:[{url:origin+(jobs.get(id)?'/image.png':'/clip.mp4')}]};}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+provider.address().port;
  const app=express();app.use(express.json());const store=installFilms(app,{dataDir:dir,worker:false,requireAuth:(req,res,next)=>{req.user={id:'owner'};next();}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api/films';
  const child=fork(new URL('../server/filmWorker.js',import.meta.url),[],{env:{...process.env,FILM_ROOT:store.root,GRSAI_BASE_URL:origin,GRSAI_API_KEY:'test'},stdio:'ignore'});
  try {
    const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({story:'白天小林帮助邻居搬箱子',ratio:'16:9',imageModel:'gpt-image-2.5',videoModel:'minimax-h3'})});
    assert.equal(response.status,202);const {project}=await response.json();let done;
    for(let i=0;i<900;i++) {const response=await fetch(base+'/'+project.id);const current=(await response.json()).project;if(current.status==='succeeded'){done=current;break;}if(['failed','needs-input'].includes(current.status))throw Error(current.error+' '+JSON.stringify(current.tasks.filter(t=>t.status==='failed')));await new Promise(resolve=>setTimeout(resolve,80));}
    assert.ok(done,'film did not complete');assert.equal(plans,1);assert.equal(done.shots.length,2);assert.equal(done.continuityReview?.status,'pass');assert.deepEqual(done.shots.map(shot=>shot.review?.summary),['通过','通过']);
    assert.equal(done.script.narrator.characterId,'c1');
    assert.equal(done.script.narrator.gender,'女');
    assert.equal(videoPrompts.length,2);
    for(const prompt of videoPrompts) assert.match(prompt,/中国大陆标准普通话（Mandarin Chinese, zh-CN）/);
    const narrationPrompt=videoPrompts.find(prompt=>prompt.includes('本镜仅有画外旁白'));
    const dialoguePrompt=videoPrompts.find(prompt=>prompt.includes('本镜仅有角色对白'));
    assert.match(narrationPrompt,/全片统一的女声/);
    assert.match(narrationPrompt,/声线绑定小林/);
    assert.doesNotMatch(narrationPrompt,/我来帮你/);
    assert.match(dialoguePrompt,/说话人：小林/);
    assert.doesNotMatch(dialoguePrompt,/隔壁小林看见了/);
    execFileSync('ffmpeg',['-v','error','-xerror','-i',path.join(store.root,project.id,done.output),'-map','0:v:0','-map','0:a:0','-f','null','-']);
    const subtitle=fs.readFileSync(path.join(store.root,project.id,done.exportFiles.subtitles),'utf8');
    assert.equal((subtitle.match(/那是前年腊月二十八快过年了/g)||[]).length,1);
    const muted=execFileSync('ffmpeg',['-v','error','-ss','2.2','-t','1','-i',path.join(store.root,project.id,done.output),'-vn','-f','s16le','-ac','1','-ar','8000','-'],{maxBuffer:100000});
    assert.ok(muted.every(byte=>byte===0),'duplicate speech must be muted');
  } finally {
    child.kill();await new Promise(resolve=>child.once('exit',resolve));
    await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>provider.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
