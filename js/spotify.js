// Spotify Authorization Code + PKCE, entirely client-side. No secret —
// that's the point of PKCE for a public static site. Used only for catalog
// search (track lookup, album art); no playback control, no audio-features.

import { Store } from './store.js?v=20260917u';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

function base64UrlEncode(bytes) {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return base64UrlEncode(bytes);
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function redirectUri() {
  return `${location.origin}${location.pathname}`;
}

export function isConfigured() {
  return !!Store.getSettings().spotifyClientId;
}

export function isLoggedIn() {
  const auth = Store.getSpotifyAuth();
  return !!(auth && auth.accessToken && auth.expiresAt > Date.now());
}

export async function login() {
  const clientId = Store.getSettings().spotifyClientId;
  if (!clientId) throw new Error('Set your Spotify Client ID in Settings first.');

  const verifier = randomVerifier();
  Store.savePkceVerifier(verifier);
  const challenge = await sha256(verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    // playlist-read-*: lets the Live Set bridge pull from the DJ's own
    // playlists instead of only cold catalog search.
    scope: 'playlist-read-private playlist-read-collaborative',
    // Without this, Spotify silently re-issues a token on whatever scope
    // was already approved if the app was ever authorized before, with no
    // visible prompt - so adding a new scope later never actually reaches
    // the user. Forces the consent screen every time so a newly-added
    // scope is something they can actually see and grant.
    show_dialog: 'true',
  });
  location.href = `${AUTH_URL}?${params.toString()}`;
}

/** Call once on page load. Handles the ?code=... redirect if present. */
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return false;

  const verifier = Store.getPkceVerifier();
  const clientId = Store.getSettings().spotifyClientId;
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    console.error('Spotify token exchange failed', await res.text());
    return false;
  }
  const data = await res.json();
  Store.saveSpotifyAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  Store.clearPkceVerifier();

  // Strip ?code=... from the URL so a refresh doesn't try to replay it.
  history.replaceState({}, '', redirectUri());
  return true;
}

async function refresh() {
  const auth = Store.getSpotifyAuth();
  const clientId = Store.getSettings().spotifyClientId;
  if (!auth?.refreshToken) throw new Error('Not logged into Spotify.');

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('Spotify token refresh failed.');
  const data = await res.json();
  Store.saveSpotifyAuth({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || auth.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
}

async function getValidToken() {
  const auth = Store.getSpotifyAuth();
  if (!auth) throw new Error('Not logged into Spotify.');
  if (auth.expiresAt <= Date.now() + 5000) await refresh();
  return Store.getSpotifyAuth().accessToken;
}

/** Search the Spotify catalog for tracks. Returns a small display-friendly list. */
export async function searchTracks(query, limit = 8) {
  const token = await getValidToken();
  const params = new URLSearchParams({ q: query, type: 'track', limit: String(limit) });
  const res = await fetch(`${API_BASE}/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
  const data = await res.json();
  return (data.tracks?.items || []).map((t) => ({
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    album: t.album?.name,
    trackNumber: t.track_number ?? null,
    albumArt: t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || null,
    uri: t.uri,
    externalUrl: t.external_urls?.spotify,
  }));
}

/** Search the Spotify catalog for albums (used when the DJ only has the vinyl/album name, not a specific song). */
export async function searchAlbums(query, limit = 5) {
  const token = await getValidToken();
  const params = new URLSearchParams({ q: query, type: 'album', limit: String(limit) });
  const res = await fetch(`${API_BASE}/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify album search failed: ${res.status}`);
  const data = await res.json();
  return (data.albums?.items || []).map((a) => ({
    id: a.id,
    name: a.name,
    artist: a.artists.map((x) => x.name).join(', '),
    albumArt: a.images?.[2]?.url || a.images?.[0]?.url || null,
  }));
}

/** Full tracklist of an album, so the DJ can pick a real track number/title. */
export async function getAlbumTracks(albumId, limit = 50) {
  const token = await getValidToken();
  const res = await fetch(`${API_BASE}/albums/${albumId}/tracks?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify album tracks failed: ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((t) => ({
    trackNumber: t.track_number ?? null,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    uri: t.uri,
  }));
}

/** Accepts a full playlist URL, a spotify: URI, or a bare ID and returns the ID. */
export function parsePlaylistId(input) {
  const s = input.trim();
  const urlMatch = s.match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  return s;
}

/** Just the display name/cover/owner of a playlist - cheap, for labeling it in the UI. */
export async function getPlaylistMeta(playlistId) {
  const token = await getValidToken();
  const params = new URLSearchParams({ fields: 'name,images,owner(display_name),tracks(total)' });
  const res = await fetch(`${API_BASE}/playlists/${playlistId}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify playlist info failed: ${res.status}`);
  const data = await res.json();
  return {
    id: playlistId,
    name: data.name || playlistId,
    image: data.images?.[data.images.length - 1]?.url || data.images?.[0]?.url || null,
    owner: data.owner?.display_name || null,
    total: data.tracks?.total ?? null,
  };
}

/** Up to `limit` tracks from one of the DJ's own playlists (paginated 50 at a time). */
export async function getPlaylistTracks(playlistId, limit = 100) {
  const token = await getValidToken();
  const out = [];
  for (let offset = 0; offset < limit; offset += 50) {
    const params = new URLSearchParams({
      limit: String(Math.min(50, limit - offset)),
      offset: String(offset),
      // No `fields` filter: Spotify's March 2026 migration also trimmed
      // response objects, and a filter expression naming a field that no
      // longer exists silently returns nothing rather than erroring -
      // that's what happened here. Fetching the full object and parsing
      // defensively is safer than guessing the new trimmed shape.
    });
    // /playlists/{id}/tracks was deprecated and removed for Development
    // Mode apps in Spotify's March 2026 migration - renamed to /items.
    const res = await fetch(`${API_BASE}/playlists/${playlistId}/items?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Spotify playlist fetch failed: ${res.status}`);
    const data = await res.json();
    const items = data.items || [];
    if (offset === 0) console.debug('Spotify playlist items sample:', items[0]);
    items.forEach((item) => {
      // Confirmed from a real raw response: Spotify's /items endpoint (the
      // March 2026 rename from /tracks) nests the actual track object
      // under a key literally named "item" - not "track" as the old
      // /tracks endpoint used. Still tolerate the old shape and a flat
      // one too, in roughly most-to-least-likely order.
      const t = item.item || item.track || item;
      // Only a title is truly required - uri may simply be absent from
      // Spotify's trimmed Dev Mode response, and a track we can name is
      // still perfectly usable (it just can't be deduped by uri).
      const title = t?.name || t?.title;
      if (!title) return;
      out.push({
        title,
        artist: (t.artists || []).map((a) => a?.name).filter(Boolean).join(', '),
        album: t.album?.name,
        trackNumber: t.track_number ?? null,
        albumArt: t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || null,
        uri: t.uri || null,
        externalUrl: t.external_urls?.spotify,
      });
    });
    if (items.length < 50) break; // reached the end of the playlist
  }
  return out;
}

/** Raw first item of a playlist, unparsed - for showing the DJ (or us)
 * exactly what Spotify is actually returning when the normal parse comes
 * back empty, without needing to open DevTools mid-event. */
export async function getPlaylistRawSample(playlistId) {
  const token = await getValidToken();
  const res = await fetch(`${API_BASE}/playlists/${playlistId}/items?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) return { status: res.status, body: text.slice(0, 500) };
  try {
    const data = JSON.parse(text);
    const item = data.items?.[0];
    // Pretty-print just the one item's keys (top level and, if present,
    // one level into "track") instead of the whole raw envelope - the
    // wrapper's href/added_by boilerplate was eating the truncation
    // budget before showing the field that actually matters.
    const summary = item ? {
      itemTopLevelKeys: Object.keys(item),
      hasTrackKey: 'track' in item,
      trackKeys: item.track ? Object.keys(item.track) : null,
      item: item,
    } : { note: 'items array is empty', totalReported: data.total };
    return { status: res.status, body: JSON.stringify(summary, null, 1).slice(0, 2500) };
  } catch (e) {
    return { status: res.status, body: `(failed to parse as JSON) ${text.slice(0, 500)}` };
  }
}

export function logout() {
  Store.clearSpotifyAuth();
}
