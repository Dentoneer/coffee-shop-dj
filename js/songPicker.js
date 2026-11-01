// Names a specific song for a vinyl record, so no row ever says "(DJ's
// choice)". The collection only knows artist + album, so:
//   1. album unknown -> the artist's most-played Last.fm track
//   2. Last.fm album tracklist ∩ artist top tracks -> the most-played one
//   3. else the album's first track (Last.fm tracklist)
//   4. else (no key / Last.fm doesn't know the album) Spotify's tracklist
//   5. else null - caller keeps "(DJ's choice)" as the last resort
// When logged into Spotify, the exact same-album recording is also looked up
// for art + Save to Spotify; spotifyUri stays null unless it's that version.

import { hasLastfmKey, getAlbumTrackTitles, getArtistTopTracks } from './lastfm.js?v=20261101vibe';
import { findExactVinylOnSpotify, normalizeTitle, artistMatches } from './matching.js?v=20261101vibe';
import { isLoggedIn, searchAlbums, getAlbumTracks } from './spotify.js?v=20261101vibe';

const loose = (t) => normalizeTitle(t, { loose: true });

function isAlbumUnknown(album) {
  return !album || /unspecified/i.test(album);
}

async function safe(fn, fallback) {
  try { return await fn(); } catch { return fallback; }
}

async function chooseTitle(record, excluded) {
  const unknown = isAlbumUnknown(record.album);
  const lastfm = hasLastfmKey();

  if (lastfm) {
    const top = await safe(() => getArtistTopTracks(record.artist), []);
    if (unknown) {
      const best = top.find((t) => !excluded.has(loose(t.title)));
      return best ? { title: best.title, trackNumber: null, albumUnknown: true } : null;
    }
    const tracklist = await safe(() => getAlbumTrackTitles(record.artist, record.album), []);
    const onAlbum = tracklist.map((title, i) => ({ title, trackNumber: i + 1 }))
      .filter((t) => !excluded.has(loose(t.title)));
    if (onAlbum.length) {
      const plays = new Map(top.map((t) => [loose(t.title), t.playcount]));
      const ranked = onAlbum.filter((t) => plays.has(loose(t.title)))
        .sort((a, b) => plays.get(loose(b.title)) - plays.get(loose(a.title)));
      return { ...(ranked[0] || onAlbum[0]), albumUnknown: false };
    }
  }

  if (!unknown && isLoggedIn()) {
    const albums = await safe(() => searchAlbums(`${record.album} ${record.artist}`, 5), []);
    const album = albums.find((a) => artistMatches(record.artist, a.artist));
    if (album) {
      const tracks = await safe(() => getAlbumTracks(album.id), []);
      const first = tracks.find((t) => !excluded.has(loose(t.title)));
      if (first) return { title: first.title, trackNumber: first.trackNumber, albumUnknown: false };
    }
  }
  return null;
}

export async function pickSongForRecord(record, opts = {}) {
  const excluded = new Set((opts.excludeTitles || []).map(loose));
  const chosen = await chooseTitle(record, excluded);
  if (!chosen) return null;

  let spotifyUri = null;
  let spotifyArt = null;
  if (!chosen.albumUnknown && isLoggedIn()) {
    const hit = await safe(() => findExactVinylOnSpotify({ artist: record.artist, title: chosen.title, album: record.album }), null);
    if (hit) {
      spotifyUri = hit.uri;
      spotifyArt = hit.albumArt || null;
    }
  }
  return { ...chosen, spotifyUri, spotifyArt };
}
