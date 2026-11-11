import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { installFilms } from '../server/films.js';

test('owned media serves a small preview, preserves originals, and supports native video ranges', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-media-serving-'));
  const id = '12345678-1234-1234-1234-123456789abc';
  const projectDir = path.join(dir, 'films', id);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({id, userId:'owner'}));
  const original = await sharp({create:{width:2304,height:1536,channels:3,background:'#6959a1'}}).png().toBuffer();
  fs.writeFileSync(path.join(projectDir, 'asset-scene.png'), original);
  fs.writeFileSync(path.join(projectDir, 'shot-1.mp4'), '0123456789');
  const app = express();
  installFilms(app, {dataDir:dir, worker:false, requireAuth(req,res,next) {
    req.user = {id:req.headers.authorization === 'owner' ? 'owner' : 'other'};
    next();
  }});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const metadata = file => fetch(`${base}/api/films/${id}/media/${file}`, {headers:{Authorization:'owner'}});
  try {
    assert.equal((await fetch(`${base}/api/films/${id}/media/asset-scene.png`)).status, 404);
    const link = await (await metadata('asset-scene.png')).json();
    const response = await fetch(base + link.url);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    const preview = Buffer.from(await response.arrayBuffer());
    const dimensions = await sharp(preview).metadata();
    assert.ok(dimensions.width <= 1280 && dimensions.height <= 1280);
    assert.ok(preview.length < original.length);
    assert.deepEqual(fs.readFileSync(path.join(projectDir,'asset-scene.png')),original);
    assert.equal((await fetch(base + link.url.replace('asset-scene.png','shot-1.mp4'))).status,404);
    const video = await (await metadata('shot-1.mp4')).json();
    const range = await fetch(base + video.url,{headers:{Range:'bytes=2-4'}});
    assert.equal(range.status,206);
    assert.equal(await range.text(),'234');
    assert.equal((await metadata('missing.png')).status,404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
