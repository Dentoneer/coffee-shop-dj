// "Save this set" = save the snapshot in the app (always) + write it to a
// private Spotify playlist (when logged in with playlist permission). The
// playlist is the whole set in play order, vinyl included - but a vinyl song
// only goes in if Spotify has the exact same recording (same album); anything
// else is skipped and counted, never swapped for another version. Re-saving
// the same live set rewrites its playlist instead of creating another.

import { Store } from './store.js?v=20261101shame';
import { isLoggedIn, hasScope, createPlaylist, replacePlaylistItems, PlaylistGoneError } from './spotify.js?v=20261101shame';
import { findExactVinylOnSpotify } from './matching.js?v=20261101shame';
import { saveCurrentSet } from './savedSets.js?v=20261101shame';

/** Pure: the set's songs in play order, as Spotify URIs or vinyl to resolve. */
export function collectSetEntries({ mode, tracks, planOrder, plannedSpotify }) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const entry = (t) => (t.source === 'spotify' ? (t.spotifyUri ? { kind: 'spotify', uri: t.spotifyUri } : null) : { kind: 'vinyl', track: t });
  if (mode === 'sequence') return planOrder.map((id) => byId.get(id)).filter(Boolean).map(entry).filter(Boolean);

  const out = tracks.filter((t) => t.playedAt).sort((a, b) => a.playedAt - b.playedAt).map(entry).filter(Boolean);
  planOrder.map((id) => byId.get(id)).filter((t) => t && t.source === 'vinyl' && !t.played).forEach((v) => {
    out.push(entry(v));
    const pick = plannedSpotify?.[v.id];
    if (pick?.uri) out.push({ kind: 'spotify', uri: pick.uri });
  });
  return out;
}

export async function saveSetToSpotify(set, existingPlaylistId) {
  const entries = collectSetEntries({ mode: set.planMode, tracks: set.tracks, planOrder: set.planOrder, plannedSpotify: set.plannedSpotify });
  const uris = [];
  let skippedVinyl = 0;
  for (const e of entries) {
    if (e.kind === 'spotify') { uris.push(e.uri); continue; }
    const t = e.track;
    let uri = t.spotifyUri;
    if (!uri && t.title && t.title !== "(DJ's choice)" && !t.albumUnknown) {
      uri = (await findExactVinylOnSpotify({ artist: t.artist, title: t.title, album: t.album }).catch(() => null))?.uri || null;
    }
    if (uri) uris.push(uri); else skippedVinyl += 1;
  }

  let playlist = existingPlaylistId ? { id: existingPlaylistId, url: `https://open.spotify.com/playlist/${existingPlaylistId}` } : null;
  if (playlist) {
    try {
      await replacePlaylistItems(playlist.id, uris);
    } catch (err) {
      if (!(err instanceof PlaylistGoneError)) throw err;
      playlist = null; // deleted in Spotify since last save - start a new one
    }
  }
  if (!playlist) {
    playlist = await createPlaylist(set.name);
    await replacePlaylistItems(playlist.id, uris);
  }
  return { playlistId: playlist.id, url: playlist.url, added: uris.length, total: entries.length, skippedVinyl };
}

/**
 * The Save button: in-app save first (always succeeds), then Spotify.
 * Returns {set, spotify: result|null, reason?: 'logged-out'|'scope'|'error', error?}.
 */
export async function saveSetEverywhere(name) {
  const set = saveCurrentSet(name);
  if (!isLoggedIn()) return { set, spotify: null, reason: 'logged-out' };
  if (!hasScope('playlist-modify-private')) return { set, spotify: null, reason: 'scope' };
  try {
    const spotify = await saveSetToSpotify(set, Store.getLiveSpotifyPlaylist());
    Store.setLiveSpotifyPlaylist(spotify.playlistId);
    Store.updateSavedSet(set.id, { spotifyPlaylistId: spotify.playlistId, spotifyPlaylistUrl: spotify.url });
    return { set, spotify };
  } catch (error) {
    return { set, spotify: null, reason: 'error', error };
  }
}
