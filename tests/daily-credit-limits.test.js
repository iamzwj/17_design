import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installAuth} from '../server/auth.js';
test('daily limits migrate existing accounts, charge and cap refunds',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'credit-limits-'));
 const emails=['person@onewo.com','yem15@onewo.com','zhangwj159@onewo.com'];
 fs.writeFileSync(path.join(dir,'auth.json'),JSON.stringify({users:emails.map((email,i)=>({id:String(i),email,credits:20,creditLimit:50,creditsUpdatedOn:'2000-01-01'})),sessions:[],codes:[]}));
 try {
  const auth=installAuth({get(){},post(){}},{dataDir:dir});
  for(const [i,limit] of [100,500,999].entries()){
   assert.equal(auth.spendCredits(String(i),1).credits,limit-1);
   assert.equal(auth.refundCredits(String(i),1000).credits,limit);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
