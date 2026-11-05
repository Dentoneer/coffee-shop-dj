// Last.fm API 2.0 client - the "vibe" source, since Spotify's own
// recommendations/audio-features are closed to new developer apps. Free API
// key, entered by the DJ in Settings (localStorage only, never committed).
// Every call goes through lastfmGet(): throttled to Last.fm's 5 req/s
// guideline and cached in localStorage (artist/album data rarely changes, so
// the ~189-record collection is only fetched once).

import { Store } from './store.js?v=20261105mix';

const API = 'https://ws.audioscrobbler.com/2.0/';
const CACHE_KEY = 'csdj.lastfmCache';
const CACHE_MAX = 2000;
const DAY = 24 * 3600e3;
const MIN_GAP_MS = 200;

export class LastfmError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'LastfmError';
    this.code = code;
  }
}

export function hasLastfmKey() {
  return !!(Store.getSettings().lastfmApiKey || '').trim();
}

// Serialized chain: each request starts at least MIN_GAP_MS after the last.
let chain = Promise.resolve();
let lastStart = 0;
export function _resetThrottleForTests() {
  chain = Promise.resolve();
  lastStart = 0;
}
function throttled(fn) {
  const run = chain.then(async () => {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
  });
  chain = run.catch(() => {});
  return run.then(fn);
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function writeCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => cache[a].at - cache[b].at)
      .slice(0, keys.length - CACHE_MAX)
      .forEach((k) => delete cache[k]);
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* quota - cache is best-effort */ }
}

const asArray = (x) => [].concat(x || []);

async function lastfmGet(method, params, { noCache = false } = {}) {
  const key = (Store.getSettings().lastfmApiKey || '').trim();
  if (!key) throw new LastfmError('Add your Last.fm API key in Settings first.');

  const query = new URLSearchParams({ method, ...params, autocorrect: '1', format: 'json' });
  const cacheId = query.toString();
  const ttl = method.startsWith('track.') ? 7 * DAY : 30 * DAY;
  const cache = readCache();
  const hit = cache[cacheId];
  if (!noCache && hit && Date.now() - hit.at < ttl) return hit.data;

  const data = await throttled(async () => {
    let res;
    try {
      res = await fetch(`${API}?${cacheId}&api_key=${encodeURIComponent(key)}`);
    } catch {
      throw new LastfmError('Last.fm unreachable');
    }
    let json;
    try { json = await res.json(); } catch { json = null; }
    if (json && json.error) throw new LastfmError(json.message || `Last.fm error ${json.error}`, json.error);
    if (!res.ok || !json) throw new LastfmError(`Last.fm unreachable (HTTP ${res.status})`);
    return json;
  });
  const fresh = readCache();
  fresh[cacheId] = { at: Date.now(), data };
  writeCache(fresh);
  return data;
}

/** Settings' "Test key": a real, uncached request, so a bad key can't pass on old cache. */
export async function checkLastfmKey() {
  await lastfmGet('artist.gettoptags', { artist: 'Radiohead' }, { noCache: true });
}

export async function getSimilarTracks(artist, title, limit = 50) {
  const d = await lastfmGet('track.getsimilar', { artist, track: title, limit: String(limit) });
  return asArray(d.similartracks?.track).map((t) => ({
    artist: t.artist?.name || '',
    title: t.name,
    match: Number(t.match) || 0,
  }));
}

export async function getSimilarArtists(artist, limit = 250) {
  const d = await lastfmGet('artist.getsimilar', { artist, limit: String(limit) });
  return asArray(d.similarartists?.artist).map((a) => ({ name: a.name, match: Number(a.match) || 0 }));
}

export async function getArtistTopTags(artist) {
  const d = await lastfmGet('artist.gettoptags', { artist });
  return asArray(d.toptags?.tag)
    .slice(0, 15)
    .map((t) => ({ name: String(t.name).toLowerCase(), count: Number(t.count) || 0 }));
}

export async function getArtistTopTracks(artist, limit = 50) {
  const d = await lastfmGet('artist.gettoptracks', { artist, limit: String(limit) });
  return asArray(d.toptracks?.track).map((t) => ({ title: t.name, playcount: Number(t.playcount) || 0 }));
}

export async function getAlbumTrackTitles(artist, album) {
  try {
    const d = await lastfmGet('album.getinfo', { artist, album });
    return asArray(d.album?.tracks?.track).map((t) => t.name);
  } catch (err) {
    if (err instanceof LastfmError && err.code === 6) return [];
    throw err;
  }
}
