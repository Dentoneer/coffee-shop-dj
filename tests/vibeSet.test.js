import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, resetEnv, routeByHost, setSettings, fakeSpotifyLogin, fetchCalls } from './helpers/env.js';

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

test('generateVibeSet writes a sequence-mode set without the seed songs themselves', async () => {
  routeByHost({
    local: () => ({ json: [{ artist: 'Seed Artist A', album: 'Fits' }, { artist: 'Nope', album: 'Off' }] }),
    lastfm: (url) => {
      const m = url.searchParams.get('method');
      if (m === 'track.getsimilar') return { json: { similartracks: { track: Array.from({ length: 12 }, (_, i) => ({ name: `Sim ${url.searchParams.get('track')}${i}`, artist: { name: `Q ${url.searchParams.get('track')}${i}` }, match: '0.5' })) } } };
      if (m === 'album.getinfo') return { json: { album: { tracks: { track: [{ name: 'Fit Song' }] } } } };
      if (m === 'artist.gettoptags') return { json: { toptags: { tag: url.searchParams.get('artist') === 'Nope' ? [] : [{ name: 'son', count: '100' }] } } };
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
  seeds.forEach((s) => assert.ok(!uris.includes(s.uri), `seed ${s.title} should not be in the set`));
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

test('an invalid Last.fm key surfaces as a key error, not "no similar songs"', async () => {
  routeByHost({ lastfm: () => ({ status: 403, json: { error: 10, message: 'Invalid API key - You must be granted a valid key by last.fm' } }), spotify: spotifyEcho });
  await assert.rejects(v.buildSpotifyPool([seed('A', 'One')], []), (err) => err.code === 10);
});

test('collaboration seeds query Last.fm with the first artist', async () => {
  routeByHost({
    lastfm: (url) => (url.searchParams.get('artist') === 'Daft Punk'
      ? { json: { similartracks: { track: [{ name: 'Hit', artist: { name: 'Z' }, match: '1' }] } } }
      : { json: { error: 6, message: 'Track not found' } }),
    spotify: spotifyEcho,
  });
  const pool = await v.buildSpotifyPool([seed('Daft Punk, Pharrell Williams', 'Get Lucky')], []);
  assert.deepEqual(pool.map((p) => p.title), ['Hit']);
});

function mixRoutes() {
  routeByHost({
    local: () => ({ json: [{ artist: 'Seed Artist A', album: 'Fits' }, { artist: 'Nope', album: 'Off' }] }),
    lastfm: (url) => {
      const m = url.searchParams.get('method');
      if (m === 'track.getsimilar') return { json: { similartracks: { track: Array.from({ length: 12 }, (_, i) => ({ name: `Sim ${url.searchParams.get('track')}${i}`, artist: { name: `Q ${url.searchParams.get('track')}${i}` }, match: '0.5' })) } } };
      if (m === 'album.getinfo') return { json: { album: { tracks: { track: [{ name: `${url.searchParams.get('album')} Song` }] } } } };
      if (m === 'artist.gettoptags') return { json: { toptags: { tag: url.searchParams.get('artist') === 'Nope' ? [] : [{ name: 'son', count: '100' }] } } };
      return { json: {} };
    },
    spotify: spotifyEcho,
  });
}
const mixSeeds = () => [seed('Seed Artist A', 'm1'), seed('Seed Artist B', 'm2'), seed('Seed Artist C', 'm3')];
const liveSources = () => {
  const tracks = JSON.parse(localStorage.getItem('csdj.tracks'));
  return JSON.parse(localStorage.getItem('csdj.planOrder')).map((id) => tracks.find((t) => t.id === id).source);
};

test('mix "vinyl" builds only vinyl, best vibe match first, even below the fit threshold', async () => {
  mixRoutes();
  const r = await v.generateVibeSet(mixSeeds(), 2, () => {}, 'vinyl');
  assert.deepEqual(liveSources(), ['vinyl', 'vinyl']);
  assert.equal(r.spotifyCount, 0);
  const tracks = JSON.parse(localStorage.getItem('csdj.tracks'));
  assert.equal(tracks.find((t) => t.id === JSON.parse(localStorage.getItem('csdj.planOrder'))[0]).title, 'Fits Song');
});

test('mix "spotify" builds only Spotify and never loads the collection', async () => {
  mixRoutes();
  const r = await v.generateVibeSet(mixSeeds(), 6, () => {}, 'spotify');
  assert.deepEqual(liveSources(), Array(6).fill('spotify'));
  assert.equal(r.vinylCount, 0);
  assert.equal(fetchCalls.some((c) => c.url.searchParams.get('artist') === 'Nope'), false, 'collection was scored');
});

test('mix defaults to "mixed"', async () => {
  mixRoutes();
  await v.generateVibeSet(mixSeeds(), 4, () => {});
  assert.deepEqual(liveSources(), ['vinyl', 'spotify', 'spotify', 'spotify']);
});

test("seedGenres sums the seeds' tags, drops junk and seed-artist-name tags", async () => {
  routeByHost({ lastfm: (url) => {
    if (url.searchParams.get('method') === 'track.gettoptags') return { json: { toptags: { tag: [
      { name: 'Son Cubano', count: '100' }, { name: 'seen live', count: '90' }, { name: 'Buena Vista Social Club', count: '80' }, { name: 'latin', count: '50' },
    ] } } };
    return { json: {} };
  } });
  const g = await v.seedGenres([seed('Buena Vista Social Club', 'Chan Chan'), seed('Compay Segundo', 'X')]);
  assert.deepEqual(g, ['son cubano', 'latin']);
});

test("buildSpotifyPool adds top songs from the seeds' genres", async () => {
  routeByHost({
    lastfm: (url) => {
      const m = url.searchParams.get('method');
      if (m === 'track.gettoptags') return { json: { toptags: { tag: [{ name: 'bolero', count: '100' }] } } };
      if (m === 'tag.gettoptracks') return { json: { tracks: { track: [{ name: 'Genre Hit', artist: { name: 'G' } }] } } };
      return { json: { error: 6, message: 'Track not found' } };
    },
    spotify: spotifyEcho,
  });
  const pool = await v.buildSpotifyPool([seed('A', 'One')], []);
  assert.deepEqual(pool.map((p) => p.title), ['Genre Hit']);
});

test('buildSpotifyPool keeps one song per artist', async () => {
  routeByHost({
    lastfm: (url) => (url.searchParams.get('method') === 'track.getsimilar'
      ? { json: { similartracks: { track: [
        { name: 'A1', artist: { name: 'Same' }, match: '1' }, { name: 'A2', artist: { name: 'Same' }, match: '0.9' }, { name: 'B1', artist: { name: 'Other' }, match: '0.8' },
      ] } } }
      : { json: {} }),
    spotify: spotifyEcho,
  });
  const pool = await v.buildSpotifyPool([seed('A', 'One')], []);
  assert.deepEqual(pool.map((p) => p.title), ['A1', 'B1']);
});

test('generateVibeSet uses one record per artist and no Spotify song by an artist already on vinyl', async () => {
  routeByHost({
    local: () => ({ json: [{ artist: 'Seed Artist A', album: 'Fits' }, { artist: 'Seed Artist A', album: 'Fits Too' }, { artist: 'Nope', album: 'Off' }] }),
    lastfm: (url) => {
      const m = url.searchParams.get('method');
      if (m === 'track.getsimilar') return { json: { similartracks: { track: [
        { name: 'By Vinyl Artist', artist: { name: 'Seed Artist A' }, match: '1' },
        ...Array.from({ length: 8 }, (_, i) => ({ name: `S${url.searchParams.get('track')}${i}`, artist: { name: `Art ${url.searchParams.get('track')}${i}` }, match: '0.5' })),
      ] } } };
      if (m === 'album.getinfo') return { json: { album: { tracks: { track: [{ name: `${url.searchParams.get('album')} Song` }] } } } };
      if (m === 'artist.gettoptags') return { json: { toptags: { tag: url.searchParams.get('artist') === 'Nope' ? [] : [{ name: 'son', count: '100' }] } } };
      return { json: {} };
    },
    spotify: spotifyEcho,
  });
  await v.generateVibeSet([seed('Seed Artist A', 'g1'), seed('Seed Artist B', 'g2'), seed('Seed Artist C', 'g3')], 8, () => {}, 'mixed');
  const tracks = JSON.parse(localStorage.getItem('csdj.tracks'));
  const byA = tracks.filter((t) => t.artist === 'Seed Artist A');
  assert.equal(byA.length, 1, JSON.stringify(byA.map((t) => [t.source, t.title])));
  assert.equal(byA[0].source, 'vinyl');
});
