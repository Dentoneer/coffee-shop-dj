// Seed-vibe sets: the DJ picks 3 Spotify songs, Last.fm supplies songs that
// listeners pair with them, and the DJ's own collection supplies the records
// whose artists sit closest to that vibe. The result is a "sequence" set:
// vinyl and Spotify alternate while fitting vinyl lasts, then it's Spotify
// only. Nothing is written to the live set (or to Spotify) until every
// lookup has succeeded, so a failure never leaves a half-built set.

import { Store, newId } from './store.js?v=20261105genre';
import { hasLastfmKey, getSimilarTracks, getTrackTopTags, getArtistTopTags, getTagTopTracks, LastfmError } from './lastfm.js?v=20261105genre';
import { findSpotifyTrack, normalizeText, normalizeTitle } from './matching.js?v=20261105genre';
import { buildSeedProfile, scoreRecords, FIT_THRESHOLD } from './vibeScore.js?v=20261105genre';
import { pickSongForRecord } from './songPicker.js?v=20261105genre';
import { loadCollection } from './crateGenerator.js?v=20261105genre';

// Spotify joins collaborators ("Daft Punk, Pharrell Williams"); Last.fm
// only knows the lead artist.
export const primaryArtist = (artist) => String(artist || '').split(', ')[0];

const songKey = (artist, title) => `${normalizeText(artist)}|${normalizeTitle(title, { loose: true })}`;

/** Merges Last.fm similar tracks from several seeds, best-shared first. */
async function rankSimilar(seeds, limit) {
  const merged = new Map();
  let anyData = false;
  for (const s of seeds) {
    const sims = await getSimilarTracks(primaryArtist(s.artist), s.title, limit).catch(unlessNotFound);
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

// Tags that say nothing about genre.
const JUNK_TAGS = new Set(['seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'love', 'loved', 'awesome',
  'beautiful', 'albums i own', 'my favorite', 'cool', 'good', 'best', 'amazing', 'under 2000 listeners']);

const artistKey = (artist) => normalizeText(primaryArtist(artist)).replace(/^the /, '');

// "not found" (6) just means Last.fm doesn't know this seed; anything else
// (bad key, unreachable) is the DJ's to fix, so it propagates.
const unlessNotFound = (err) => {
  if (err instanceof LastfmError && err.code !== 6) throw err;
  return [];
};

/** The seeds' top genre tags (up to 3), summed across seeds. */
export async function seedGenres(seeds) {
  const counts = new Map();
  const seedArtists = new Set(seeds.map((s) => normalizeText(primaryArtist(s.artist))));
  for (const s of seeds) {
    let tags = await getTrackTopTags(primaryArtist(s.artist), s.title).catch(unlessNotFound);
    if (!tags.length) tags = await getArtistTopTags(primaryArtist(s.artist)).catch(unlessNotFound);
    tags.forEach((t) => {
      if (JUNK_TAGS.has(t.name) || /^\d+s?$/.test(t.name) || seedArtists.has(normalizeText(t.name))) return;
      counts.set(t.name, (counts.get(t.name) ?? 0) + t.count);
    });
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
}

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Spotify candidates for a vibe set: songs listeners pair with the seeds,
 * interleaved with popular songs from the seeds' genres (shuffled, so each
 * Generate differs). The seed songs themselves are left out, and each artist
 * appears at most once - the seeds set the genre, not the band list.
 */
export async function buildSpotifyPool(seeds, excludeUris, want = 60) {
  const { ranked } = await rankSimilar(seeds, 50);
  const genres = await seedGenres(seeds);
  const perTag = [];
  for (const tag of genres) perTag.push(shuffled(await getTagTopTracks(tag, 50).catch(unlessNotFound)));
  const genreTracks = [];
  for (let i = 0; perTag.some((l) => i < l.length); i++) perTag.forEach((l) => { if (l[i]) genreTracks.push(l[i]); });
  if (!ranked.length && !genreTracks.length) throw new Error('Last.fm has no similar songs for these seeds');

  const candidates = [];
  for (let i = 0; i < Math.max(ranked.length, genreTracks.length); i++) {
    if (ranked[i]) candidates.push(ranked[i]);
    if (genreTracks[i]) candidates.push(genreTracks[i]);
  }

  const excluded = new Set(excludeUris.filter(Boolean));
  const seedKeys = new Set(seeds.map((s) => songKey(s.artist, s.title)));
  const usedArtists = new Set();
  const pool = [];
  for (const cand of candidates) {
    if (pool.length >= want) break;
    if (seedKeys.has(songKey(cand.artist, cand.title)) || usedArtists.has(artistKey(cand.artist))) continue;
    const hit = await findSpotifyTrack(cand).catch(() => null);
    if (!hit || excluded.has(hit.uri)) continue;
    excluded.add(hit.uri);
    usedArtists.add(artistKey(cand.artist));
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

/**
 * mix: 'mixed' (vinyl/Spotify alternate while fitting records last, then
 * Spotify), 'vinyl' (records only - the whole collection ranked by vibe, so
 * the DJ always gets `count` songs, closest matches first), or 'spotify'
 * (seeds + Last.fm songs only; the collection is never scored).
 */
export async function generateVibeSet(seeds, count, onProgress = () => {}, mix = 'mixed') {
  if (!hasLastfmKey()) throw new LastfmError('Vibe sets use Last.fm. Add your free API key in Settings → Last.fm first.');

  let pool = [];
  if (mix !== 'vinyl') {
    onProgress('Finding songs like your seeds…');
    pool = await buildSpotifyPool(seeds, seeds.map((s) => s.uri), count + 20);
  }

  let ranked = [];
  if (mix !== 'spotify') {
    onProgress('Matching your collection…');
    const collection = await loadCollection();
    const profile = await buildSeedProfile(seeds.map((s) => primaryArtist(s.artist)));
    const scored = await scoreRecords(collection, profile, (done, total) => {
      onProgress('Learning your collection…', done, total);
    });
    ranked = mix === 'vinyl' ? scored : scored.filter((r) => r.score >= FIT_THRESHOLD);
  }

  onProgress('Picking songs from your records…');
  const vinyl = [];
  let used = 0;
  const maxVinyl = mix === 'vinyl' ? count : Math.ceil(count / 2);
  const vinylArtists = new Set();
  for (; used < ranked.length && vinyl.length < maxVinyl; used++) {
    const { record } = ranked[used];
    if (vinylArtists.has(artistKey(record.artist))) continue; // one record per artist
    const song = await pickSongForRecord(record);
    if (song) {
      vinyl.push(vinylTrack(record, song));
      vinylArtists.add(artistKey(record.artist));
    }
  }
  if (mix === 'vinyl' && vinyl.length === 0) throw new Error('Could not name a song for any of your records — check your Last.fm key or try Mixed.');

  // Seeds only set the vibe; they and artists already on vinyl stay out.
  const spotifyCands = mix === 'vinyl' ? [] : pool.filter((p) => !vinylArtists.has(artistKey(p.artist))).map(spotifyTrack);
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
    vinyl: ranked.slice(used),
  });
  Store.setLiveSpotifyPlaylist(null);

  const vinylCount = set.filter((t) => t.source === 'vinyl').length;
  return { count: set.length, vinylCount, spotifyCount: set.length - vinylCount, short: set.length < count };
}
