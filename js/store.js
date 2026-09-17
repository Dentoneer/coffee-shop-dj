// localStorage-backed data layer. Everything lives under one namespaced key
// per concern so export/import can grab it all in one shot.

const KEYS = {
  tracks: 'csdj.tracks',
  planOrder: 'csdj.planOrder',
  settings: 'csdj.settings',
  spotifyAuth: 'csdj.spotifyAuth',
  spotifyPkce: 'csdj.spotifyPkceVerifier',
  liveState: 'csdj.liveState',
  plannedSpotify: 'csdj.plannedSpotify',
};

const DEFAULT_SETTINGS = {
  spotifyClientId: '',
  setDurationMinutes: 120,
  leverStart: 2,
  leverEnd: 4,
  setStartedAt: null,
  autoDrift: true,
  leverOverride: null, // manual value when auto-drift is paused
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('store: failed to read', key, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const Store = {
  getTracks() {
    return readJSON(KEYS.tracks, []);
  },
  saveTracks(tracks) {
    writeJSON(KEYS.tracks, tracks);
  },
  addTrack(track) {
    const tracks = Store.getTracks();
    tracks.push(track);
    Store.saveTracks(tracks);
    return track;
  },
  updateTrack(id, patch) {
    const tracks = Store.getTracks();
    const idx = tracks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    tracks[idx] = { ...tracks[idx], ...patch };
    Store.saveTracks(tracks);
    return tracks[idx];
  },
  getTrack(id) {
    return Store.getTracks().find((t) => t.id === id) || null;
  },

  getPlanOrder() {
    return readJSON(KEYS.planOrder, []);
  },
  savePlanOrder(order) {
    writeJSON(KEYS.planOrder, order);
  },

  getSettings() {
    return { ...DEFAULT_SETTINGS, ...readJSON(KEYS.settings, {}) };
  },
  saveSettings(settings) {
    writeJSON(KEYS.settings, settings);
  },
  updateSettings(patch) {
    const settings = { ...Store.getSettings(), ...patch };
    Store.saveSettings(settings);
    return settings;
  },

  getSpotifyAuth() {
    return readJSON(KEYS.spotifyAuth, null);
  },
  saveSpotifyAuth(auth) {
    writeJSON(KEYS.spotifyAuth, auth);
  },
  clearSpotifyAuth() {
    localStorage.removeItem(KEYS.spotifyAuth);
  },

  getPkceVerifier() {
    return localStorage.getItem(KEYS.spotifyPkce);
  },
  savePkceVerifier(verifier) {
    localStorage.setItem(KEYS.spotifyPkce, verifier);
  },
  clearPkceVerifier() {
    localStorage.removeItem(KEYS.spotifyPkce);
  },

  // last-played track id + whose turn it is, so a refresh mid-set doesn't
  // lose your place.
  getLiveState() {
    return readJSON(KEYS.liveState, { lastPlayedTrackId: null, turn: 'vinyl' });
  },
  saveLiveState(state) {
    writeJSON(KEYS.liveState, state);
  },

  // Clears tracks/plan/live-progress only - keeps the Spotify Client ID,
  // Spotify login, and set-arc settings, since those are annoying to redo
  // (especially the Client ID) and have nothing to do with "start a fresh
  // crate."
  resetSetData() {
    localStorage.removeItem(KEYS.tracks);
    localStorage.removeItem(KEYS.planOrder);
    localStorage.removeItem(KEYS.liveState);
    localStorage.removeItem(KEYS.plannedSpotify);
  },

  // Planned (not-yet-played) Spotify picks for upcoming bridge slots,
  // keyed by the id of the vinyl track that precedes that slot - each
  // vinyl has exactly one Spotify slot after it under strict alternation.
  // Lets the DJ preview and change a future Spotify pick before it's live.
  getPlannedSpotifyMap() {
    return readJSON(KEYS.plannedSpotify, {});
  },
  getPlannedSpotifyFor(afterVinylId) {
    return Store.getPlannedSpotifyMap()[afterVinylId] || null;
  },
  setPlannedSpotifyFor(afterVinylId, pick) {
    const map = Store.getPlannedSpotifyMap();
    map[afterVinylId] = pick;
    writeJSON(KEYS.plannedSpotify, map);
  },
  clearPlannedSpotifyFor(afterVinylId) {
    const map = Store.getPlannedSpotifyMap();
    delete map[afterVinylId];
    writeJSON(KEYS.plannedSpotify, map);
  },

  exportAll() {
    return {
      tracks: Store.getTracks(),
      planOrder: Store.getPlanOrder(),
      settings: Store.getSettings(),
      liveState: Store.getLiveState(),
      plannedSpotify: Store.getPlannedSpotifyMap(),
      exportedAt: new Date().toISOString(),
    };
  },
  importAll(data) {
    if (data.tracks) Store.saveTracks(data.tracks);
    if (data.planOrder) Store.savePlanOrder(data.planOrder);
    if (data.settings) Store.saveSettings(data.settings);
    if (data.liveState) Store.saveLiveState(data.liveState);
    if (data.plannedSpotify) writeJSON(KEYS.plannedSpotify, data.plannedSpotify);
  },
};

export function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export const FLAVOR_TAGS = [
  'Latin/Bossa/Cumbia',
  'Jazz/Soul',
  'Lo-fi/Chill',
  'Indie/Folk',
  'Funk/Groove',
  'World',
  'Vocal',
  'Instrumental',
];
