import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv } from './helpers/env.js';

installEnv();
const sv = await import('../js/sequenceView.js');

const pool = {
  spotify: [{ uri: 'u1', title: 'One' }, { uri: 'u2', title: 'Two' }],
  vinyl: [{ record: { artist: 'The Band', album: 'Rec' }, score: 0.9 }, { record: { artist: 'Other', album: 'LP' }, score: 0.5 }],
};

test('takeNextFromPool skips excluded and returns null when exhausted', () => {
  const r = sv.takeNextFromPool(pool, 'spotify', new Set(['u1']));
  assert.equal(r.pick.uri, 'u2');
  assert.deepEqual(r.pool.spotify.map((p) => p.uri), ['u1']);
  assert.equal(pool.spotify.length, 2, 'input pool not mutated');
  assert.equal(sv.takeNextFromPool(pool, 'spotify', new Set(['u1', 'u2'])), null);
  assert.equal(sv.takeNextFromPool({ spotify: [], vinyl: [] }, 'vinyl', new Set()), null);
});

test('takeNextFromPool keys vinyl by normalized artist|album', () => {
  const r = sv.takeNextFromPool(pool, 'vinyl', new Set([sv.vinylKey({ artist: 'Band', album: 'rec' })]));
  assert.equal(r.pick.record.artist, 'Other');
});

const tr = (id, played = false) => ({ id, played });

test('moveInOrder skips played items and is a no-op at the ends', () => {
  const tracks = [tr('a', true), tr('b'), tr('c'), tr('d')];
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(sv.moveInOrder(order, 'c', -1, tracks), ['a', 'c', 'b', 'd']);
  assert.deepEqual(sv.moveInOrder(order, 'b', -1, tracks), order, 'cannot move above a played song');
  assert.deepEqual(sv.moveInOrder(order, 'd', 1, tracks), order);
  assert.deepEqual(sv.moveInOrder(order, 'b', 1, tracks), ['a', 'c', 'b', 'd']);
});
