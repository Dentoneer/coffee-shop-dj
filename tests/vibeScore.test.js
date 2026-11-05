import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, resetEnv, routeByHost, setSettings, fetchCalls } from './helpers/env.js';

installEnv();
const vs = await import('../js/vibeScore.js');
const lf = await import('../js/lastfm.js');

beforeEach(() => { resetEnv(); lf._resetThrottleForTests(); setSettings({ lastfmApiKey: 'K' }); });

const FOLK = new Map([['indie folk', 100], ['folk', 80], ['acoustic', 60]]);
const profile = {
  seedNames: new Set(['bon iver', 'fleet foxes', 'iron and wine']),
  similar: new Map([['sufjan stevens', 0.6]]),
  tags: FOLK,
};

test('a seed artist with no shared genre does not fit on its own', () => {
  assert.ok(vs.scoreArtist('Fleet Foxes', profile, []) < vs.FIT_THRESHOLD);
});

test('a seed artist in the same genre fits', () => {
  assert.ok(vs.scoreArtist('Fleet Foxes', profile, [{ name: 'indie folk', count: 100 }, { name: 'folk', count: 80 }]) >= vs.FIT_THRESHOLD);
});

test('similar artist with match 0.6 and shared tags fits', () => {
  const s = vs.scoreArtist('Sufjan Stevens', profile, [{ name: 'indie folk', count: 100 }, { name: 'folk', count: 70 }]);
  assert.ok(s >= vs.FIT_THRESHOLD, `score ${s}`);
});

test('off-vibe record does not fit', () => {
  const s = vs.scoreArtist('Ramón Ayala y sus Bravos del Norte', profile, [{ name: 'norteno', count: 100 }, { name: 'regional mexican', count: 80 }]);
  assert.ok(s < vs.FIT_THRESHOLD, `score ${s}`);
});

test('same genre fits even when Last.fm never relates the artist to the seeds', () => {
  const s = vs.scoreArtist('Random Folk Act', profile, [{ name: 'indie folk', count: 100 }, { name: 'folk', count: 80 }, { name: 'acoustic', count: 60 }]);
  assert.ok(s >= vs.FIT_THRESHOLD, `score ${s}`);
});

test('buildSeedProfile merges similar artists (max match) and seed tags', async () => {
  routeByHost({ lastfm: (url) => {
    const m = url.searchParams.get('method'); const a = url.searchParams.get('artist');
    if (m === 'artist.getsimilar') return { json: { similarartists: { artist: a === 'One' ? [{ name: 'X', match: '0.3' }] : [{ name: 'X', match: '0.9' }] } } };
    if (m === 'artist.gettoptags') return { json: { toptags: { tag: [{ name: 'Jazz', count: '10' }] } } };
    return { json: {} };
  } });
  const p = await vs.buildSeedProfile(['One', 'Two', 'Two']);
  assert.equal(p.similar.get('x'), 0.9);
  assert.equal(p.tags.get('jazz'), 20);
  assert.ok(p.seedNames.has('one'));
});

test('scoreRecords calls getArtistTopTags once per distinct artist and reports progress', async () => {
  routeByHost({ lastfm: () => ({ json: { toptags: { tag: [] } } }) });
  const progress = [];
  const out = await vs.scoreRecords(
    [{ artist: 'Fleet Foxes', album: 'A' }, { artist: 'Fleet Foxes', album: 'B' }, { artist: 'Other', album: 'C' }],
    profile, (d, t) => progress.push([d, t]),
  );
  assert.equal(fetchCalls.length, 2);
  assert.deepEqual(progress.at(-1), [2, 2]);
  assert.equal(out[0].record.artist, 'Fleet Foxes');
  assert.ok(out[0].score >= out[2].score);
});
