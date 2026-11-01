// Tempo-based vinyl plan: ordering, insertion, turn state, and the Spotify
// bridge target. Pure functions over Track[]/planOrder so they're easy to
// reason about and test from the console.

import { Store } from './store.js?v=20261101shame';

const GUEST_PRIORITY_WINDOW = 3; // last-played slot + next 2 unplayed

function vinylTracksById(tracks) {
  const map = new Map();
  for (const t of tracks) if (t.source === 'vinyl') map.set(t.id, t);
  return map;
}

// Cost of placing `bpm` between two neighbor bpms (either may be null at
// the ends of the plan). Lower is a smoother transition.
function insertionCost(bpm, leftBpm, rightBpm) {
  if (leftBpm == null && rightBpm == null) return 0;
  if (leftBpm == null) return Math.abs(bpm - rightBpm);
  if (rightBpm == null) return Math.abs(bpm - leftBpm);
  return Math.abs(bpm - leftBpm) + Math.abs(bpm - rightBpm) - Math.abs(leftBpm - rightBpm);
}

// Returns the unplayed portion of planOrder (ids only), in order.
function unplayedIds(planOrder, tracksById) {
  return planOrder.filter((id) => {
    const t = tracksById.get(id);
    return t && !t.played;
  });
}

/**
 * Whether new vinyl should sort low-BPM-first (mellow opener, building up -
 * matches a mood lever that rises over the set) or high-BPM-first (energetic
 * opener, winding down). Derived from Settings' lever start/end so "set your
 * starting vibe" has one obvious place to configure it.
 */
export function getPlanDirection(settings) {
  return settings.leverStart <= settings.leverEnd ? 'asc' : 'desc';
}

/**
 * Insert `track` (a vinyl track, not yet in planOrder) at its best slot.
 * Guest-requested tracks only compete for the next GUEST_PRIORITY_WINDOW
 * unplayed slots; owned-crate tracks compete across the whole unplayed tail.
 * `direction` ('asc' | 'desc') controls which way ties resolve - see
 * getPlanDirection. Mutates nothing — returns the new planOrder array.
 */
export function insertVinylTrack(track, planOrder, allTracks, direction = 'asc') {
  const tracksById = vinylTracksById(allTracks);
  tracksById.set(track.id, track);

  const playedPrefixEnd = planOrder.reduce((lastPlayedIdx, id, idx) => {
    const t = tracksById.get(id);
    return t && t.played ? idx : lastPlayedIdx;
  }, -1);

  const unplayedTail = planOrder.slice(playedPrefixEnd + 1);

  // Candidate insertion points are indices 0..unplayedTail.length within
  // the tail, each bounded by the last-played track (if any) on the left.
  // A guest-requested track's index is capped so it lands among the next
  // GUEST_PRIORITY_WINDOW unplayed tracks, not just bracketed against them
  // (bracketing against the window while still allowing the "after all of
  // them" slot would let it slip to window+1 whenever that scored lower).
  const leftAnchorBpm = playedPrefixEnd >= 0
    ? (tracksById.get(planOrder[playedPrefixEnd])?.bpm ?? null)
    : null;
  const maxIdx = track.guestRequested
    ? Math.min(GUEST_PRIORITY_WINDOW - 1, unplayedTail.length)
    : unplayedTail.length;

  // Cost alone ties whenever a slot has an anchor on only one side (e.g.
  // the very first insert into an empty plan) - "before everything" and
  // "after everything" score identically. Break ties toward whichever
  // side keeps neighbors in ascending BPM order, so the plan converges on
  // a tempo-sorted sequence instead of an arbitrary insertion order.
  let bestIdx = 0;
  let bestCost = Infinity;
  let bestViolation = Infinity;
  for (let i = 0; i <= maxIdx; i++) {
    const leftId = i === 0 ? null : unplayedTail[i - 1];
    const rightId = i < unplayedTail.length ? unplayedTail[i] : null;
    const leftBpm = leftId ? tracksById.get(leftId)?.bpm ?? null : leftAnchorBpm;
    const rightBpm = rightId ? tracksById.get(rightId)?.bpm ?? null : null;
    const cost = insertionCost(track.bpm, leftBpm, rightBpm);
    const violation = direction === 'desc'
      ? (leftBpm != null ? Math.max(0, track.bpm - leftBpm) : 0) +
        (rightBpm != null ? Math.max(0, rightBpm - track.bpm) : 0)
      : (leftBpm != null ? Math.max(0, leftBpm - track.bpm) : 0) +
        (rightBpm != null ? Math.max(0, track.bpm - rightBpm) : 0);
    if (cost < bestCost || (cost === bestCost && violation < bestViolation)) {
      bestCost = cost;
      bestViolation = violation;
      bestIdx = i;
    }
  }

  const insertAtGlobalIdx = playedPrefixEnd + 1 + bestIdx;
  const newOrder = planOrder.slice();
  newOrder.splice(insertAtGlobalIdx, 0, track.id);
  return newOrder;
}

/** First unplayed vinyl in plan order, or null if the plan is exhausted. */
export function getNextVinyl(planOrder, allTracks) {
  const tracksById = vinylTracksById(allTracks);
  for (const id of planOrder) {
    const t = tracksById.get(id);
    if (t && !t.played) return t;
  }
  return null;
}

export function getLastPlayed(allTracks) {
  const played = allTracks.filter((t) => t.playedAt);
  if (played.length === 0) return null;
  return played.reduce((a, b) => (a.playedAt > b.playedAt ? a : b));
}

/** Whose turn it is, purely from what was last played (strict alternation). */
export function getTurn(lastPlayed) {
  if (!lastPlayed) return 'vinyl'; // set opens on vinyl
  return lastPlayed.source === 'vinyl' ? 'spotify' : 'vinyl';
}

/** Current mood-lever value: manual override, else linear auto-drift. */
export function getLeverValue(settings, now = Date.now()) {
  if (!settings.autoDrift || settings.leverOverride != null) {
    return settings.leverOverride ?? settings.leverStart;
  }
  if (!settings.setStartedAt) return settings.leverStart;
  const elapsedMin = (now - settings.setStartedAt) / 60000;
  const frac = Math.min(1, Math.max(0, elapsedMin / settings.setDurationMinutes));
  return settings.leverStart + (settings.leverEnd - settings.leverStart) * frac;
}

/** What to search Spotify for: a BPM range, energy target, flavor hint. */
export function getBridgeTarget(lastPlayed, nextVinyl, settings) {
  const bpms = [lastPlayed?.bpm, nextVinyl?.bpm].filter((b) => b != null);
  const bpmRange = bpms.length
    ? [Math.min(...bpms), Math.max(...bpms)]
    : null;
  const flavorHint = Array.from(new Set([
    ...(lastPlayed?.flavorTags || []),
    ...(nextVinyl?.flavorTags || []),
  ]));
  return {
    bpmRange,
    energyTarget: Math.round(getLeverValue(settings) * 10) / 10,
    flavorHint,
  };
}

/**
 * 'alternate' = mood-wave sets: planOrder is vinyl only, Spotify slots are
 * implicit gaps between vinyls (strict V/S alternation). 'sequence' = vibe
 * sets: planOrder holds every song, vinyl and Spotify, in play order.
 */
export function getPlanMode(settings) {
  return settings.planMode === 'sequence' ? 'sequence' : 'alternate';
}

/** Sequence mode: first unplayed song in planOrder, any source. */
export function getNextInSequence(planOrder, allTracks) {
  const byId = new Map(allTracks.map((t) => [t.id, t]));
  for (const id of planOrder) {
    const t = byId.get(id);
    if (t && !t.played) return t;
  }
  return null;
}

/** Sequence mode: slot a new song in right after whatever is up next, so it plays soon. */
export function insertSoon(trackId, planOrder, allTracks) {
  const next = getNextInSequence(planOrder, allTracks);
  if (!next) return [...planOrder, trackId];
  const out = planOrder.slice();
  out.splice(out.indexOf(next.id) + 1, 0, trackId);
  return out;
}

/** Where a newly added vinyl (guest / Crate Builder) goes, for either mode. */
export function placeNewVinyl(track, planOrder, allTracks, settings) {
  if (getPlanMode(settings) === 'sequence') return insertSoon(track.id, planOrder, allTracks);
  return insertVinylTrack(track, planOrder, allTracks, getPlanDirection(settings));
}

/**
 * Before a mood-wave generate: a vibe set can't take appended mood-wave
 * picks, so ask (confirmFn) and replace it. Returns false if the DJ cancels.
 */
export function leaveSequenceMode(confirmFn) {
  if (getPlanMode(Store.getSettings()) !== 'sequence') return true;
  if (!confirmFn()) return false;
  Store.resetSetData();
  Store.updateSettings({ planMode: 'alternate', setStartedAt: null, leverOverride: null, autoDrift: true });
  return true;
}

/** Recomputes and persists everything the Live Set view needs to render. */
export function computeLiveSnapshot() {
  const tracks = Store.getTracks();
  const planOrder = Store.getPlanOrder();
  const settings = Store.getSettings();
  const lastPlayed = getLastPlayed(tracks);
  const turn = getTurn(lastPlayed);
  const nextVinyl = getNextVinyl(planOrder, tracks);
  const bridgeTarget = getBridgeTarget(lastPlayed, nextVinyl, settings);
  const leverValue = getLeverValue(settings);
  const mode = getPlanMode(settings);
  const nextItem = mode === 'sequence' ? getNextInSequence(planOrder, tracks) : null;
  return { tracks, planOrder, settings, lastPlayed, turn, nextVinyl, bridgeTarget, leverValue, mode, nextItem };
}

export function markPlayed(trackId) {
  const now = Date.now();
  Store.updateTrack(trackId, { played: true, playedAt: now });
}
