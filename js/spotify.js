// Spotify Authorization Code + PKCE, entirely client-side. No secret —
// that's the point of PKCE for a public static site. Used only for catalog
// search (track lookup, album art); no playback control, no audio-features.

import { Store } from './store.js?v=20260917d';

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
    scope: '',
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

export function logout() {
  Store.clearSpotifyAuth();
}
