import test from 'node:test';
import assert from 'node:assert/strict';
import { repeatedFilmSpeech } from '../server/filmEditing.js';

test('detects repeated transcribed sentences across shots without removing short greetings', () => {
  const first = {start:0,end:2,text:'那是前年腊月二十八，快过年了。'};
  const duplicate = {start:1,end:3,text:'那是前年腊月二十八 快过年了'};
  const greeting = {start:3,end:4,text:'过年好'};
  const result = repeatedFilmSpeech([{audio:{segments:[first,greeting]}},{audio:{segments:[duplicate,greeting]}}]);
  assert.deepEqual(result, [[],[duplicate]]);
});

test('keeps a repeated line that is explicitly scripted as dialogue', () => {
  const line={start:0,end:2,text:'那是前年腊月二十八，快过年了。'};
  assert.deepEqual(repeatedFilmSpeech([{audio:{segments:[line]}},{dialogue:line.text,audio:{segments:[line]}}]),[[],[]]);
});
