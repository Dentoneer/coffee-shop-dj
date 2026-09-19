// Named, dated snapshots of a set: tracks, plan, mood arc, duration, and a
// handful of derived stats worth keeping for later reference ("what did I
// play at that party"). Separate from the live tracks/planOrder, which
// keep changing under the DJ's feet - saving one is a point-in-time copy,
// never a live link.

import { Store, newId } from './store.js?v=20260918b';

/** Builds a full snapshot of the current set under `name`. Does not touch the live set. */
export function buildSnapshot(name) {
  const tracks = Store.getTracks();
  const planOrder = Store.getPlanOrder();
  const settings = Store.getSettings();

  const vinylTracks = tracks.filter((t) => t.source === 'vinyl');
  const spotifyTracks = tracks.filter((t) => t.source === 'spotify');
  const playedTracks = tracks.filter((t) => t.playedAt);
  const guestTracks = tracks.filter((t) => t.guestRequested);
  const bpms = tracks.map((t) => t.bpm).filter((b) => b != null);
  const flavorSet = new Set();
  tracks.forEach((t) => (t.flavorTags || []).forEach((f) => flavorSet.add(f)));
  const artists = [...new Set(vinylTracks.map((t) => t.artist).filter(Boolean))];

  let actualDurationMinutes = null;
  if (settings.setStartedAt && playedTracks.length > 0) {
    const lastPlayedAt = Math.max(...playedTracks.map((t) => t.playedAt));
    if (lastPlayedAt > settings.setStartedAt) {
      actualDurationMinutes = Math.round((lastPlayedAt - settings.setStartedAt) / 60000);
    }
  }

  return {
    id: newId(),
    name: name.trim() || `Set — ${new Date().toLocaleDateString()}`,
    savedAt: Date.now(),
    plannedDurationMinutes: settings.setDurationMinutes,
    actualDurationMinutes,
    setStartedAt: settings.setStartedAt,
    leverStart: settings.leverStart,
    leverEnd: settings.leverEnd,
    vinylCount: vinylTracks.length,
    spotifyCount: spotifyTracks.length,
    playedCount: playedTracks.length,
    totalCount: tracks.length,
    guestCount: guestTracks.length,
    bpmRange: bpms.length ? [Math.min(...bpms), Math.max(...bpms)] : null,
    flavorTags: [...flavorSet],
    artists,
    tracks,
    planOrder,
  };
}

export function saveCurrentSet(name) {
  return Store.addSavedSet(buildSnapshot(name));
}

function moodWord(v) {
  if (v == null) return '?';
  if (v <= 1.5) return 'chill';
  if (v <= 2.5) return 'mellow';
  if (v <= 3.5) return 'mid';
  if (v <= 4.5) return 'upbeat';
  return 'party';
}

export function summaryLine(set) {
  const arc = `${moodWord(set.leverStart)} → ${moodWord(set.leverEnd)}`;
  const dur = set.actualDurationMinutes != null
    ? `${set.actualDurationMinutes}min played (${set.plannedDurationMinutes}min planned)`
    : `${set.plannedDurationMinutes}min planned`;
  const bpm = set.bpmRange ? `${Math.round(set.bpmRange[0])}–${Math.round(set.bpmRange[1])} BPM` : 'no BPM data';
  return `${new Date(set.savedAt).toLocaleDateString()} · ${arc} · ${dur} · `
    + `${set.vinylCount} vinyl + ${set.spotifyCount} spotify (${set.playedCount} played, ${set.guestCount} guest) · ${bpm}`;
}
