# State

_Last updated: 2026-09-17_

## Current status

Live and in active use for tonight's set. **https://dentoneer.github.io/coffee-shop-dj/**
(repo `Dentoneer/coffee-shop-dj`, GitHub Pages from `master` root, auto-deploys on push).

Core pieces all working: tempo-ordered vinyl plan (Crate Builder), Spotify
PKCE login + search, Live Set's turn-based flow, a full personal vinyl
collection (`data/collection.json`, 189 records) browsable in Vinyl Corner,
and tonight's curated 13-record starting set (handed to the user as a
Crate Builder bulk-import JSON, with real researched track numbers/titles
and web-search sources — see git log / conversation for that list).

Detailed history of what was built and fixed each round is in git log —
this file only tracks current status and what's still open.

## Recent decisions

- Hosting: GitHub Pages static site, not a Claude Artifact (Artifacts block
  external fetch, so they can't reach the Spotify API).
- Spotify: Authorization Code + PKCE, client-side only, DJ's own Client ID
  (Premium account, confirmed — required by Spotify's Feb 2026 Developer
  Mode rules). No pre-seeded playlists.
- Spotify's `/recommendations` and `audio-features` endpoints are
  permanently blocked for any app created after Nov 2024 (ours included) —
  there is no reachable "real" Spotify ML recommendation. The Spotify
  bridge turn instead auto-builds and auto-runs a search from the bridge
  target's flavor tags, auto-picks the top result, and says so explicitly
  in the UI. Tempo is captured via tap-tempo, not `audio-features`.
- Alternation is strict: vinyl → Spotify → vinyl → Spotify, no exceptions.
- Guest-brought vinyls get priority placement (next 3 unplayed slots only).
- Every track (vinyl or Spotify) has explicit `album`/`trackNumber` fields
  now, not baked into `title`.
- Upcoming Spotify bridge slots are pre-fetched and cached ("planned")
  for the next few gaps (`LOOKAHEAD_GAPS = 3` in `js/liveset.js`) so the
  Full Set list shows real suggested songs instead of "TBD" — capped to
  avoid firing a search per gap on every render, and because far-future
  slots are likely to get reshuffled by later guest additions anyway.
  Every row (vinyl or Spotify, current or future) has a "Change" control.
- "Reset" in Settings (`Store.resetSetData()`) only clears
  tracks/plan/live-progress — never the Spotify Client ID or login.

## Open threads / next steps

- [ ] User to paste tonight's 13-record JSON into Crate Builder if not
      already done, and confirm Live Set reflects it.
- [ ] User adds/confirms their own vinyls via Crate Builder, tap-tempo
      confirming each estimated BPM for real.
- [ ] A few `data/collection.json` entries carry a `"note"` field flagging
      an unresolved/uncertain dictated title (e.g. Bob Dylan "Side
      Tracks") — fine to leave, fix opportunistically.
- [x] Fixed the crate always sorting mellow-first regardless of intent:
      `insertVinylTrack` now takes a `direction` ('asc'/'desc'), derived
      via new `getPlanDirection(settings)` from Settings' Mood lever
      start/end (start < end -> ascending/build-up, start > end ->
      descending/wind-down). All insertion call sites (Crate Builder form,
      bulk/one-click import, guest-add) now pass it. Added a "Reverse
      order" button in Crate Builder to flip an already-built plan
      in place without rebuilding. Regression test added for both
      directions.
- [x] Fixed the real reason only the first Spotify lookahead gap ever
      resolved: `gapIndex` was `future.indexOf(entry)` - an index into the
      full vinyl+gap interleaved array (0, 2, 4, 6...), not a count of gap
      entries, so it undercounted against `LOOKAHEAD_GAPS` and silently
      skipped fetching for the 2nd+ gap onward. Now uses a dedicated
      `spotifyGapCount` counter incremented only for gap entries. Also
      serialized the lookahead fetches (chained via a single promise
      instead of fired concurrently) as a defensive measure against any
      token-refresh/rate-limit races between simultaneous Spotify calls.
- [x] Fixed misleading "TBD — finding a match…" text in Full Set staying
      forever even after a lookahead search failed/errored - now
      distinguishes "still loading" from "gave up, tap Change," and logs
      the actual error to the console for diagnosis.
- [x] Changed behavior per explicit user ask: picking a Spotify search
      result in the add-track form now saves the track immediately (no
      separate "now click Add" step at all - the earlier "make the message
      louder" fix wasn't enough, user wanted the two-step gone). Tempo is
      optional and defaults to 100 BPM if not tapped first; fix it later
      via the "Change" editor, which now also has its own tap-tempo/BPM
      field and re-runs plan insertion if the BPM actually changed (so a
      corrected tempo moves the track to its right spot instead of leaving
      it wherever the default put it). Verified end-to-end headlessly.
- [x] TBD gap rows now show the real failure (error message or "0 results
      for <query>") instead of a silent console-only warning - needed for
      diagnosing why gaps 2/3 still failed after the indexing fix.
- [x] Added real cache-busting after this bit the user four separate times
      tonight: every internal import and the `index.html` entry script now
      carry a shared `?v=<tag>` query string (see CLAUDE.md for the sed
      one-liner to bump it on every future push). Verified locally that
      the app still loads correctly with versioned import specifiers.
      Still tell the user to hard-refresh after each push regardless -
      busting guarantees a fresh network fetch, not that their already-open
      tab has re-requested anything.
- [ ] Not yet tested with a real, logged-in Spotify session end-to-end by
      Claude (no way to drive OAuth headlessly) — the user is the first
      real-world test of login, search, and the planned-pick flow.
- [x] Added a "Build tonight's crate" one-click button to Crate Builder:
      fetches `data/tonight-crate.json` (the 13-track curated/researched
      set) and imports it directly, no copy-pasting JSON. Bulk-import
      textarea kept as an "(advanced)" fallback for any future list
      Claude hands over mid-night. Verified end-to-end with a headless
      click simulation - correctly inserts all 13 into a tempo-sorted plan.
- [x] Reverted the vinyl add-form's Spotify lookup from the two-step
      album-search-then-tracklist flow back to a direct one-step track
      search (`searchTracks` already returns album + track number per
      hit, so the extra step was unnecessary complexity, not a real need).
      The tracklist-browse flow (`getAlbumTracks`) is kept only inside the
      "Change track" editor in Live Set, where browsing a known album's
      full list is the actual intent.
