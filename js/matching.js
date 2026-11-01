// When does a Spotify search result count as "the same song"? Two rules:
// - loose (Last.fm candidates, seeds): same artist + same song, any version.
// - exact (the DJ's vinyl, for Save to Spotify): same artist + song + ALBUM.
//   Only a remaster/deluxe-style album suffix is tolerated - never the studio
//   cut for a live record, a compilation, or a single. No confident match ->
//   skip, never guess.

import { searchTracks } from './spotify.js?v=20261101vibe';

export function normalizeText(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const REMASTER_DASH = /\s+-\s+[^-]*\bremaster(ed)?\b.*$/i;
const REMASTER_PAREN = /\s*[([][^)\]]*\bremaster(ed|izado)?\b[^)\]]*[)\]]/gi;

export function normalizeTitle(s, { loose } = { loose: false }) {
  let t = String(s || '').replace(REMASTER_DASH, '').replace(REMASTER_PAREN, '');
  if (loose) {
    t = t.replace(/\s*[([][^)\]]*[)\]]/g, '')
      .replace(/\s+-\s+.*\b(live|version|edit|mix|remix|mono|stereo|en vivo)\b.*$/i, '');
  }
  return normalizeText(t);
}

const ALBUM_EDITION = /(remaster|deluxe|edition|expanded|anniversary)/i;

export function normalizeAlbum(s) {
  let a = String(s || '');
  a = a.replace(/\s*[([]([^)\]]*)[)\]]\s*$/, (m, inner) => (ALBUM_EDITION.test(inner) ? '' : m));
  a = a.replace(/\s+-\s+(.*)$/, (m, tail) => (ALBUM_EDITION.test(tail) ? '' : m));
  return normalizeText(a);
}

const stripThe = (s) => s.replace(/^the /, '');

export function artistMatches(want, got) {
  const w = stripThe(normalizeText(want));
  if (!w) return false;
  return String(got || '').split(',').some((part) => stripThe(normalizeText(part)) === w);
}

export function isLooseTrackMatch(want, got) {
  return artistMatches(want.artist, got.artist)
    && normalizeTitle(want.title, { loose: true }) === normalizeTitle(got.title, { loose: true });
}

export function isExactVinylMatch(want, got) {
  return artistMatches(want.artist, got.artist)
    && normalizeTitle(want.title) === normalizeTitle(got.title)
    && normalizeAlbum(want.album) === normalizeAlbum(got.album);
}

const q = (s) => String(s || '').replace(/"/g, '');

export async function findSpotifyTrack({ artist, title }) {
  const results = await searchTracks(`track:"${q(title)}" artist:"${q(artist)}"`, 5);
  return results.find((r) => isLooseTrackMatch({ artist, title }, r)) || null;
}

export async function findExactVinylOnSpotify({ artist, title, album }) {
  const results = await searchTracks(`track:"${q(title)}" artist:"${q(artist)}" album:"${q(album)}"`, 10);
  return results.find((r) => isExactVinylMatch({ artist, title, album }, r)) || null;
}
