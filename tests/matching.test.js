import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, resetEnv, routeByHost, fakeSpotifyLogin } from './helpers/env.js';

installEnv();
const m = await import('../js/matching.js');

beforeEach(() => resetEnv());

const want = { artist: 'David Bowie', title: 'Rebel Rebel', album: 'Diamond Dogs' };
const got = (o) => ({ artist: 'David Bowie', title: 'Rebel Rebel', album: 'Diamond Dogs', uri: 'spotify:track:x', ...o });

test('isExactVinylMatch accepts remastered album suffix', () => {
  assert.equal(m.isExactVinylMatch(want, got({ album: 'Diamond Dogs (2016 Remaster)', title: 'Rebel Rebel - 2016 Remaster' })), true);
});

test('isExactVinylMatch rejects other album', () => {
  assert.equal(m.isExactVinylMatch(want, got({ album: 'David Live (2005 Mix)' })), false);
  assert.equal(m.isExactVinylMatch(want, got({ album: 'Best of Bowie' })), false);
});

test('isExactVinylMatch rejects live title on studio album want', () => {
  assert.equal(m.isExactVinylMatch(want, got({ title: 'Rebel Rebel - Live' })), false);
});

test('isLooseTrackMatch accepts live/parenthetical variants', () => {
  const w = { artist: 'Buena Vista Social Club', title: 'Chan Chan' };
  assert.equal(m.isLooseTrackMatch(w, { artist: 'Buena Vista Social Club', title: 'Chan Chan (Remasterizado)' }), true);
  assert.equal(m.isLooseTrackMatch(w, { artist: 'Buena Vista Social Club', title: 'Chan Chan - Live' }), true);
  assert.equal(m.isLooseTrackMatch(w, { artist: 'Buena Vista Social Club', title: 'El Cuarto de Tula' }), false);
});

test("artistMatches handles accents, 'The', multi-artist", () => {
  assert.equal(m.artistMatches('Ramón Ayala y sus Bravos del Norte', 'Ramon Ayala Y Sus Bravos Del Norte'), true);
  assert.equal(m.artistMatches('Black Keys', 'The Black Keys'), true);
  assert.equal(m.artistMatches('Herb Alpert', 'Herb Alpert, Tijuana Brass'), true);
  assert.equal(m.artistMatches('Herb Alpert', 'Herbie Hancock'), false);
});

test('findExactVinylOnSpotify returns null when only a compilation matches', async () => {
  fakeSpotifyLogin();
  routeByHost({ spotify: () => ({ json: { tracks: { items: [
    { name: 'Rebel Rebel', artists: [{ name: 'David Bowie' }], album: { name: 'Best of Bowie', images: [] }, uri: 'spotify:track:comp', track_number: 3, external_urls: {} },
  ] } } }) });
  assert.equal(await m.findExactVinylOnSpotify(want), null);
});

test('findExactVinylOnSpotify returns the same-album hit', async () => {
  fakeSpotifyLogin();
  routeByHost({ spotify: () => ({ json: { tracks: { items: [
    { name: 'Rebel Rebel', artists: [{ name: 'David Bowie' }], album: { name: 'Best of Bowie', images: [] }, uri: 'spotify:track:comp', external_urls: {} },
    { name: 'Rebel Rebel - 2016 Remaster', artists: [{ name: 'David Bowie' }], album: { name: 'Diamond Dogs (2016 Remaster)', images: [] }, uri: 'spotify:track:dd', external_urls: {} },
  ] } } }) });
  const hit = await m.findExactVinylOnSpotify(want);
  assert.equal(hit.uri, 'spotify:track:dd');
});

test('findSpotifyTrack returns first loose match', async () => {
  fakeSpotifyLogin();
  routeByHost({ spotify: () => ({ json: { tracks: { items: [
    { name: 'Other', artists: [{ name: 'Nobody' }], album: { name: 'X', images: [] }, uri: 'spotify:track:no', external_urls: {} },
    { name: 'Chan Chan', artists: [{ name: 'Buena Vista Social Club' }], album: { name: 'BVSC', images: [] }, uri: 'spotify:track:cc', external_urls: {} },
  ] } } }) });
  const hit = await m.findSpotifyTrack({ artist: 'Buena Vista Social Club', title: 'Chan Chan' });
  assert.equal(hit.uri, 'spotify:track:cc');
});
