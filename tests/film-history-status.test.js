import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installFilms} from '../server/films.js';

test('film history returns real production status for sidebar animation', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'film-history-status-'));
  const routes=new Map();
  const app={get:(url,...handlers)=>routes.set(url,handlers.at(-1)),post:()=>{}};
  try {
    installFilms(app,{dataDir:dir,requireAuth:()=>{},worker:false});
    const root=path.join(dir,'films','test-project');fs.mkdirSync(root,{recursive:true});
    for(const status of ['running','queued','succeeded','failed']) {
      fs.writeFileSync(path.join(root,'project.json'),JSON.stringify({id:'test-project',title:'测试',userId:'owner',createdAt:Date.now(),status}));
      let response;routes.get('/api/films/history')({user:{id:'owner'}},{json:value=>response=value});
      assert.equal(response.projects[0].status,status);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
