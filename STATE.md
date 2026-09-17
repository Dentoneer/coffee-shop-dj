# State

_Last updated: 2026-09-16_

## Current status

Building the MVP same-night for a set on 2026-09-17. In progress: initial
implementation (data layer, Spotify PKCE auth, plan/insertion logic,
tap-tempo, Crate Builder + Live Set + Settings screens).

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

- [ ] Finish implementation (store/spotify/plan/tapTempo/crate/liveset/app).
- [ ] Local smoke test via a local static server + `127.0.0.1` Spotify
      redirect URI.
- [ ] User needs to register a free Spotify Developer app tonight to get a
      Client ID, and add both the local test URL and the eventual GitHub
      Pages URL as redirect URIs.
- [ ] Create the GitHub repo + enable Pages (needs user confirmation before
      pushing/creating remote state).
- [ ] User adds their ~10 vinyls via Crate Builder tonight (tap-tempo each).
