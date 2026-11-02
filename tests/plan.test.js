import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, resetEnv, setSettings } from './helpers/env.js';

installEnv();
const plan = await import('../js/plan.js');
const saved = await import('../js/savedSets.js');

beforeEach(() => resetEnv());

const t = (id, source, played = false) => ({ id, source, played, playedAt: played ? 1 : null, flavorTags: [] });

test('getNextInSequence returns first unplayed of any source', () => {
  const tracks = [t('a', 'vinyl', true), t('b', 'spotify'), t('c', 'vinyl')];
  assert.equal(plan.getNextInSequence(['a', 'b', 'c'], tracks).id, 'b');
  assert.equal(plan.getNextInSequence(['a'], tracks), null);
});

test('insertSoon places after the next unplayed item', () => {
  const tracks = [t('a', 'vinyl', true), t('b', 'spotify'), t('c', 'vinyl')];
  assert.deepEqual(plan.insertSoon('g', ['a', 'b', 'c'], tracks), ['a', 'b', 'g', 'c']);
  assert.deepEqual(plan.insertSoon('g', [], []), ['g']);
  assert.deepEqual(plan.insertSoon('g', ['a'], tracks), ['a', 'g']);
});

test('getPlanMode defaults to alternate', () => {
  assert.equal(plan.getPlanMode({}), 'alternate');
  assert.equal(plan.getPlanMode({ planMode: 'sequence' }), 'sequence');
});

test('computeLiveSnapshot exposes mode and nextItem in sequence mode', () => {
  localStorage.setItem('csdj.tracks', JSON.stringify([t('a', 'spotify'), t('b', 'vinyl')]));
  localStorage.setItem('csdj.planOrder', JSON.stringify(['a', 'b']));
  setSettings({ planMode: 'sequence' });
  const snap = plan.computeLiveSnapshot();
  assert.equal(snap.mode, 'sequence');
  assert.equal(snap.nextItem.id, 'a');
});

test('loadSavedSet of an old snapshot without planMode is alternate', () => {
  setSettings({ planMode: 'sequence' });
  localStorage.setItem('csdj.liveSpotifyPlaylist', 'pl1');
  saved.loadSavedSet({ tracks: [t('a', 'vinyl')], planOrder: ['a'], leverStart: 2, leverEnd: 4, plannedDurationMinutes: 60 });
  assert.equal(JSON.parse(localStorage.getItem('csdj.settings')).planMode, 'alternate');
  assert.equal(localStorage.getItem('csdj.liveSpotifyPlaylist'), null);
});

test('buildSnapshot round-trips planMode and plannedSpotify', () => {
  localStorage.setItem('csdj.tracks', JSON.stringify([t('a', 'vinyl')]));
  localStorage.setItem('csdj.planOrder', JSON.stringify(['a']));
  localStorage.setItem('csdj.plannedSpotify', JSON.stringify({ a: { uri: 'spotify:track:p', title: 'P' } }));
  setSettings({ planMode: 'sequence' });
  const snap = saved.buildSnapshot('Night');
  assert.equal(snap.planMode, 'sequence');
  assert.equal(snap.plannedSpotify.a.uri, 'spotify:track:p');
  assert.equal(snap.spotifyPlaylistId, null);
  resetEnv();
  saved.loadSavedSet(snap);
  assert.equal(JSON.parse(localStorage.getItem('csdj.settings')).planMode, 'sequence');
  assert.equal(JSON.parse(localStorage.getItem('csdj.plannedSpotify')).a.uri, 'spotify:track:p');
});

test('placeNewVinyl uses insertSoon in sequence mode, tempo insertion otherwise', () => {
  const tracks = [t('a', 'vinyl', true), t('b', 'spotify'), t('c', 'vinyl')];
  const g = { ...t('g', 'vinyl'), bpm: 100 };
  assert.deepEqual(plan.placeNewVinyl(g, ['a', 'b', 'c'], [...tracks, g], { planMode: 'sequence' }), ['a', 'b', 'g', 'c']);
  const alt = plan.placeNewVinyl(g, ['c'], [...tracks, g], { planMode: 'alternate', leverStart: 2, leverEnd: 4 });
  assert.equal(alt.length, 2);
  assert.ok(alt.includes('g'));
});

test('leaveSequenceMode: cancel keeps the vibe set, confirm resets to alternate', () => {
  setSettings({ planMode: 'sequence' });
  localStorage.setItem('csdj.planOrder', JSON.stringify(['x']));
  assert.equal(plan.leaveSequenceMode(() => false), false);
  assert.deepEqual(JSON.parse(localStorage.getItem('csdj.planOrder')), ['x']);
  assert.equal(plan.leaveSequenceMode(() => true), true);
  assert.equal(localStorage.getItem('csdj.planOrder'), null);
  assert.equal(JSON.parse(localStorage.getItem('csdj.settings')).planMode, 'alternate');
  let asked = false;
  assert.equal(plan.leaveSequenceMode(() => { asked = true; return false; }), true);
  assert.equal(asked, false, 'alternate mode never asks');
});

test('songEditPatch clears the Spotify link when the song changes, keeps it otherwise', () => {
  const track = { artist: 'A', album: 'Alb', title: 'Track 1', trackNumber: 1, spotifyUri: 'spotify:track:t1', spotifyArt: 'art' };
  const changed = plan.songEditPatch(track, { artist: 'A', album: 'Alb', title: 'Track 5', trackNumber: 5 });
  assert.equal(changed.spotifyUri, null);
  assert.equal(changed.spotifyArt, null);
  assert.equal(changed.title, 'Track 5');
  const same = plan.songEditPatch(track, { artist: 'A', album: 'Alb', title: 'Track 1', trackNumber: 1 });
  assert.equal('spotifyUri' in same, false);
});
