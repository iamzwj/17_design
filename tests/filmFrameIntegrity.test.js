import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {checkFrameIntegrity} from '../server/filmFrameIntegrity.js';

test('unavailable visual providers record uncertainty without blocking production', async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'film-integrity-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'p'));
 await sharp({create:{width:30,height:30,channels:3,background:'gray'}}).png().toFile(path.join(root,'p','frame.png'));
 const shot={id:'s',revision:1,frame:{file:'frame.png'}};
 const p={id:'p'};
 const calls=[];
 await checkFrameIntegrity(p,shot,'frame',{root,api:async(_endpoint,{model})=>{calls.push(model);throw Error('timeout');},check(){},save(){},event(){},applyCommand(){throw Error('Unexpected edit');}});
 assert.deepEqual(calls,['gpt-6.1-sol','gemini-3.1-pro','gpt-6.1-terra','gpt-5.6-sol','gpt-5.6-terra']);
 assert.equal(shot.frameIntegrity.status,'uncertain');
 await checkFrameIntegrity(p,shot,'frame',{root,api:async()=>{throw Error('Should reuse uncertainty');}});
});
