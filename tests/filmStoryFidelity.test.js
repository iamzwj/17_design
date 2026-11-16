import { filmShotAudio, resolveFilmNarrator } from '../server/filmConsistency.js';
import { LANGUAGE_MODELS } from '../server/languageModels.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFilmAgents,filmContinuityKey,normalizeShots} from '../server/filmAgents.js';
const project=()=>({id:'test',story:'师父驱车三十三公里指导新人。多年后，新人成为导师，再帮助后来者。',duration:5,scriptRevision:1,settings:{style:'写实'},script:{summary:'传承',scenes:[]},characters:[{id:'c1',name:'雪姐',identity:{age:'40岁',hair:'黑发'},outfits:[{id:'o1',name:'灰色职业大衣',prompt:'灰色大衣配深色长裤'}]}],scenes:[{id:'scene',name:'小区门口',layout:'道路在门前'}],resources:[{id:'scene-environment'},{id:'c1-face'},{id:'c1-look-o1'}],shots:[],tasks:[],events:[]});
const shot=()=>({id:'s1',time:'早晨',sceneId:'scene',characterIds:['c1'],outfitIds:['o1'],duration:5,shotSize:'中景',angle:'平视',composition:'居中',action:'下车',emotion:'温和',light:'自然光',camera:'固定',dialogue:'',ambience:'风声',continuity:'保持服装',firstFramePrompt:'雪姐坐在车内尚未下车',videoPrompt:'开门下车'});
test('video prompts resolve real cast, wardrobe and location instead of opaque IDs',()=>{const p=project(),[s]=normalizeShots([shot()],p);assert.match(s.prompt,/雪姐/);assert.match(s.prompt,/40岁/);assert.match(s.prompt,/灰色大衣配深色长裤/);assert.match(s.prompt,/小区门口/);assert.doesNotMatch(s.prompt,/角色：c1|场景：scene/);});
test('continuity cache follows source and shot meaning, not just unchanged revision numbers',()=>{const p=project();p.shots=[shot()];const key=filmContinuityKey(p);p.shots[0].dialogue='我也过去帮你';assert.notEqual(filmContinuityKey(p),key);p.shots=[shot()];p.story+='结尾必须保持新人接力。';assert.notEqual(filmContinuityKey(p),key);});
test('the continuity reviewer receives the original script and records semantic contradictions without stopping production',async()=>{const p=project();p.storyboardReady=true;p.shots=[shot()];let input,system;const agents=createFilmAgents({save:()=>{},check:()=>{},api:async(_url,body)=>{input=JSON.parse(body.messages[1].content);system=body.messages[0].content;return {choices:[{message:{content:JSON.stringify({status:'manual',reason:'结尾改成师父再次帮助新人，丢掉传承',issues:[{shotId:'s1',type:'剧情',evidence:'原稿要求新人成为导师'}]})}}]};}});await agents.continuity(p);assert.equal(input.sourceStory,p.story);assert.match(system,/逐项对照/);assert.notEqual(p.status,'needs-input');assert.equal(p.continuityReview.status,'manual');assert.match(p.continuityReview.reason,/传承/);});
test('writer input retains the full source and explicit identity/time/dialogue constraints',async()=>{const p=project();delete p.script;let input,system;const agents=createFilmAgents({save:()=>{},check:()=>{},api:async(_url,body)=>{input=JSON.parse(body.messages[1].content);system=body.messages[0].content;return {choices:[{message:{content:JSON.stringify({summary:'传承',scenes:[{id:'a',time:'白天'}]})}}]};}});await agents.writer(p);assert.equal(input.sourceStory,p.story);assert.match(system,/旁白和内心独白/);assert.match(system,/因果顺序/);assert.ok(p.script);});

test('new simple projects plan all scenes in one storyboard request', async () => {
  const p = project();
  p.simpleFilmWorkflow = true;
  p.autoDuration = true;
  p.duration = null;
  p.script.scenes = [{id:'a',time:'白天'}, {id:'b',time:'夜晚'}];
  let calls = 0;
  const agents = createFilmAgents({save(){}, check(){}, async api(_url, body) {
    calls++;
    const input = JSON.parse(body.messages[1].content);
    assert.equal(input.script.scenes.length, 2);
    return {choices:[{message:{content:JSON.stringify({shots:[shot()]})}}]};
  }});
  await agents.storyboard(p);
  assert.equal(calls, 1);
  assert.equal(p.shots.length, 1);
  assert.equal(p.duration, 5);
});

test('simple film plans script, references and shots together in one request', async () => {
  const p = project();
  delete p.script; delete p.characters; delete p.scenes;
  p.resources = []; p.duration = null; p.autoDuration = true;
  p.simpleFilmWorkflow = true; p.editorialWorkflow = true;
  let calls = 0;
  const agents = createFilmAgents({save(){}, check(){}, async api() {
    calls++;
    return {choices:[{message:{content:JSON.stringify({
      title:'邻里相助',
      script:{summary:'邻里互助',scenes:[{id:'scene1',time:'白天',location:'门口'}]},
      characters:[{id:'c1',name:'雪姐',identity:{age:'40岁'},facePrompt:'黑发',outfits:[{id:'o1',name:'大衣',prompt:'灰色大衣'}]}],
      scenes:[{id:'scene',name:'门口',layout:'道路在门前',prompt:'小区门口',scriptSceneIds:['scene1']}],
      shots:[{...shot(),outfitByCharacter:{c1:'o1'}}],
    })}}]};
  }});
  await agents.simplePlan(p);
  await agents.writer(p); await agents.characters(p); await agents.scenes(p); await agents.storyboard(p);
  assert.equal(calls,1);
  assert.equal(p.storyboardReady,true);
  assert.deepEqual(p.shots[0].resourceIds,['scene-environment','c1-look-o1']);
  assert.equal(p.duration,5);
});

test('simple planning tries each available model with a five-minute limit', async () => {
  const p = project();
  delete p.script; delete p.characters; delete p.scenes;
  p.resources = []; p.duration = null; p.autoDuration = true; p.simpleFilmWorkflow = true;
  const timeouts = [];
  const agents = createFilmAgents({save(){}, check(){}, async api(_url, _body, timeout) {
    timeouts.push(timeout);
    return {choices:[{message:{content:'{}'}}]};
  }});
  await assert.rejects(agents.simplePlan(p));
  assert.deepEqual(timeouts,LANGUAGE_MODELS.map(() => 300000));
});

test('director revises an unresolved shot twice, then keeps the current version', async () => {
  const p = project();
  p.storyboardReady = true;
  p.shots = normalizeShots([shot()], p);
  let calls = 0;
  const agents = createFilmAgents({
    save() {}, check() {},
    async api() {
      calls++;
      return {choices:[{message:{content:JSON.stringify({
        status:'manual', reason:'缺少传承画面',
        repairs:[{id:'s1', patch:{prompt:'早晨；补足传承画面 '+calls}}],
      })}}]};
    },
  });
  for(let attempt=0;attempt<3;attempt++){
    p.needsRerun=false;
    p.status='running';
    await agents.continuity(p);
  }
  assert.equal(calls,3);
  assert.equal(p.shots[0].continuityRepairAttempts,2);
  assert.match(p.shots[0].prompt,/画面 2$/);
  assert.equal(p.needsRerun,false);
  assert.equal(p.status,'running');
});


test('narration follows the established lead voice and honors an explicit independent narrator', () => {
  const p = project();
  p.characters[0].facePrompt = '中国女性邻居，黑发';
  p.shots = [shot()];
  p.script.narrator = { characterName: '旁白', gender: '未知', age: '未知' };
  assert.deepEqual(resolveFilmNarrator(p), {
    mode:'protagonist', characterId:'c1', characterName:'雪姐', gender:'女', age:'40岁', voice:'自然、清晰、平实',
  });
  p.script.narrator = { mode:'independent', characterName:'楼下保安', gender:'男', age:'60岁', voice:'沉稳' };
  assert.deepEqual(resolveFilmNarrator(p), p.script.narrator);
});


test('legacy doctor shot uses only the doctor dialogue and strips the duplicate voiceover', () => {
  const p = project();
  p.characters.push({ id:'doctor', name:'医生', identity:{ gender:'男' } });
  const dialogue = '医生对刘敏说：是急性肺炎。再晚半天就危险了。';
  const narration = '后来才知道，王大爷得的是急性肺炎。';
  const videoPrompt = '医生向刘敏说明诊断。画外音：' + narration + dialogue;
  const result = filmShotAudio(p, { dialogue, videoPrompt, prompt:videoPrompt });
  assert.equal(result.visualPrompt,'医生向刘敏说明诊断。');
  assert.match(result.audioPrompt,/本镜仅有角色对白。说话人：医生/);
  assert.match(result.audioPrompt,/台词：「是急性肺炎。再晚半天就危险了。」$/);
  assert.doesNotMatch(result.audioPrompt,/后来才知道|医生对刘敏说/);
  assert.match(filmShotAudio(p, { prompt:'空镜', narration:'' }).audioPrompt,/本镜无台词/);
});
