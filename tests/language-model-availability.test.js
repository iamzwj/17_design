import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLanguageModelAvailability } from '../server/languageModelAvailability.js'

test('maintenance persists across tasks and process instances, recovers after cooldown', async () => {
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'model-circuit-'));let time=1000,calls=0
 const create=()=>createLanguageModelAvailability({dataDir,now:()=>time})
 const api=async()=>{calls++;throw Error('该模型维护中')}
 try {
  await assert.rejects(create().request(api,'/test',{model:'gemini'}),/维护/)
  assert.equal(create().available('gemini'),false)
  await assert.rejects(create().request(api,'/test',{model:'gemini'}),{code:'MODEL_COOLDOWN'})
  assert.equal(calls,1)
  assert.equal(create().available('other'),true)
  time+=30*60_000
  assert.equal(create().available('gemini'),true)
  await create().request(async()=>({choices:[{}]}),'/test',{model:'gemini'})
  assert.equal(create().available('gemini'),true)
 } finally {fs.rmSync(dataDir,{recursive:true,force:true})}
})
test('timeouts cool down, content validation and authentication do not disable models',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'model-circuit-'));let time=0
 const health=createLanguageModelAvailability({dataDir,now:()=>time})
 try {
  await assert.rejects(health.request(async()=>{throw Error('服务响应超时')},'/',{model:'timeout'}))
  assert.equal(health.available('timeout'),false)
  time+=120_000;assert.equal(health.available('timeout'),true)
  for(const message of ['剧本结构无效','HTTP 401']) {
   await assert.rejects(health.request(async()=>{throw Error(message)},'/',{model:'valid'}))
   assert.equal(health.available('valid'),true)
  }
 }finally{fs.rmSync(dataDir,{recursive:true,force:true})}
})
