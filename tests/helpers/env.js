// Browser-ish globals for running js/ modules under node:test: an in-memory
// localStorage and a routable fetch mock. Call installEnv() before importing
// any module under test (modules read localStorage lazily, so one install per
// test file is enough; resetEnv() between tests clears storage + routes).

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

export const fetchCalls = [];
let handler = () => ({ status: 404, json: { error: 'no mock route' } });

/** handler(url: URL, init) => {status, json} (may be async). */
export function mockFetch(fn) {
  handler = fn;
}

export function installEnv() {
  globalThis.localStorage = new MemoryStorage();
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    fetchCalls.push({ url, init, at: Date.now() });
    const { status = 200, json = {} } = await handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    };
  };
}

export function resetEnv() {
  globalThis.localStorage.clear();
  fetchCalls.length = 0;
  handler = () => ({ status: 404, json: { error: 'no mock route' } });
}

/** Pretend the DJ is logged into Spotify with a non-expired token. */
export function fakeSpotifyLogin(scope = 'playlist-read-private playlist-modify-private') {
  localStorage.setItem('csdj.spotifyAuth', JSON.stringify({
    accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3600e3, scope,
  }));
}

export function setSettings(patch) {
  const cur = JSON.parse(localStorage.getItem('csdj.settings') || '{}');
  localStorage.setItem('csdj.settings', JSON.stringify({ ...cur, ...patch }));
}

/** Route a request by host: { lastfm: (url) => ..., spotify: (url, init) => ... }. */
export function routeByHost({ lastfm, spotify }) {
  mockFetch((url, init) => {
    if (url.host === 'ws.audioscrobbler.com' && lastfm) return lastfm(url, init);
    if (url.host === 'api.spotify.com' && spotify) return spotify(url, init);
    return { status: 404, json: { error: 'unrouted ' + url.href } };
  });
}
