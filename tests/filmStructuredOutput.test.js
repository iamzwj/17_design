import test from 'node:test';import assert from 'node:assert/strict';import {normalizeShots} from '../server/filmAgents.js';
test('accepts numeric scene number and intentionally empty dialogue without dropping real fields',()=>{
 const p={duration:5,characters:[{id:'c',outfits:[{id:'o'}]}],scenes:[{id:'scene'}],resources:[{id:'scene-environment'},{id:'c-face'},{id:'c-look-o'}]};
 const shot={id:'s1',sceneNumber:1,time:'白天',sceneId:'scene',characterIds:['c'],outfitIds:['o'],duration:5,shotSize:'中景',angle:'平视',composition:'居中',action:'挥手',emotion:['微笑'],light:'自然光',camera:'固定',dialogue:null,ambience:['风声'],continuity:['服装保持一致'],firstFramePrompt:'人物站在花园',videoPrompt:'人物挥手'};
 const [result]=normalizeShots([shot],p);assert.equal(result.sceneNumber,'1');assert.equal(result.dialogue,'');assert.match(result.prompt,/风声/);assert.ok(result.prompt.startsWith('白天'));
 assert.throws(()=>normalizeShots([{...shot,duration:15}],{...p,duration:15}),/时长/);
});
test('changing legacy time preserves the rest of the original prompt',async()=>{const {replaceFilmPromptTime}=await import('../shared/filmWorkflow.js');assert.equal(replaceFilmPromptTime('时间：早晨8点50分。场景：门口。动作：推开车门。','夜晚'),'夜晚。场景：门口。动作：推开车门。');});
