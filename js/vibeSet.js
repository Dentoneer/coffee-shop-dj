// Seed-vibe sets: the DJ picks 3 Spotify songs, Last.fm supplies songs that
// listeners pair with them, and the DJ's own collection supplies the records
// whose artists sit closest to that vibe. The result is a "sequence" set:
// vinyl and Spotify alternate while fitting vinyl lasts, then it's Spotify
// only. Nothing is written to the live set (or to Spotify) until every
// lookup has succeeded, so a failure never leaves a half-built set.

import { Store, newId } from './store.js?v=20261101shame';
import { hasLastfmKey, getSimilarTracks, LastfmError } from './lastfm.js?v=20261101shame';
import { findSpotifyTrack, normalizeText, normalizeTitle } from './matching.js?v=20261101shame';
import { buildSeedProfile, scoreRecords, FIT_THRESHOLD } from './vibeScore.js?v=20261101shame';
import { pickSongForRecord } from './songPicker.js?v=20261101shame';
import { loadCollection } from './crateGenerator.js?v=20261101shame';

const songKey = (artist, title) => `${normalizeText(artist)}|${normalizeTitle(title, { loose: true })}`;

/** Merges Last.fm similar tracks from several seeds, best-shared first. */
async function rankSimilar(seeds, limit) {
  const merged = new Map();
  let anyData = false;
  for (const s of seeds) {
    const sims = await getSimilarTracks(s.artist, s.title, limit).catch(() => []);
    if (sims.length) anyData = true;
    sims.forEach((t) => {
      const k = songKey(t.artist, t.title);
      const cur = merged.get(k) || { artist: t.artist, title: t.title, seeds: 0, match: 0 };
      cur.seeds += 1;
      cur.match += t.match;
      merged.set(k, cur);
    });
  }
  const ranked = [...merged.values()].sort((a, b) => b.seeds - a.seeds || b.match - a.match);
  return { ranked, anyData };
}

export async function buildSpotifyPool(seeds, excludeUris, want = 60) {
  const { ranked, anyData } = await rankSimilar(seeds, 50);
  if (!anyData) throw new Error('Last.fm has no similar songs for these seeds');
  const excluded = new Set(excludeUris.filter(Boolean));
  const seedKeys = new Set(seeds.map((s) => songKey(s.artist, s.title)));
  const pool = [];
  for (const cand of ranked) {
    if (pool.length >= want) break;
    if (seedKeys.has(songKey(cand.artist, cand.title))) continue;
    const hit = await findSpotifyTrack(cand).catch(() => null);
    if (!hit || excluded.has(hit.uri)) continue;
    excluded.add(hit.uri);
    pool.push(hit);
  }
  return pool;
}

/** One Last.fm-similar song for a mood-wave Spotify turn (Task 10). */
export async function discoverSimilar(neighbors, excludeUris) {
  const usable = (neighbors || []).filter((n) => n?.artist && n?.title && n.title !== "(DJ's choice)");
  if (!hasLastfmKey() || usable.length === 0) return null;
  const { ranked } = await rankSimilar(usable, 30);
  const top = ranked.slice(0, 10);
  for (let i = top.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [top[i], top[j]] = [top[j], top[i]];
  }
  const excluded = new Set(excludeUris.filter(Boolean));
  for (const cand of top) {
    const hit = await findSpotifyTrack(cand).catch(() => null);
    if (hit && !excluded.has(hit.uri)) return { ...hit, fromPlaylist: false, fromLastfm: true };
  }
  return null;
}

export function assembleSequence(vinyl, spotify, count) {
  const out = [];
  let v = 0; let s = 0;
  let next = vinyl.length ? 'vinyl' : 'spotify';
  while (out.length < count && (v < vinyl.length || s < spotify.length)) {
    if (next === 'vinyl' && v < vinyl.length) out.push(vinyl[v++]);
    else if (s < spotify.length) out.push(spotify[s++]);
    else out.push(vinyl[v++]);
    next = next === 'vinyl' ? 'spotify' : 'vinyl';
  }
  return out;
}

function spotifyTrack(r) {
  return {
    id: newId(),
    title: r.title,
    artist: r.artist,
    album: r.album || null,
    trackNumber: r.trackNumber ?? null,
    source: 'spotify',
    bpm: null,
    bpmEstimated: true,
    energy: 3,
    flavorTags: [],
    guestRequested: false,
    played: false,
    playedAt: null,
    addedAt: Date.now(),
    spotifyArt: r.albumArt || null,
    spotifyUri: r.uri || null,
  };
}

export function vinylTrack(record, song) {
  return {
    id: newId(),
    title: song.title,
    artist: record.artist,
    album: record.album,
    albumUnknown: !!song.albumUnknown,
    trackNumber: song.trackNumber ?? null,
    source: 'vinyl',
    bpm: null,
    bpmEstimated: true,
    energy: 3,
    flavorTags: [],
    guestRequested: false,
    played: false,
    playedAt: null,
    addedAt: Date.now(),
    spotifyArt: song.spotifyArt || null,
    spotifyUri: song.spotifyUri || null,
  };
}

export async function generateVibeSet(seeds, count, onProgress = () => {}) {
  if (!hasLastfmKey()) throw new LastfmError('Vibe sets use Last.fm. Add your free API key in Settings → Last.fm first.');

  onProgress('Finding songs like your seeds…');
  const pool = await buildSpotifyPool(seeds, seeds.map((s) => s.uri), count + 20);

  onProgress('Matching your collection…');
  const collection = await loadCollection();
  const profile = await buildSeedProfile(seeds.map((s) => s.artist));
  const scored = await scoreRecords(collection, profile, (done, total) => {
    onProgress('Learning your collection…', done, total);
  });
  const fitting = scored.filter((r) => r.score >= FIT_THRESHOLD);

  onProgress('Picking songs from your records…');
  const vinyl = [];
  let used = 0;
  const maxVinyl = Math.ceil(count / 2);
  for (; used < fitting.length && vinyl.length < maxVinyl; used++) {
    const { record } = fitting[used];
    const song = await pickSongForRecord(record);
    if (song) vinyl.push(vinylTrack(record, song));
  }

  const spotifyCands = [...seeds, ...pool].map(spotifyTrack);
  const set = assembleSequence(vinyl, spotifyCands, count);
  const usedUris = new Set(set.map((t) => t.spotifyUri));

  // All lookups done - only now replace the live set.
  Store.resetSetData();
  Store.saveTracks(set);
  Store.savePlanOrder(set.map((t) => t.id));
  Store.updateSettings({ planMode: 'sequence', setStartedAt: null, leverOverride: null, autoDrift: true });
  Store.saveLiveState({ lastPlayedTrackId: null, turn: 'vinyl' });
  Store.saveVibePool({
    spotify: pool.filter((p) => !usedUris.has(p.uri)),
    vinyl: fitting.slice(used),
  });
  Store.setLiveSpotifyPlaylist(null);

  const vinylCount = set.filter((t) => t.source === 'vinyl').length;
  return { count: set.length, vinylCount, spotifyCount: set.length - vinylCount, short: set.length < count };
}
