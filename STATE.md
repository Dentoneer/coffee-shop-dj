# State

_Last updated: 2026-09-16_

## Current status

MVP built and deployed for a set on 2026-09-17. Live at
https://dentoneer.github.io/coffee-shop-dj/ (repo: Dentoneer/coffee-shop-dj,
GitHub Pages serving from `master` root). Core plan/insertion logic
verified via a Node smoke test (caught and fixed a guest-priority-window
off-by-one bug). UI render verified via headless Edge screenshot.

## Recent decisions

- Hosting: GitHub Pages static site, not a Claude Artifact (Artifacts block
  external fetch, so they can't reach the Spotify API).
- Spotify: Authorization Code + PKCE, client-side only, DJ's own Client ID.
  No pre-seeded playlists — Spotify picks are live search + pick-by-ear
  against a displayed bridge target (no ranking, since live search results
  carry no tempo data).
- Tempo capture: tap-tempo widget, not Spotify's `audio-features` endpoint
  (gated for new dev apps as of late 2024).
- Alternation is strict: vinyl → Spotify → vinyl → Spotify, no exceptions
  (explicitly confirmed — earlier "contiguous vinyl tracks" idea dropped).
- Guest-brought vinyls get priority placement (next 3 unplayed slots only)
  rather than competing for the tempo-optimal slot across the whole plan.

## Open threads / next steps

- [x] Finish implementation (store/spotify/plan/tapTempo/crate/liveset/app).
- [x] Create the GitHub repo + enable Pages.
- [x] Full ~188-record personal collection dictated and cataloged in
      `data/collection.json`, browsable in the new Vinyl Corner tab.
- [ ] User registers a free Spotify Developer app to get a Client ID, adds
      `https://dentoneer.github.io/coffee-shop-dj/` as a Redirect URI, and
      pastes the Client ID into the app's Settings tab.
- [ ] From `data/collection.json`, Claude picks ~10-15 for tomorrow's vibe
      + tempo arc, gives a track-per-record + starting BPM/energy, and
      hands back a JSON file for the Crate Builder's bulk import.
- [ ] User adds/confirms their vinyls via Crate Builder (tap-tempo each to
      confirm the BPM estimate).
- [ ] A handful of collection entries are marked `"note"` in the JSON as
      unresolved/uncertain titles (e.g. Bob Dylan "Side Tracks") — fine to
      leave as-is, correct opportunistically if the user brings it up.
- [ ] Every future push to `master` auto-deploys to Pages — no separate
      deploy step needed.
