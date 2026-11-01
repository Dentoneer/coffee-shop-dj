import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, resetEnv, routeByHost, fakeSpotifyLogin, setSettings } from './helpers/env.js';

installEnv();
const { pickSongForRecord } = await import('../js/songPicker.js');
const lf = await import('../js/lastfm.js');

beforeEach(() => {
  resetEnv();
  lf._resetThrottleForTests();
  setSettings({ lastfmApiKey: 'K' });
});

const record = { artist: 'Band', album: 'Record' };
const spTrack = (name, album, uri) => ({ name, artists: [{ name: 'Band' }], album: { name: album, images: [{ url: 'art' }] }, uri, track_number: 1, external_urls: {} });

function lastfm({ tracklist = [], top = [] } = {}) {
  return (url) => {
    const method = url.searchParams.get('method');
    if (method === 'album.getinfo') return tracklist.length
      ? { json: { album: { tracks: { track: tracklist.map((name) => ({ name })) } } } }
      : { json: { error: 6, message: 'Album not found' } };
    if (method === 'artist.gettoptracks') return { json: { toptracks: { track: top.map((t) => ({ name: t.title, playcount: String(t.playcount) })) } } };
    return { json: {} };
  };
}

test('picks most-played track that is on the album', async () => {
  routeByHost({ lastfm: lastfm({ tracklist: ['Intro', 'Hit', 'Deep Cut'], top: [{ title: 'Other Album Song', playcount: 900 }, { title: 'Hit', playcount: 500 }] }) });
  const s = await pickSongForRecord(record);
  assert.equal(s.title, 'Hit');
  assert.equal(s.trackNumber, 2);
  assert.equal(s.albumUnknown, false);
});

test('falls back to first album track when no overlap', async () => {
  routeByHost({ lastfm: lastfm({ tracklist: ['Intro', 'Hit'], top: [{ title: 'Elsewhere', playcount: 9 }] }) });
  const s = await pickSongForRecord(record);
  assert.equal(s.title, 'Intro');
  assert.equal(s.trackNumber, 1);
});

test('excludeTitles skips already-used songs', async () => {
  routeByHost({ lastfm: lastfm({ tracklist: ['Intro', 'Hit'], top: [{ title: 'Hit', playcount: 9 }] }) });
  const s = await pickSongForRecord(record, { excludeTitles: ['Hit'] });
  assert.equal(s.title, 'Intro');
});

test('album unspecified uses artist top track with albumUnknown true', async () => {
  routeByHost({ lastfm: lastfm({ top: [{ title: 'Big One', playcount: 10 }] }) });
  const s = await pickSongForRecord({ artist: 'Band', album: '(album unspecified)' });
  assert.equal(s.title, 'Big One');
  assert.equal(s.albumUnknown, true);
  assert.equal(s.trackNumber, null);
});

test('no Last.fm key falls back to Spotify album tracklist', async () => {
  setSettings({ lastfmApiKey: '' });
  fakeSpotifyLogin();
  routeByHost({ spotify: (url) => {
    if (url.pathname.endsWith('/search') && url.searchParams.get('type') === 'album') return { json: { albums: { items: [{ id: 'alb1', name: 'Record', artists: [{ name: 'Band' }], images: [] }] } } };
    if (url.pathname === '/v1/albums/alb1/tracks') return { json: { items: [{ name: 'Opener', track_number: 1, artists: [{ name: 'Band' }], uri: 'spotify:track:op' }] } };
    if (url.pathname.endsWith('/search')) return { json: { tracks: { items: [spTrack('Opener', 'Record', 'spotify:track:op')] } } };
    return { status: 404, json: {} };
  } });
  const s = await pickSongForRecord(record);
  assert.equal(s.title, 'Opener');
  assert.equal(s.spotifyUri, 'spotify:track:op');
});

test('returns null when both services fail', async () => {
  setSettings({ lastfmApiKey: '' });
  routeByHost({});
  assert.equal(await pickSongForRecord(record), null);
});

test('spotifyUri only set on exact match', async () => {
  fakeSpotifyLogin();
  routeByHost({
    lastfm: lastfm({ tracklist: ['Hit'] }),
    spotify: () => ({ json: { tracks: { items: [spTrack('Hit', 'Record (Deluxe Edition)', 'spotify:track:exact')] } } }),
  });
  assert.equal((await pickSongForRecord(record)).spotifyUri, 'spotify:track:exact');

  resetEnv(); lf._resetThrottleForTests(); setSettings({ lastfmApiKey: 'K' }); fakeSpotifyLogin();
  routeByHost({
    lastfm: lastfm({ tracklist: ['Hit'] }),
    spotify: () => ({ json: { tracks: { items: [spTrack('Hit', 'Greatest Hits', 'spotify:track:comp')] } } }),
  });
  const s = await pickSongForRecord(record);
  assert.equal(s.title, 'Hit');
  assert.equal(s.spotifyUri, null);
});
