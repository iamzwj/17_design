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
