# State

_Last updated: 2026-09-18_

## Current status

Live and in active use across multiple sets now. **https://dentoneer.github.io/coffee-shop-dj/**
(repo `Dentoneer/coffee-shop-dj`, GitHub Pages from `master` root, auto-deploys on push).

All core pieces working end-to-end, including a real logged-in Spotify session
(confirmed by the user across several rounds of live debugging): tempo-ordered
vinyl plan with drag/arrow/shuffle reordering, Spotify PKCE login + search +
the DJ's own playlists synced in, Live Set's turn-based flow with per-row
Change/Shuffle on every slot, a full personal vinyl collection (`data/collection.json`,
189 records) browsable in Vinyl Corner, and a matching **Spotify Corner** tab
browsing every track synced from the DJ's playlists. Cyberpunk colorwave visual
theme throughout.

Detailed history of what was built and fixed each round is in git log — this
file only tracks current status and what's still open. `js/spotify.js` in
particular has taken several rounds of real-data-driven fixes as Spotify's
March 2026 Dev Mode migration turned out to have moved/renamed/reshaped more
than their docs made obvious; see recent commits for exactly what changed and
why, each backed by either a live test against the real API response or a
Node test replaying it.

## Architecture additions since the original build

- `js/spotifySync.js` — single shared cache of "the DJ's playlist tracks,"
  synced once (in the background on app init if already logged in, or
  on-demand from Settings/Spotify Corner/Live Set) and reused everywhere
  instead of each screen fetching its own copy. Exposes `syncPlaylists()`,
  `getSyncStatus()`, `onSyncChange()` for live status across tabs.
- `js/spotifyCorner.js` + the "Spotify Corner" tab — browsable, searchable
  view of every synced track, grouped by playlist (mirrors Vinyl Corner's
  pattern, Serato-style "your Spotify library as a browsable panel"). Has its
  own "Sync now" button; auto-syncs on open via the shared cache.
- `pickSpotifyCandidate()` in `js/liveset.js` is the single source for every
  live Spotify pick (auto-suggest, Full Set lookahead, Shuffle): ~90% from
  the synced playlist pool, ~10% fresh catalog search for variety, excluding
  tracks already played this set.

## Recent decisions

- Hosting: GitHub Pages static site, not a Claude Artifact (Artifacts block
  external fetch, so they can't reach the Spotify API).
- Spotify: Authorization Code + PKCE, client-side only, DJ's own Client ID
  (Premium account — required by Spotify's Feb 2026 Developer Mode rules).
  Login scope is `playlist-read-private playlist-read-collaborative` with
  `show_dialog: true` forced (Spotify silently reuses old scope grants on
  re-login otherwise, with no visible consent prompt for the new scope).
- Spotify's `/recommendations` and `audio-features` endpoints are
  permanently blocked for any app created after Nov 2024 — there is no
  reachable "real" Spotify ML recommendation. Bridge picks are an
  auto-built/auto-run search (or a playlist pick) against a displayed
  BPM/energy/flavor target instead, and the UI says so explicitly. Tempo is
  captured via tap-tempo, never `audio-features`.
- `/playlists/{id}/tracks` is dead (removed for Dev Mode apps in Spotify's
  March 2026 migration) — use `/playlists/{id}/items`. Its response nests
  the track object under a key literally named `item` (not `track`), and
  may omit `uri` entirely. `getPlaylistTracks` parses this tolerantly and
  requires only a title, not a uri.
- Alternation is strict: vinyl → Spotify → vinyl → Spotify, no exceptions.
- Guest-brought vinyls get priority placement (next 3 unplayed slots only).
- Plan direction (mellow-building-up vs. energetic-winding-down) is driven
  by Settings' Mood lever start vs. end (`getPlanDirection`), not hardcoded.
- Every track (vinyl or Spotify) has explicit `album`/`trackNumber` fields,
  an estimated-BPM flag (`bpmEstimated`) shown as a warning until tap-tempo
  confirms it, and a "Change" control that does a live-value search (not
  locked to whatever the slot started as).
- "Reset" in Settings (`Store.resetSetData()`) only clears
  tracks/plan/live-progress — never the Spotify Client ID or login.
- Cache-busting: every internal import and the `index.html` entry script
  carry a shared `?v=<tag>` query string, bumped on every push (see
  CLAUDE.md for the one-liner). Still tell the user to hard-refresh after
  each push — busting guarantees a fresh *network* fetch, not that an
  already-open tab has re-requested anything.

## Crate generation ("Build a crate")

Replaced the old single "Build tonight's crate" button (which always
loaded the same fixed 13-track JSON) with a generator:
- **New `js/moodWave.js`**: a draggable SVG "mood wave" - 6 points, x =
  position through the set, y = energy 1 (mellow) .. 5 (party), connected
  by lines, each point vertically draggable via pointer events. Presets
  (Build up / Wind down / Peak middle / Valley middle / Flat).
  `sampleEnergyAtFraction()` linearly interpolates energy at any point
  along the curve; `energyToBpm()` maps energy to a BPM estimate (1→65,
  5→155). Both covered by a Node test.
- Crate Builder's "Build a crate" card: pick a record count, shape the
  wave, hit Generate. Fisher-Yates-shuffles the full `data/collection.json`
  (189 records), excludes anything already in the current crate by
  artist+album, and takes the first N - so it's a genuinely different
  selection every click, not the same static list. Each pick's BPM/energy
  is set from where it falls on the curve (not tempo-sorted - the curve is
  allowed to go up and down on purpose) and flagged `bpmEstimated` like
  any other unconfirmed tempo. Verified end-to-end: 8 distinct real
  artists pulled, BPMs tracking a "Build up" curve exactly (88→144).
- `data/tonight-crate.json` still exists but is no longer linked from any
  button - kept as a reference/fallback, not part of the active flow.

## Save Set

New `js/savedSets.js`: `buildSnapshot(name)` captures a full point-in-time
copy of the current set - tracks, planOrder, mood arc (leverStart/End),
planned vs. actual duration (derived from `setStartedAt` and the last
`playedAt`), vinyl/Spotify/played/guest counts, BPM range, aggregated
flavor tags, and the artist list. `saveCurrentSet(name)` persists it via
new `Store.addSavedSet`/`getSavedSets`/`deleteSavedSet` (own localStorage
key, included in Export/Import) - saving never touches the live set.
- Live Set: "💾 Save this set" button (top of the tab) opens an inline
  name field, defaulting to "Set — <date>".
- Settings: new "Saved sets" card lists every saved set with a one-line
  summary (`summaryLine()`), an expandable "View tracks" (full plan with
  artist/album/BPM/energy), and "Delete" (confirms first).
Covered by a Node test with a realistic 3-track/2-source/1-guest set,
verifying every derived stat, the trim/fallback-name logic, and
save/retrieve/delete round-tripping. Verified visually end-to-end
(save from Live Set -> appears in Settings -> tracks expand correctly).

## Open Set + Spotify slots are now movable too

- **Open set** (Live Set, next to Save): lists every saved set with its
  summary line and a "Load" button (confirms first — replaces the live
  set). `loadSavedSet()` in `js/savedSets.js` restores tracks/planOrder/
  mood arc as a **fresh, unplayed** crate (not a literal resume of the old
  session) — every track's `played`/`playedAt` reset, `setStartedAt`
  cleared, stale `plannedSpotify`/live-state cleared. Loading never
  deletes the saved copy. Covered by a Node test that mutates the live
  set to something unrelated first, then asserts `loadSavedSet` correctly
  overwrites every piece of state (including the "fresh, not resumed"
  behavior) without touching the saved library.
- **Spotify rows are now movable**, matching vinyl's ▲/▼ buttons: since
  alternation is strict, a Spotify slot can't change *which* gap it's in,
  only *which song* is scheduled there — so moving one swaps its planned
  pick (`Store.plannedSpotify`) with the adjacent gap's, correctly
  handling a TBD (empty) neighbor (the moved pick fills it; the vacated
  slot becomes TBD, not a stale duplicate). New `swapPlannedSpotify()` in
  `js/liveset.js`, keyed off a precomputed `gapOrder` array (every
  spotify-gap's `afterVinylId`, in sequence). Verified end-to-end
  (swap + the live turn card correctly picking up the new order) and the
  underlying swap algorithm covered by its own Node test including the
  TBD-neighbor edge case.

## Open threads / next steps

- [ ] A few `data/collection.json` entries carry a `"note"` field flagging
      an unresolved/uncertain dictated title (e.g. Bob Dylan "Side Tracks")
      — fine to leave, fix opportunistically.
- [ ] No automated coverage of the Spotify Corner tab's search/filter UI
      beyond code review — the render/sync pipeline is tested (headless +
      mocked fetch), but no test exercises typing into the filter box.
- [ ] Playlist tracks carry no tempo data (same limitation as search
      results), so "from your playlist" bridge picks are exactly as
      unverified-BPM as a fresh search pick — nothing currently flags this
      the way `bpmEstimated` flags a guest vinyl's default tempo. Worth
      considering if playlist-sourced Spotify picks ever need the same
      kind of "this wasn't really tempo-matched" signal vinyl rows get.
