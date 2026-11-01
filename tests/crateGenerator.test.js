import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, resetEnv, routeByHost, setSettings } from './helpers/env.js';

installEnv();
const { generateCrate } = await import('../js/crateGenerator.js');
const lf = await import('../js/lastfm.js');

beforeEach(() => { resetEnv(); lf._resetThrottleForTests(); setSettings({ lastfmApiKey: 'K' }); });

const FLAT = [3, 3, 3, 3, 3, 3];

test('generateCrate names a real song for every pick and reports progress', async () => {
  routeByHost({
    local: () => ({ json: [{ artist: 'A', album: 'Alpha' }, { artist: 'B', album: 'Beta' }] }),
    lastfm: (url) => (url.searchParams.get('method') === 'album.getinfo'
      ? { json: { album: { tracks: { track: [{ name: `${url.searchParams.get('album')} Song` }] } } } }
      : { json: { toptracks: { track: [] } } }),
  });
  const progress = [];
  const r = await generateCrate(2, FLAT, (done, total) => progress.push([done, total]));
  assert.equal(r.count, 2);
  const titles = JSON.parse(localStorage.getItem('csdj.tracks')).map((t) => t.title).sort();
  assert.deepEqual(titles, ['Alpha Song', 'Beta Song']);
  assert.deepEqual(progress.at(-1), [2, 2]);
});

test("generateCrate keeps (DJ's choice) only when no song can be found", async () => {
  setSettings({ lastfmApiKey: '' });
  routeByHost({ local: () => ({ json: [{ artist: 'A', album: 'Alpha' }] }) });
  await generateCrate(1, FLAT);
  assert.equal(JSON.parse(localStorage.getItem('csdj.tracks'))[0].title, "(DJ's choice)");
});
