# coffee-shop-dj

A live-set assistant for DJing a "coffee shop, hipster, slightly Hispanic"
vibe by mixing vinyl and Spotify. Static site, deployed on GitHub Pages, no
backend.

## Purpose

Keeps a tempo-ordered "vinyl plan" from the DJ's own crate plus vinyls
guests bring on the night, and suggests the Spotify track to bridge between
each pair of vinyls, alternating strictly vinyl → Spotify → vinyl → Spotify.

Full design rationale: `docs/superpowers/specs/2026-09-16-coffee-shop-dj-design.md`.

## Architecture

- Plain HTML/CSS/JS, no build step, no framework.
- `index.html` — shell with four tabs: Live Set, Crate Builder, Vinyl
  Corner, Settings.
- `data/collection.json` — the full personal vinyl collection (~188
  records, artist/album only, no tempo/energy tagging), dictated by the
  user and captured as a one-time catalog build. This is the master
  library; `js/collection.js` renders it read-only, alphabetized, in the
  Vinyl Corner tab. It is separate from and does not feed the Crate
  Builder/Live Set tempo-plan system — only tracks explicitly added there
  (a subset chosen per set) are tap-tempo'd and inserted into a plan.
- `js/store.js` — `localStorage`-backed data layer (tracks, settings, auth).
- `js/spotify.js` — Spotify Authorization Code + PKCE login, token refresh,
  catalog search. No client secret — PKCE needs none.
- `js/plan.js` — tempo-based insertion algorithm, turn/alternation state,
  Spotify bridge-target computation.
- `js/tapTempo.js` — tap-tempo BPM widget (Spotify's `audio-features` API
  is gated for new dev apps, so tempo is captured by hand).
- `js/crate.js`, `js/liveset.js` — per-tab UI rendering and handlers.
- `js/app.js` — tab routing, init, OAuth redirect handling.

## Key facts

- **No pre-seeded Spotify playlists** — Spotify picks are live search only,
  chosen by ear against a displayed BPM/energy/flavor target. There's no
  tempo data for un-played catalog tracks, so Spotify results are never
  ranked/scored.
- **Guest vinyls are prioritized**: inserted only among the next 3 unplayed
  vinyl slots (not the whole remaining plan), so they play soon.
- Spotify Client ID is entered by the user in Settings and stored in
  `localStorage` — never hardcoded, never committed.
- Redirect URI for Spotify OAuth must exactly match what's registered in
  the Spotify Developer Dashboard (the GitHub Pages URL, and
  `http://127.0.0.1:<port>/` for local testing).
