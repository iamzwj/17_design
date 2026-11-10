import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { installFilms } from '../server/films.js';

test('film creation supports automatic duration without a fixed target', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-auto-duration-'));
  const app = express(); app.use(express.json());
  installFilms(app, { dataDir: dir, worker: false, requireAuth: (req, res, next) => { req.user = { id: 'owner' }; next(); } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/films`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ story: '一段完整的故事', ratio: '16:9', imageModel: 'gpt-image-2.5', videoModel: 'minimax-h3' }) });
    assert.equal(response.status, 202);
    const { project } = await response.json();
    assert.equal(project.duration, null); assert.equal(project.autoDuration, true);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});
