import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneLightingPeriods } from '../server/filmAgents.js';

test('scene views follow the actual script periods for each space', () => {
  const script = [
    {id:'a', time:'白天；前年'},
    {id:'b', time:'白天；现在'},
    {id:'c', time:'夜晚；现在'},
    {id:'d', time:'清晨；次日'},
    {id:'e', time:'20:30；三天后'},
  ];
  const scenes = [
    {id:'garden', scriptSceneIds:['a','b']},
    {id:'hall', scriptSceneIds:['c']},
    {id:'entrance', scriptSceneIds:['d','e']},
  ];
  const periods = sceneLightingPeriods(scenes, script);
  assert.deepEqual([...periods], [
    ['garden',['白天']], ['hall',['夜晚']], ['entrance',['清晨','20:30']],
  ]);
  assert.throws(() => sceneLightingPeriods(scenes.slice(0,2),script), /遗漏/);
  assert.throws(() => sceneLightingPeriods([...scenes,{id:'extra',scriptSceneIds:['a']}],script), /重复/);
});
