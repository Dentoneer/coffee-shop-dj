# State

_Last updated: 2026-09-17 (later same day)_

## Current status

MVP built and deployed for tonight's set (2026-09-17). Live at
https://dentoneer.github.io/coffee-shop-dj/ (repo: Dentoneer/coffee-shop-dj,
GitHub Pages serving from `master` root). Core plan/insertion logic
verified via a Node smoke test (caught and fixed a guest-priority-window
off-by-one bug). UI render verified via headless Edge screenshot.

`data/collection.json` now has 189 records (full dictated collection +
Buena Vista Social Club, added later). Claude picked and researched (via
web search, real tracklists/track numbers) a 13-record set for tonight —
see the conversation for the full list with sources; the ready-to-import
JSON was handed to the user to paste into Crate Builder. BPM values
throughout are genre-feel estimates pending tap-tempo confirmation on the
actual turntable.

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
- [x] Full personal collection dictated and cataloged in
      `data/collection.json` (189 records), browsable in the Vinyl Corner
      tab.
- [x] Claude picked, researched, and delivered tonight's 13-record set
      (artist/album/track number/track title/BPM/energy/flavor tags) as a
      ready-to-import JSON, replacing several picks per user feedback.
- [ ] User registers a free Spotify Developer app to get a Client ID, adds
      `https://dentoneer.github.io/coffee-shop-dj/` as a Redirect URI, and
      pastes the Client ID into the app's Settings tab (unconfirmed as of
      last update — user was mid-setup).
- [ ] User pastes the 13-record JSON into Crate Builder's Bulk import and
      confirms it looks right in Live Set.
- [ ] User adds/confirms their vinyls via Crate Builder (tap-tempo each to
      replace the estimated BPM with a measured one).
- [ ] A handful of collection entries are marked `"note"` in the JSON as
      unresolved/uncertain titles (e.g. Bob Dylan "Side Tracks") — fine to
      leave as-is, correct opportunistically if the user brings it up.
- [ ] Every future push to `master` auto-deploys to Pages — no separate
      deploy step needed.
- [x] Superseded the song/vinyl toggle with proper separate `album` and
      `trackNumber` fields on Track (was overloading `title`). The
      Spotify-lookup flow for vinyl now searches albums, loads the real
      tracklist (`spotify.js`'s `getAlbumTracks`), and lets the DJ click
      the actual track — far more accurate than the old first-track guess.
- [x] Confirmed: Spotify's `/recommendations` endpoint 403s permanently for
      any app created after Nov 27 2024 (ours included) - no real "Spotify
      algorithm" is reachable short of 250k+ MAU extended access. Live Set's
      Spotify turn now auto-builds a search query from the bridge target's
      flavor tags and auto-runs it (no typing required), with an explicit
      note in the UI explaining why it's not true ML recommendations.
      Confirmed with the user: their Spotify account has Premium, satisfying
      the Feb 2026 Developer Mode requirement.
- [x] Added a "Full set" list to Live Set showing played history + the
      upcoming vinyl plan with Spotify bridge slots marked "TBD — chosen
      live" (the very next one gets a highlight + note to see the bridge
      target above). Every row shows artist/album/track#/song.
- [x] Fixed a real ordering bug in `js/plan.js` `insertVinylTrack`: ties in
      insertion cost at an unanchored boundary (e.g. the very first insert
      into an empty plan) resolved to "first candidate wins," which could
      put a *higher*-BPM track before a lower one. Added a tie-break that
      prefers whichever side keeps neighbors in ascending BPM order.
      Regression test added and passing (ascending + descending add order).
- [x] Reworked tonight's 13-track import JSON to the new album/trackNumber
      schema and handed it to the user again.
