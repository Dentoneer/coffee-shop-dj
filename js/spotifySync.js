// Single shared cache of "the DJ's playlist tracks," synced once and reused
// by Live Set (bridge picks) and the Spotify Corner tab, instead of each
// screen fetching independently. "Seamless" means: every playlist in the
// DJ's Spotify library is discovered and synced automatically (no pasting
// links one at a time), it kicks off in the background on login/app init,
// it re-syncs itself periodically so new songs added mid-set show up
// without asking, and there's one place (getSyncStatus) that always knows
// what happened last, for real status instead of silence.

import { isLoggedIn, getAllUserPlaylists, getPlaylistTracks } from './spotify.js?v=20261006kp';

let status = {
  at: null,        // Date.now() of the last completed sync, or null if never
  tracks: [],       // flat list of every track from every playlist in the DJ's library
  playlists: [],     // [{id, name, image, owner, total, ok, count, error}]
  syncing: false,
  reason: null,      // 'no-playlists' | 'not-logged-in' | 'list-failed' | null
  error: null,
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

// Fetches playlists a few at a time rather than all at once - a DJ with a
// large library could otherwise fire dozens of concurrent requests and trip
// Spotify's rate limiting.
const PLAYLIST_FETCH_CONCURRENCY = 5;
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Discovers and fetches every playlist in the DJ's Spotify library. Reuses
 * an in-flight sync unless `force` is set (e.g. a manual refresh, or the
 * periodic auto-refresh below).
 */
export function syncPlaylists({ force = false } = {}) {
  if (inFlight && !force) return inFlight;

  if (!isLoggedIn()) {
    status = { ...status, syncing: false, reason: 'not-logged-in' };
    notify();
    inFlight = Promise.resolve(status);
    return inFlight;
  }

  status = { ...status, syncing: true, reason: null };
  notify();

  inFlight = (async () => {
    let playlistsMeta;
    try {
      playlistsMeta = await getAllUserPlaylists();
    } catch (e) {
      status = { ...status, syncing: false, reason: 'list-failed', error: e.message };
      notify();
      return status;
    }
    if (playlistsMeta.length === 0) {
      status = { at: Date.now(), tracks: [], playlists: [], syncing: false, reason: 'no-playlists', error: null };
      notify();
      return status;
    }
    const results = await mapLimit(playlistsMeta, PLAYLIST_FETCH_CONCURRENCY, async (meta) => {
      try {
        const tracks = await getPlaylistTracks(meta.id);
        return { ...meta, ok: true, count: tracks.length, tracks };
      } catch (e) {
        return { ...meta, ok: false, count: 0, error: e.message, tracks: [] };
      }
    });
    const tracks = results.flatMap((r) => r.tracks.map((t) => ({ ...t, playlistName: r.name, playlistId: r.id })));
    status = {
      at: Date.now(),
      tracks,
      playlists: results.map(({ tracks, ...rest }) => rest),
      syncing: false,
      reason: null,
      error: null,
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

// "Keep it fresh": re-sync periodically while the app is open (so a track
// added to a playlist mid-set shows up without the DJ doing anything), and
// catch up immediately if the tab comes back into view after sitting long
// enough that the cache could plausibly be stale.
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const STALE_ON_RETURN_MS = 5 * 60 * 1000;
let autoRefreshStarted = false;

export function startAutoRefresh() {
  if (autoRefreshStarted) return;
  autoRefreshStarted = true;
  setInterval(() => {
    if (isLoggedIn()) syncPlaylistsInBackground();
  }, AUTO_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !isLoggedIn()) return;
    if (!status.at || Date.now() - status.at > STALE_ON_RETURN_MS) syncPlaylistsInBackground();
  });
}
