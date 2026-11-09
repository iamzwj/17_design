import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filmAssetLink, filmLinkKey, validFilmLink, FILM_REFERENCE_TTL_SECONDS } from '../server/filmLinks.js';
test('reference signature survives provider queues and expires after two hours', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'film-links-'));
  try {
    const now = Date.now();
    const id = '12345678-1234-1234-1234-123456789abc';
    const file = 'asset-face.png';
    const url = new URL(filmAssetLink(root, id, file, 'https://app.17design.fun', now));
    const validAt = time => validFilmLink(filmLinkKey(root), id, file, url.searchParams.get('expires'), url.searchParams.get('signature'), time);
    assert.equal(validAt(now + 45 * 60 * 1000), true);
    assert.equal(validAt(now + (FILM_REFERENCE_TTL_SECONDS + 1) * 1000), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
