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
- `index.html` — shell with five tabs: Live Set, Crate Builder, Vinyl
  Corner, Spotify Corner, Settings.
- `data/collection.json` — the full personal vinyl collection (~188
  records, artist/album only, no tempo/energy tagging), dictated by the
  user and captured as a one-time catalog build. This is the master
  library; `js/collection.js` renders it read-only, alphabetized, in the
  Vinyl Corner tab. It is separate from and does not feed the Crate
  Builder/Live Set tempo-plan system — only tracks explicitly added there
  (a subset chosen per set) are tap-tempo'd and inserted into a plan.
- `data/tonight-crate.json` — a curated, researched (real track
  numbers/titles) starting set; Crate Builder's "Build tonight's crate"
  button imports it directly, one click, no copy-paste.
- `js/store.js` — `localStorage`-backed data layer (tracks, settings, auth).
- `js/spotify.js` — Spotify Authorization Code + PKCE login, token refresh,
  catalog search, playlist fetch. No client secret — PKCE needs none.
- `js/spotifySync.js` — single shared cache of the DJ's playlist tracks,
  synced once and reused by Live Set and Spotify Corner instead of each
  screen fetching its own copy. `syncPlaylists()` / `getSyncStatus()` /
  `onSyncChange()`.
- `js/spotifyCorner.js` — the Spotify Corner tab: browsable/searchable view
  of every synced playlist track, grouped by playlist.
- `js/plan.js` — tempo-based insertion algorithm (direction-aware — see
  `getPlanDirection`), turn/alternation state, Spotify bridge-target
  computation.
- `js/tapTempo.js` — tap-tempo BPM widget (Spotify's `audio-features` API
  is gated for new dev apps, so tempo is captured by hand).
- `js/crate.js`, `js/liveset.js` — per-tab UI rendering and handlers.
  `pickSpotifyCandidate()` in `liveset.js` is the single source for every
  live Spotify pick (auto-suggest, lookahead, Shuffle).
- `js/app.js` — tab routing, init, OAuth redirect handling, kicks off a
  background playlist sync on load if already logged in.

## Key facts

- **Spotify bridge picks mix in the DJ's own playlists**: ~90% from
  playlists configured in Settings (synced via `spotifySync.js`), ~10%
  fresh catalog search for variety, excluding tracks already played this
  set. There's no tempo data for either source, so nothing is
  ranked/scored — picks are chosen by ear against a displayed
  BPM/energy/flavor target. Every Spotify row has a Shuffle button for an
  instant different pick with no typing, and a Change control for a
  manual search.
- **Guest vinyls are prioritized**: inserted only among the next 3 unplayed
  vinyl slots (not the whole remaining plan), so they play soon.
- **Spotify's March 2026 Dev Mode migration renamed/reshaped playlist
  endpoints** and this bit real production use more than once: `/tracks`
  → `/items`, and the track object is nested under a key literally named
  `item` (not `track`), with `uri` sometimes absent. See `getPlaylistTracks`
  in `js/spotify.js` and its parsing comments before assuming any Spotify
  playlist/track shape — verify against a live raw response
  (`getPlaylistRawSample`) rather than the public docs, which lag reality.
- Spotify Client ID is entered by the user in Settings and stored in
  `localStorage` — never hardcoded, never committed. Login scope is
  `playlist-read-private playlist-read-collaborative` with
  `show_dialog: true` forced — Spotify silently reuses an old scope grant
  on re-login otherwise, with no visible prompt for a newly-added scope.
- Redirect URI for Spotify OAuth must exactly match what's registered in
  the Spotify Developer Dashboard (the GitHub Pages URL, and
  `http://127.0.0.1:<port>/` for local testing).
- **Cache-busting**: every internal `import ... from './x.js'` and the
  `<script src="js/app.js">` in `index.html` carries a shared `?v=<tag>`
  query string (GitHub Pages caches assets for 10 minutes, and this was
  repeatedly mistaken for real bugs during live iteration). **After any
  future push, bump the tag** with:
  `sed -i -E "s/(\.js)\?v=[a-zA-Z0-9]+/\1?v=NEWTAG/g" js/*.js index.html`
  then tell the user to hard-refresh anyway — busting only guarantees a
  fresh fetch, not that their tab has already re-requested the page.
