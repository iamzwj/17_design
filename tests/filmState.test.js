import test from 'node:test';import assert from 'node:assert/strict';
import { applyCommand,migrateFilm,clone } from '../server/filmState.js';
const fixture=()=>migrateFilm({id:'p',schemaVersion:2,shots:[{id:'s1',revision:1,resourceIds:['r1'],video:{file:'old.mp4'}},{id:'s2',revision:1,resourceIds:['r2'],video:{file:'other.mp4'}}],resources:[{id:'r1',revision:1,output:{file:'old.png'}},{id:'r2',revision:1}],status:'running'});
const command=(p,type,body)=>applyCommand(p,{id:String(Math.random()),type,body});
test('intervention versions resources and invalidates only dependent unlocked shots',()=>{const p=fixture();command(p,'edit',{id:'r1',patch:{prompt:'新服装'}});assert.equal(p.resources[0].revision,2);assert.equal(p.resources[0].history[0].value.output.file,'old.png');assert.equal(p.shots[0].video,null);assert.equal(p.shots[1].video.file,'other.mp4');assert.deepEqual(p.lastImpact.shots,['s1']);});
test('locked output cannot be overwritten and locked descendants require explicit decision',()=>{const p=fixture();p.shots[0].locked=true;command(p,'edit',{id:'r1',patch:{prompt:'新服装'}});assert.equal(p.shots[0].video.file,'old.mp4');assert.equal(p.shots[0].stale,true);assert.throws(()=>command(p,'regenerate',{id:'s1'}),/锁定/);command(p,'keep',{id:'s1'});assert.equal(p.shots[0].stale,false);});
test('restore creates a new version; pause only stops scheduling; commands are idempotent',()=>{const p=fixture();command(p,'edit',{id:'r1',patch:{prompt:'新'}});command(p,'restore',{id:'r1',version:1});assert.equal(p.resources[0].output.file,'old.png');assert.equal(p.resources[0].revision,3);p.activeJobs=[{id:'in-flight'}];command(p,'pause',{});assert.equal(p.status,'pausing');assert.equal(p.activeJobs.length,1);const c={id:'same',type:'lock',body:{id:'r1',locked:true}};applyCommand(p,c);const before=clone(p);applyCommand(p,c);assert.deepEqual(p,before);});
test('uploaded original identity is locked and face sheet is a separate derived asset',()=>{
 const p=migrateFilm({id:'p',schemaVersion:2,characters:[{id:'c1',outfits:[]}],resources:[{id:'c1-face',sourceId:'c1',type:'face',revision:1,output:{file:'prior.png'}}],shots:[]});
 command(p,'upload',{id:'c1-face',file:'asset-original.png',locked:true});
 const source=p.resources.find(r=>r.type==='reference-original'),face=p.resources.find(r=>r.type==='face');
 assert.equal(source.locked,true);assert.equal(source.output.file,'asset-original.png');assert.equal(face.output,null);assert.deepEqual(face.dependencies,[source.id]);assert.equal(face.locked,false);
});
test('explicit first-frame edits survive alongside video prompt edits',()=>{const p=fixture();command(p,'edit',{id:'s1',patch:{prompt:'白天；视频动作',firstFramePrompt:'白天；独立首帧构图'}});assert.equal(p.shots[0].firstFramePrompt,'白天；独立首帧构图');});
test('selecting a library identity during production versions the face and only its dependents',()=>{
 const p=migrateFilm({id:'p',schemaVersion:2,referenceWorkflow:true,status:'needs-input',characters:[{id:'c1',outfits:[]}],resources:[{id:'c1-face',sourceId:'c1',type:'face',revision:1,output:{file:'prior.png'}},{id:'c1-look',type:'wardrobe',dependencies:['c1-face'],revision:1,output:{file:'look.png'}}],shots:[{id:'s1',revision:1,resourceIds:['c1-face'],video:{file:'old.mp4'}},{id:'s2',revision:1,resourceIds:[],video:{file:'other.mp4'}}]});
 const c={id:'reference-123',type:'character-reference',body:{id:'c1-face',file:'asset-character-new.png',name:'角色'}};
 applyCommand(p,c);applyCommand(p,c);
 const face=p.resources.find(r=>r.id==='c1-face');
 assert.equal(face.revision,2);assert.equal(face.history[0].value.output.file,'prior.png');assert.equal(face.output.file,'asset-character-new.png');assert.equal(face.approvedVersion,2);
 assert.equal(p.resources.find(r=>r.type==='reference-original').output.file,'asset-character-new.png');
 assert.equal(p.resources.find(r=>r.id==='c1-look').output,null);assert.equal(p.shots[0].video,null);assert.equal(p.shots[1].video.file,'other.mp4');
 assert.equal(p.status,'queued');assert.equal(p.appliedCommands.filter(id=>id===c.id).length,1);
});

test('targeted redo preserves the finished film, unrelated clips and timeline', () => {
  const p = fixture();
  p.status = 'succeeded';
  p.output = 'finished.mp4';
  p.shots[0].frame = {file:'original-frame.png'};
  const timeline = clone(p.timeline);
  command(p, 'redo-media', {id:'s1',kind:'video'});
  assert.deepEqual(p.replacement, {id:'s1',kind:'video'});
  assert.equal(p.output, 'finished.mp4');
  assert.equal(p.shots[0].video, null);
  assert.equal(p.shots[0].frame.file, 'original-frame.png');
  assert.equal(p.shots[1].video.file, 'other.mp4');
  assert.deepEqual(p.timeline, timeline);
  assert.throws(() => command(p, 'export-replacement', {}), /没有可替换/);
  p.replacement = null;
  p.replacementReady = true;
  p.status = 'succeeded';
  command(p, 'export-replacement', {});
  assert.deepEqual(p.replacement, {kind:'export'});
  assert.equal(p.output, 'finished.mp4');
});

test('redoing a reviewed setting uses the existing correction without invalidating clips', () => {
  const p = fixture();
  p.status = 'succeeded';
  p.resources[0].assetReview = {file:'old.png',status:'repair',correction:'补全入口到电梯的路径'};
  command(p, 'redo-media', {id:'r1',kind:'image'});
  assert.equal(p.resources[0].reviewCorrection, '补全入口到电梯的路径');
  assert.equal(p.resources[0].output, null);
  assert.equal(p.shots[0].video.file, 'old.mp4');
});
