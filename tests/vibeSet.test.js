import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, resetEnv, routeByHost, setSettings, fakeSpotifyLogin } from './helpers/env.js';

installEnv();
const v = await import('../js/vibeSet.js');
const lf = await import('../js/lastfm.js');

beforeEach(() => { resetEnv(); lf._resetThrottleForTests(); setSettings({ lastfmApiKey: 'K' }); fakeSpotifyLogin(); });

const V = (n) => Array.from({ length: n }, (_, i) => ({ id: 'v' + i, source: 'vinyl' }));
const S = (n) => Array.from({ length: n }, (_, i) => ({ id: 's' + i, source: 'spotify' }));
const letters = (arr) => arr.map((t) => (t.source === 'vinyl' ? 'V' : 'S')).join(' ');

test('assembleSequence alternates then Spotify tail', () => {
  assert.equal(letters(v.assembleSequence(V(2), S(10), 8)), 'V S V S S S S S');
});

test('assembleSequence with zero vinyl is all Spotify', () => {
  assert.equal(letters(v.assembleSequence([], S(5), 4)), 'S S S S');
});

test('assembleSequence returns fewer than count when candidates run out', () => {
  assert.equal(v.assembleSequence(V(1), S(2), 10).length, 3);
});

const seed = (artist, title) => ({ artist, title, album: 'A', uri: `spotify:track:${title}`, albumArt: null });

// Spotify search echoes the queried track as found (so every candidate resolves).
function spotifyEcho(url) {
  const q = url.searchParams.get('q') || '';
  const title = (q.match(/track:"([^"]+)"/) || [])[1];
  const artist = (q.match(/artist:"([^"]+)"/) || [])[1];
  if (!title) return { json: { tracks: { items: [] } } };
  return { json: { tracks: { items: [{ name: title, artists: [{ name: artist }], album: { name: 'Alb', images: [] }, uri: `spotify:track:${title}`, external_urls: {} }] } } };
}

test('buildSpotifyPool ranks tracks shared by 2 seeds above single-seed tracks', async () => {
  routeByHost({
    lastfm: (url) => {
      const t = url.searchParams.get('track');
      const sim = { One: [{ name: 'Solo', artist: { name: 'X' }, match: '0.99' }, { name: 'Shared', artist: { name: 'Y' }, match: '0.2' }],
        Two: [{ name: 'Shared', artist: { name: 'Y' }, match: '0.2' }] }[t] || [];
      return { json: { similartracks: { track: sim } } };
    },
    spotify: spotifyEcho,
  });
  const pool = await v.buildSpotifyPool([seed('A', 'One'), seed('B', 'Two')], []);
  assert.deepEqual(pool.map((p) => p.title), ['Shared', 'Solo']);
});

test('buildSpotifyPool skips a seed with no similar tracks; throws when all are empty', async () => {
  routeByHost({
    lastfm: (url) => (url.searchParams.get('track') === 'Good'
      ? { json: { similartracks: { track: [{ name: 'Hit', artist: { name: 'Z' }, match: '1' }] } } }
      : { json: { error: 6, message: 'Track not found' } }),
    spotify: spotifyEcho,
  });
  const pool = await v.buildSpotifyPool([seed('A', 'Obscure'), seed('B', 'Good')], []);
  assert.deepEqual(pool.map((p) => p.title), ['Hit']);
  await assert.rejects(v.buildSpotifyPool([seed('A', 'Obscure')], []), /no similar songs/);
});

test('generateVibeSet without Last.fm key rejects and leaves the live set unchanged', async () => {
  setSettings({ lastfmApiKey: '' });
  localStorage.setItem('csdj.tracks', JSON.stringify([{ id: 'keep', source: 'vinyl' }]));
  localStorage.setItem('csdj.planOrder', JSON.stringify(['keep']));
  await assert.rejects(v.generateVibeSet([seed('A', '1'), seed('B', '2'), seed('C', '3')], 10, () => {}), /Settings/);
  assert.deepEqual(JSON.parse(localStorage.getItem('csdj.planOrder')), ['keep']);
});

test('generateVibeSet writes a sequence-mode set with seeds included', async () => {
  routeByHost({
    local: () => ({ json: [{ artist: 'Seed Artist A', album: 'Fits' }, { artist: 'Nope', album: 'Off' }] }),
    lastfm: (url) => {
      const m = url.searchParams.get('method');
      if (m === 'track.getsimilar') return { json: { similartracks: { track: Array.from({ length: 12 }, (_, i) => ({ name: `Sim ${url.searchParams.get('track')}${i}`, artist: { name: 'Q' }, match: '0.5' })) } } };
      if (m === 'album.getinfo') return { json: { album: { tracks: { track: [{ name: 'Fit Song' }] } } } };
      return { json: {} };
    },
    spotify: spotifyEcho,
  });
  const seeds = [seed('Seed Artist A', 's1'), seed('Seed Artist B', 's2'), seed('Seed Artist C', 's3')];
  const r = await v.generateVibeSet(seeds, 10, () => {});
  assert.equal(JSON.parse(localStorage.getItem('csdj.settings')).planMode, 'sequence');
  const order = JSON.parse(localStorage.getItem('csdj.planOrder'));
  const tracks = JSON.parse(localStorage.getItem('csdj.tracks'));
  assert.equal(order.length, 10);
  assert.equal(r.vinylCount, 1);
  const uris = tracks.map((t) => t.spotifyUri);
  seeds.forEach((s) => assert.ok(uris.includes(s.uri), `seed ${s.title} missing`));
  const first = tracks.find((t) => t.id === order[0]);
  assert.equal(first.source, 'vinyl');
  assert.equal(first.title, 'Fit Song');
  assert.ok(JSON.parse(localStorage.getItem('csdj.vibePool')).spotify.length > 0);
});

test('discoverSimilar returns a resolved similar track that is not excluded', async () => {
  routeByHost({
    lastfm: () => ({ json: { similartracks: { track: [{ name: 'Played', artist: { name: 'P' }, match: '1' }, { name: 'Fresh', artist: { name: 'F' }, match: '0.9' }] } } }),
    spotify: spotifyEcho,
  });
  const r = await v.discoverSimilar([{ artist: 'A', title: 'Seed' }], ['spotify:track:Played']);
  assert.equal(r.uri, 'spotify:track:Fresh');
  assert.equal(r.fromLastfm, true);
  assert.equal(r.fromPlaylist, false);
});

test("discoverSimilar returns null with no key, no neighbors, or only (DJ's choice) neighbors", async () => {
  assert.equal(await v.discoverSimilar([], []), null);
  assert.equal(await v.discoverSimilar([{ artist: 'A', title: "(DJ's choice)" }], []), null);
  setSettings({ lastfmApiKey: '' });
  assert.equal(await v.discoverSimilar([{ artist: 'A', title: 'Seed' }], []), null);
});
