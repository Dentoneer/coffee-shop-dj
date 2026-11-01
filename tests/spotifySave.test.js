import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, resetEnv, routeByHost, fakeSpotifyLogin, setSettings, fetchCalls } from './helpers/env.js';

installEnv();
const ss = await import('../js/spotifySave.js');

beforeEach(() => resetEnv());

const tr = (id, source, extra = {}) => ({ id, source, title: id, artist: 'Art', album: 'Alb', played: false, playedAt: null, spotifyUri: source === 'spotify' ? `spotify:track:${id}` : null, ...extra });

test('collectSetEntries sequence keeps planOrder order', () => {
  const tracks = [tr('s1', 'spotify'), tr('v1', 'vinyl'), tr('s2', 'spotify')];
  const out = ss.collectSetEntries({ mode: 'sequence', tracks, planOrder: ['v1', 's2', 's1'], plannedSpotify: {} });
  assert.deepEqual(out.map((e) => e.kind === 'spotify' ? e.uri : e.track.id), ['v1', 'spotify:track:s2', 'spotify:track:s1']);
});

test('collectSetEntries alternate: played by time, then vinyl + planned pick, TBD skipped', () => {
  const tracks = [
    tr('v1', 'vinyl', { played: true, playedAt: 1 }),
    tr('p1', 'spotify', { played: true, playedAt: 2 }),
    tr('v2', 'vinyl'), tr('v3', 'vinyl'),
  ];
  const out = ss.collectSetEntries({ mode: 'alternate', tracks, planOrder: ['v1', 'v2', 'v3'], plannedSpotify: { v2: { uri: 'spotify:track:plan2' } } });
  assert.deepEqual(out.map((e) => e.kind === 'spotify' ? e.uri : e.track.id), ['v1', 'spotify:track:p1', 'v2', 'spotify:track:plan2', 'v3']);
});

function spotifyApi({ playlistGone = false } = {}) {
  return (url, init) => {
    const method = init.method || 'GET';
    if (url.pathname === '/v1/search') {
      // Only a compilation exists for the unmatched vinyl.
      const q = url.searchParams.get('q');
      if (q.includes('track:"vNo"')) return { json: { tracks: { items: [{ name: 'vNo', artists: [{ name: 'Art' }], album: { name: 'Greatest Hits', images: [] }, uri: 'spotify:track:comp', external_urls: {} }] } } };
      return { json: { tracks: { items: [] } } };
    }
    if (url.pathname === '/v1/me/playlists' && method === 'POST') return { status: 201, json: { id: 'newpl', external_urls: { spotify: 'https://open.spotify.com/playlist/newpl' } } };
    if (url.pathname.startsWith('/v1/playlists/') && url.pathname.endsWith('/items')) {
      if (playlistGone && url.pathname.includes('/oldpl/')) return { status: 404, json: { error: { status: 404 } } };
      return { status: 200, json: { snapshot_id: 'x' } };
    }
    return { status: 404, json: {} };
  };
}

const snapshot = (extra = {}) => ({
  name: 'Friday', planMode: 'sequence', plannedSpotify: {},
  tracks: [tr('vYes', 'vinyl', { spotifyUri: 'spotify:track:vYes' }), tr('s1', 'spotify'), tr('vNo', 'vinyl'), tr('s2', 'spotify')],
  planOrder: ['vYes', 's1', 'vNo', 's2'],
  ...extra,
});

test('saveSetToSpotify skips vinyl without exact match and counts them', async () => {
  fakeSpotifyLogin();
  routeByHost({ spotify: spotifyApi() });
  const r = await ss.saveSetToSpotify(snapshot(), null);
  assert.deepEqual({ added: r.added, total: r.total, skippedVinyl: r.skippedVinyl }, { added: 3, total: 4, skippedVinyl: 1 });
  assert.equal(r.playlistId, 'newpl');
  const create = fetchCalls.find((c) => c.url.pathname === '/v1/me/playlists');
  assert.equal(JSON.parse(create.init.body).public, false);
  const put = fetchCalls.find((c) => c.init.method === 'PUT');
  assert.deepEqual(JSON.parse(put.init.body).uris, ['spotify:track:vYes', 'spotify:track:s1', 'spotify:track:s2']);
});

test('re-save replaces items on the existing playlist, no create call', async () => {
  fakeSpotifyLogin();
  routeByHost({ spotify: spotifyApi() });
  const r = await ss.saveSetToSpotify(snapshot(), 'keep1');
  assert.equal(r.playlistId, 'keep1');
  assert.equal(fetchCalls.filter((c) => c.url.pathname === '/v1/me/playlists').length, 0);
  assert.ok(fetchCalls.some((c) => c.init.method === 'PUT' && c.url.pathname === '/v1/playlists/keep1/items'));
});

test('existing playlist 404 creates a new one', async () => {
  fakeSpotifyLogin();
  routeByHost({ spotify: spotifyApi({ playlistGone: true }) });
  const r = await ss.saveSetToSpotify(snapshot(), 'oldpl');
  assert.equal(r.playlistId, 'newpl');
});

test('more than 100 songs: PUT first 100 then POST the rest', async () => {
  fakeSpotifyLogin();
  routeByHost({ spotify: spotifyApi() });
  const tracks = Array.from({ length: 130 }, (_, i) => tr('s' + i, 'spotify'));
  await ss.saveSetToSpotify(snapshot({ tracks, planOrder: tracks.map((t) => t.id) }), null);
  const writes = fetchCalls.filter((c) => c.url.pathname === '/v1/playlists/newpl/items');
  assert.deepEqual(writes.map((c) => [c.init.method, JSON.parse(c.init.body).uris.length]), [['PUT', 100], ['POST', 30]]);
});

test('save without modify scope keeps the in-app save', async () => {
  fakeSpotifyLogin('playlist-read-private');
  localStorage.setItem('csdj.tracks', JSON.stringify([tr('s1', 'spotify')]));
  localStorage.setItem('csdj.planOrder', JSON.stringify(['s1']));
  setSettings({ planMode: 'sequence' });
  const r = await ss.saveSetEverywhere('Night');
  assert.equal(r.spotify, null);
  assert.equal(r.reason, 'scope');
  assert.equal(JSON.parse(localStorage.getItem('csdj.savedSets'))[0].name, 'Night');
});

test('save while logged out keeps the in-app save', async () => {
  localStorage.setItem('csdj.tracks', JSON.stringify([tr('s1', 'spotify')]));
  const r = await ss.saveSetEverywhere('Night');
  assert.equal(r.reason, 'logged-out');
  assert.equal(JSON.parse(localStorage.getItem('csdj.savedSets')).length, 1);
});

test('successful save records the playlist on the live set and the snapshot', async () => {
  fakeSpotifyLogin();
  routeByHost({ spotify: spotifyApi() });
  localStorage.setItem('csdj.tracks', JSON.stringify([tr('s1', 'spotify')]));
  localStorage.setItem('csdj.planOrder', JSON.stringify(['s1']));
  setSettings({ planMode: 'sequence' });
  const r = await ss.saveSetEverywhere('Night');
  assert.equal(r.spotify.playlistId, 'newpl');
  assert.equal(localStorage.getItem('csdj.liveSpotifyPlaylist'), 'newpl');
  assert.equal(JSON.parse(localStorage.getItem('csdj.savedSets'))[0].spotifyPlaylistId, 'newpl');
});
