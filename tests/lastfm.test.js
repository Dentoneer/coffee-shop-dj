import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, resetEnv, mockFetch, fetchCalls, setSettings } from './helpers/env.js';

installEnv();
const lf = await import('../js/lastfm.js');

beforeEach(() => {
  resetEnv();
  lf._resetThrottleForTests();
  setSettings({ lastfmApiKey: 'KEY123' });
});

test('getSimilarTracks maps similartracks.track[] to {artist,title,match}', async () => {
  mockFetch(() => ({ json: { similartracks: { track: [{ name: 'Song A', artist: { name: 'Art' }, match: '0.81' }] } } }));
  const out = await lf.getSimilarTracks('Seed Artist', 'Seed Song');
  assert.deepEqual(out, [{ artist: 'Art', title: 'Song A', match: 0.81 }]);
  const u = fetchCalls[0].url;
  assert.equal(u.searchParams.get('method'), 'track.getsimilar');
  assert.equal(u.searchParams.get('api_key'), 'KEY123');
  assert.equal(u.searchParams.get('format'), 'json');
  assert.equal(u.searchParams.get('autocorrect'), '1');
});

test('caches responses', async () => {
  mockFetch(() => ({ json: { similartracks: { track: [] } } }));
  await lf.getSimilarTracks('A', 'B');
  await lf.getSimilarTracks('A', 'B');
  assert.equal(fetchCalls.length, 1);
  assert.ok(localStorage.getItem('csdj.lastfmCache'));
});

test('throws LastfmError with code 10 on invalid key', async () => {
  mockFetch(() => ({ status: 403, json: { error: 10, message: 'Invalid API key' } }));
  await assert.rejects(lf.getArtistTopTags('X'), (err) => err instanceof lf.LastfmError && err.code === 10);
});

test('throws when no key configured', async () => {
  setSettings({ lastfmApiKey: '' });
  await assert.rejects(lf.getArtistTopTags('X'), (err) => err instanceof lf.LastfmError && /Settings/.test(err.message));
  assert.equal(lf.hasLastfmKey(), false);
});

test('getAlbumTrackTitles returns [] on error 6', async () => {
  mockFetch(() => ({ json: { error: 6, message: 'Album not found' } }));
  assert.deepEqual(await lf.getAlbumTrackTitles('A', 'Nope'), []);
});

test('single-result objects are normalized to arrays', async () => {
  mockFetch(() => ({ json: { album: { tracks: { track: { name: 'Only Song' } } } } }));
  assert.deepEqual(await lf.getAlbumTrackTitles('A', 'B'), ['Only Song']);
});

test('throttles to <=5 req/s', async () => {
  mockFetch(() => ({ json: { toptags: { tag: [] } } }));
  await Promise.all([1, 2, 3, 4, 5, 6].map((i) => lf.getArtistTopTags('Artist ' + i)));
  assert.equal(fetchCalls.length, 6);
  assert.ok(fetchCalls[5].at - fetchCalls[0].at >= 990, `spread was ${fetchCalls[5].at - fetchCalls[0].at}ms`);
});
