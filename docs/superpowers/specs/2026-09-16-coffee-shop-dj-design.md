# Coffee Shop DJ — design spec

_2026-09-16 — built same-night for a set the next day (2026-09-17)._

## Purpose

A live-set tool for a coffee-shop-hipster/slightly-hispanic vibe DJ set mixing
vinyl and Spotify. It keeps a tempo-ordered "vinyl plan" built from the DJ's
own crate plus vinyls guests bring on the night, and suggests the Spotify
track to bridge between each pair of vinyls.

## Hosting & auth constraints (why this shape)

- Static site on GitHub Pages (like `dolphin-automation`/`photo-site`) — a
  Claude Artifact can't fetch external APIs, so it can't talk to Spotify.
- No backend, so Spotify auth is Authorization Code + PKCE, entirely
  client-side, using the DJ's own Spotify Developer app Client ID (no secret
  ships in the public repo).
- Spotify's `audio-features` (tempo/energy) endpoint is gated for new dev
  apps as of late 2024, so tempo is captured via a **tap-tempo** widget
  instead of relying on that API. Spotify Search (catalog lookup + album art)
  remains open and is used for track identification.

## Data model

```
Track {
  id, title, artist,
  source: 'vinyl' | 'spotify',
  bpm: number | null,
  energy: 1-5,
  flavorTags: string[],
  guestRequested: boolean,
  played: boolean, playedAt: timestamp | null,
  addedAt: timestamp
}
```

Stored in `localStorage`. Export/import JSON button as manual backup.

`planOrder: string[]` — ordered vinyl track ids (played history stays in
place; unplayed portion is the working plan).

## Core logic

- **Insertion, not append**: adding a vinyl track inserts it at the position
  in the unplayed portion of `planOrder` that minimizes the combined BPM
  jump to its neighbors: `cost = |X-L| + |X-R| - |L-R|`.
- **Guest priority**: guest-requested vinyls only search for their best slot
  within the next 3 unplayed positions (last-played + next 2), so they play
  soon without forcing a bad tempo jump.
- **Strict alternation**: vinyl → Spotify → vinyl → Spotify, no exceptions.
  Set opens on vinyl.
- **Spotify bridge target**: BPM range between last-played and next-planned
  vinyl, energy target from the mood lever, flavor hint from both
  neighbors' tags. DJ searches Spotify and picks by ear against that target.

## Mood lever

1–5 (Mellow ↔ Upbeat). Optional auto-drift: linear interpolation from a
start to an end value over a configured set duration, from the moment the
set is started. Grabbing the slider pauses auto-drift; a resume control
restarts interpolation from the current time position.

## Screens

- **Crate Builder**: add owned vinyls ahead of time (title/artist, Spotify
  search for art/autofill, tap-tempo BPM, energy, flavor tags).
- **Live Set**: mood lever + auto-drift controls, whose-turn state, next
  vinyl (from plan) or Spotify bridge target + search, "mark played," "add
  guest vinyl" (same form, `guestRequested: true`).
- **Settings**: Spotify Client ID, set duration/lever targets, export/import.

## Explicitly out of scope for the MVP

- Playback control (DJ presses play themselves, in Spotify's own app).
- Pre-seeded Spotify playlists — live search only.
- Ranking/scoring of live Spotify search results (no tempo data available
  for unplayed catalog tracks) — the app gives a target, not a ranked list.
