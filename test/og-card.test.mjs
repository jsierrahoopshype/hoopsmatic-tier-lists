// scripts/og-card.cjs (the share card, drawn by hand with Playwright): NBA.com's
// grey silhouette counts as no photo. cdn.nba.com answers an id it has no photo
// of with HTTP 200 and the same bytes as id 0 at that size; photo() compares
// the SHA-256 with id 0's and returns null, so that player gets no tile. No
// network: a stand-in fetch.
//   node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SCRIPT = require.resolve('../scripts/og-card.cjs');
const fresh = () => { delete require.cache[SCRIPT]; return require(SCRIPT); };
// The real 260x190 silhouette (4,937 bytes, November 2026).
const SIL = readFileSync(new URL('./fixtures/nba-silhouette-260x190.png', import.meta.url));
const PHOTO = Buffer.from('a real photo stands in here');
const url = (id) => `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`;
const fetcher = (files, asked = []) => async (u) => { asked.push(u); return files[u] ? new Response(files[u]) : new Response('no', { status: 404 }); };

test('a headshot byte-identical to id 0 is no photo; id 0 is read once', async () => {
  const { photo } = fresh();
  const stand = Buffer.from(SIL); stand[stand.length - 1] ^= 1; // not the built-in hash: only id 0 can say
  const asked = [];
  const get = fetcher({ [url(0)]: stand, [url(77)]: stand, [url(2544)]: PHOTO }, asked);
  assert.deepEqual(await photo(2544, get), PHOTO);
  assert.equal(await photo(77, get), null, 'the silhouette');
  assert.equal(await photo(404, get), null, 'missing');
  assert.equal(await photo(0, get), null, 'no NBA id');
  assert.equal(asked.filter((u) => u === url(0)).length, 1);
});

test('id 0 out of reach: the built-in hash, which is the real silhouette\'s', async () => {
  const { photo, SILHOUETTE_SHA256 } = fresh();
  assert.equal(createHash('sha256').update(SIL).digest('hex'), SILHOUETTE_SHA256);
  const get = fetcher({ [url(1630000)]: SIL, [url(2544)]: PHOTO });
  assert.equal(await photo(1630000, get), null);
  assert.deepEqual(await photo(2544, get), PHOTO);
});
