import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticFilmClip, repeatedFilmSpeech } from '../server/filmEditing.js';

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


test('automatic cuts keep narration when its timing overlaps the cut or is unknown', () => {
  const project = { editorialWorkflow: true, simpleFilmWorkflow: true };
  const shot = {
    id: 's1', duration: 5, video: { file: 'shot.mp4' },
    review: { file: 'shot.mp4', edit: { start: 1, end: 4, evidence: 'Repeated opening movement' } },
    audio: { hasAudio: true, duration: 5 },
  };
  const full = { shotId: 's1', trimIn: 0, duration: 5 };
  assert.deepEqual(automaticFilmClip(project, shot), full);
  shot.audio.segments = [{ start: 0.7, end: 2, text: '邻居敲了敲门' }];
  assert.deepEqual(automaticFilmClip(project, shot), full);
  shot.audio.segments[0].start = 1.2;
  assert.deepEqual(automaticFilmClip(project, shot), { shotId: 's1', trimIn: 1, duration: 3 });
});
