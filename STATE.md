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
- [ ] If "the page looks stale/missing a feature" comes up again: it's
      very likely browser cache, not a real bug — confirm via `curl` on
      the deployed JS before assuming otherwise. No cache-busting
      infrastructure has been added; a hard refresh is the fix. Revisit
      if this keeps recurring.
- [ ] Not yet tested with a real, logged-in Spotify session end-to-end by
      Claude (no way to drive OAuth headlessly) — the user is the first
      real-world test of login, search, and the planned-pick flow.
