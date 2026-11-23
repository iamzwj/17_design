import test from 'node:test'
import assert from 'node:assert/strict'
import { activityFormatDraft, ACTIVITY_FORMAT_PROMPTS } from '../src/activityDraft.js'
test('switching all output types preserves a user brief including budget and scope',()=>{
 const brief='武汉幸福社，预算5000元，面向老人，12月20日开展';
 for(const prompt of Object.values(ACTIVITY_FORMAT_PROMPTS)) assert.equal(activityFormatDraft(brief,prompt),brief)
})
test('empty and untouched default drafts follow the selected output type',()=>{
 for(const prompt of Object.values(ACTIVITY_FORMAT_PROMPTS)) {
  assert.equal(activityFormatDraft('',prompt),prompt)
  assert.equal(activityFormatDraft(ACTIVITY_FORMAT_PROMPTS.strategy,prompt),prompt)
 }
})
