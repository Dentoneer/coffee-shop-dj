// Single shared cache of "the DJ's playlist tracks," synced once and reused
// by Live Set (bridge picks) and the Spotify Corner tab, instead of each
// screen fetching independently. "Seamless" means: sync kicks off in the
// background on login/app init, any screen can await the same in-flight
// fetch, and there's one place (getSyncStatus) that always knows what
// happened last, for real status instead of silence.

import { Store } from './store.js?v=20260918b';
import { isLoggedIn, getPlaylistTracks, getPlaylistMeta, parsePlaylistId } from './spotify.js?v=20260918b';

let status = {
  at: null,        // Date.now() of the last completed sync, or null if never
  tracks: [],       // flat list of every track from every configured playlist
  playlists: [],     // [{id, name, image, owner, total, ok, count, error}]
  syncing: false,
  reason: null,      // 'no-playlists' | 'not-logged-in' | null
};
let inFlight = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(status));
}

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSyncStatus() {
  return status;
}

function configuredIds() {
  const raw = Store.getSettings().spotifyPlaylistUrls || '';
  return raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map(parsePlaylistId);
}

/**
 * Fetches every configured playlist's tracks + metadata. Reuses an
 * in-flight sync unless `force` is set (e.g. the DJ just changed the
 * playlist list or wants a manual refresh).
 */
export function syncPlaylists({ force = false } = {}) {
  if (inFlight && !force) return inFlight;

  const ids = configuredIds();
  if (ids.length === 0) {
    status = { at: Date.now(), tracks: [], playlists: [], syncing: false, reason: 'no-playlists' };
    notify();
    inFlight = Promise.resolve(status);
    return inFlight;
  }
  if (!isLoggedIn()) {
    status = { ...status, syncing: false, reason: 'not-logged-in' };
    notify();
    inFlight = Promise.resolve(status);
    return inFlight;
  }

  status = { ...status, syncing: true, reason: null };
  notify();

  inFlight = (async () => {
    const results = await Promise.all(ids.map(async (id) => {
      const meta = await getPlaylistMeta(id).catch((e) => ({ id, name: id, error: e.message }));
      try {
        const tracks = await getPlaylistTracks(id);
        return { ...meta, ok: true, count: tracks.length, tracks };
      } catch (e) {
        return { ...meta, ok: false, count: 0, error: e.message, tracks: [] };
      }
    }));
    const tracks = results.flatMap((r) => r.tracks.map((t) => ({ ...t, playlistName: r.name })));
    status = {
      at: Date.now(),
      tracks,
      playlists: results.map(({ tracks, ...rest }) => rest),
      syncing: false,
      reason: null,
    };
    notify();
    return status;
  })();
  return inFlight;
}

/** Kicks off a sync without blocking the caller - fire-and-forget for "seamless" auto-sync on load/login. */
export function syncPlaylistsInBackground() {
  syncPlaylists().catch((e) => console.warn('Background playlist sync failed', e));
}
