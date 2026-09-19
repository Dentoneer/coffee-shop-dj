// Shared "generate a crate" logic - used by both Crate Builder's "Build a
// crate" card and Live Set's "Create set" panel, so there's exactly one
// implementation instead of two that could drift apart.

import { Store, newId } from './store.js?v=20260918e';
import { sampleEnergyAtFraction, energyToBpm } from './moodWave.js?v=20260918e';

let cachedCollection = null;
async function loadCollection() {
  if (cachedCollection) return cachedCollection;
  const res = await fetch('data/collection.json');
  cachedCollection = await res.json();
  return cachedCollection;
}

/**
 * Picks `count` random, not-already-in-the-crate records from the full
 * collection, shapes each one's BPM/energy to where it falls on
 * `curvePoints` (a 6-point mood wave, see moodWave.js), and appends them
 * to the live plan in that order (not tempo-sorted - the curve can go up
 * and down on purpose). Returns { count, error }.
 */
export async function generateCrate(count, curvePoints) {
  const collection = await loadCollection();
  const existing = Store.getTracks();
  const already = new Set(existing.filter((t) => t.source === 'vinyl').map((t) => `${t.artist}|${t.album}`.toLowerCase()));
  const available = collection.filter((r) => !already.has(`${r.artist}|${r.album}`.toLowerCase()));
  if (available.length === 0) {
    return { count: 0, error: 'Every record in your collection is already in the crate.' };
  }

  // Fresh random sample every call - Fisher-Yates shuffle, take the first
  // `count` (or all of them if the collection is smaller).
  const pool = available.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picks = pool.slice(0, Math.min(count, pool.length));

  let order = Store.getPlanOrder();
  const tracks = Store.getTracks();
  picks.forEach((record, i) => {
    const frac = picks.length > 1 ? i / (picks.length - 1) : 0;
    const energy = sampleEnergyAtFraction(curvePoints, frac);
    const track = {
      id: newId(),
      title: "(DJ's choice)",
      artist: record.artist,
      album: record.album,
      trackNumber: null,
      source: 'vinyl',
      bpm: energyToBpm(energy),
      bpmEstimated: true,
      energy: Math.round(energy),
      flavorTags: [],
      guestRequested: false,
      played: false,
      playedAt: null,
      addedAt: Date.now(),
      spotifyArt: null,
      spotifyUri: null,
    };
    Store.addTrack(track);
    tracks.push(track);
    order = [...order, track.id];
  });
  Store.savePlanOrder(order);
  return { count: picks.length, error: null };
}
