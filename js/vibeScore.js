// How well does each record in the collection fit the vibe of 3 seed songs?
// The seeds describe a GENRE, not bands the DJ wants to hear, so genre-tag
// overlap does most of the work (0.6) and Last.fm artist similarity the rest
// (0.4). A seed's own artist gets no automatic pass - it fits only if its
// records share the genre too.

import { getSimilarArtists, getArtistTopTags } from './lastfm.js?v=20261105genre';
import { normalizeText } from './matching.js?v=20261105genre';

export const FIT_THRESHOLD = 0.45;

const key = (name) => normalizeText(name).replace(/^the /, '');

function cosine(a, b) {
  if (!a.size || !b.size) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (const [k, v] of a) { na += v * v; if (b.has(k)) dot += v * b.get(k); }
  for (const v of b.values()) nb += v * v;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** artistTags: [{name, count}] from getArtistTopTags. Pure. */
export function scoreArtist(artist, seedProfile, artistTags = []) {
  const k = key(artist);
  const direct = seedProfile.seedNames.has(k) ? 1 : (seedProfile.similar.get(k) ?? 0);
  const tags = new Map(artistTags.map((t) => [t.name, t.count]));
  return 0.4 * direct + 0.6 * cosine(tags, seedProfile.tags);
}

export async function buildSeedProfile(seedArtists) {
  const unique = [...new Set(seedArtists.map(key))].map((k) => seedArtists.find((a) => key(a) === k));
  const seedNames = new Set(unique.map(key));
  const similar = new Map();
  const tags = new Map();
  for (const artist of unique) {
    const [sims, tops] = await Promise.all([
      getSimilarArtists(artist).catch(() => []),
      getArtistTopTags(artist).catch(() => []),
    ]);
    sims.forEach((s) => similar.set(key(s.name), Math.max(similar.get(key(s.name)) ?? 0, s.match)));
    tops.forEach((t) => tags.set(t.name, (tags.get(t.name) ?? 0) + t.count));
  }
  return { seedNames, similar, tags };
}

export async function scoreRecords(collection, seedProfile, onProgress = () => {}) {
  const artists = [...new Set(collection.map((r) => r.artist))];
  const tagsByArtist = new Map();
  for (let i = 0; i < artists.length; i++) {
    tagsByArtist.set(artists[i], await getArtistTopTags(artists[i]).catch(() => []));
    onProgress(i + 1, artists.length);
  }
  return collection
    .map((record) => ({ record, score: scoreArtist(record.artist, seedProfile, tagsByArtist.get(record.artist)) }))
    .sort((a, b) => b.score - a.score);
}
