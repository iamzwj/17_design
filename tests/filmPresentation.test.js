import test from 'node:test';import assert from 'node:assert/strict';import {legacyResourceCategory,filmStatusLabel,historyMessage} from '../shared/filmPresentation.js';import {migrateFilm} from '../server/filmState.js';
test('legacy scene references stay out of character cards without regenerating assets',()=>{const p=migrateFilm({id:'p',plan:{},assets:[{id:'a',name:'雪姐',image:{file:'a.png'}},{id:'b',name:'新人经纪人',image:{file:'b.png'}},{id:'c',name:'小区门口',image:{file:'c.png'}},{id:'d',name:'室内多功能空间',image:{file:'d.png'}}],shots:[]});assert.deepEqual(p.resources.map(r=>r.category),['characters','characters','scenes','scenes']);assert.deepEqual(p.assets.map(r=>r.image.file),['a.png','b.png','c.png','d.png']);assert.equal(legacyResourceCategory({type:'face',name:'花园设计师'}),'characters');});
test('completed and paused projects never display a running phase as their status',()=>{assert.equal(filmStatusLabel({status:'succeeded',stage:'videos'}),'已完成');assert.equal(filmStatusLabel({status:'needs-input',stage:'images'}),'等待人工处理');assert.equal(filmStatusLabel({status:'paused',stage:'frames'}),'已暂停');assert.match(historyMessage({message:'正在制作镜头 5 的首帧'}),/^开始生成/);});

test('historical errors are resolved only by successful completion of the same task',async()=>{
 const {filmErrorResolved}=await import('../shared/filmPresentation.js');
 const error={type:'error',taskId:'director:v1',at:100,message:'执行遇到问题：超时'};
 assert.equal(filmErrorResolved(error,{tasks:[{id:'director:v1',status:'running',completedAt:200}]}),false);
 assert.equal(filmErrorResolved(error,{tasks:[{id:'other',status:'succeeded',completedAt:200}]}),false);
 assert.equal(filmErrorResolved(error,{tasks:[{id:'director:v1',status:'succeeded',completedAt:50}]}),false);
 assert.equal(filmErrorResolved(error,{tasks:[{id:'director:v1',status:'succeeded',completedAt:200}]}),true);
 assert.equal(filmErrorResolved(error,{events:[{taskId:'director:v1',type:'result',at:200}]}),true);
 assert.equal(filmErrorResolved({...error,message:'操作未应用：已锁定'},{events:[{taskId:'director:v1',type:'result',at:200}]}),false);
 assert.equal(filmErrorResolved(error,JSON.parse(JSON.stringify({tasks:[{id:'director:v1',status:'succeeded',completedAt:200}]}))),true);
});
