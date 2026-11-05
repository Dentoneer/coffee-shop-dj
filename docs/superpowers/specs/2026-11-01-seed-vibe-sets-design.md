# Seed-vibe sets, real song suggestions, and Save-to-Spotify

_Design, 2026-11-01. Builds on `2026-09-16-coffee-shop-dj-design.md` and the
current code (see `CLAUDE.md` / `STATE.md`)._

## Intent and why

Today the app hands too many decisions back to the DJ. A generated set's
vinyl rows are titled "(DJ's choice)" (just an album, no song), and each
Spotify turn shows a BPM/energy/flavor *target* to pick against by ear. The
DJ wants the program to **give real suggestions**: every row names a
specific song and album.

Spotify's own recommendation and audio-features endpoints are permanently
closed to this app (apps created after Nov 2024), which is why the app falls
back to targets today. **Last.fm** fills that gap: its similar-track and
similar-artist data comes from listening history, and it has a free,
CORS-enabled JSON API.

Three things get built:

1. **Seed-vibe set.** The DJ picks 3 songs from Spotify. The app builds a
   whole set of vinyl from the DJ's collection plus Spotify songs that match
   that vibe.
2. **Real song suggestions everywhere.** No more "(DJ's choice)" vinyl
   titles, and no target-only Spotify picks.
3. **Save to Spotify.** "Save this set" also saves the set as a playlist in
   the DJ's Spotify account.

## Goals

- Pick 3 seed songs via Spotify search. Get back a set where every row shows
  song + album (+ cover art where available).
- Vinyl picks come from `data/collection.json`, chosen by how close each
  record's artist is to the seeds' vibe. Each one names a specific song on
  that album.
- When few records fit the vibe, the set leans toward Spotify instead of
  forcing records that don't belong.
- "Save this set" saves the snapshot in-app (as today) **and** creates or
  updates a Spotify playlist of the full set in order, vinyl and Spotify.
- Generating a set never touches the DJ's Spotify account. Only Save does.

## Non-goals

- **Song language filter (Spanish vs English): dropped by the DJ.** Last.fm
  similarity is expected to keep a Spanish-seeded set mostly Spanish. Easy
  to add later if it doesn't.
- No tempo/BPM detection. BPM stays estimated or tap-tempo'd as today.
- No backend. Static GitHub Pages site, as now.
- No change to the theme (Shame Boys reskin, 2026-11-01).

## Anti-goals (failure even if it technically works)

- A row that says "(DJ's choice)" or only shows a target with no song.
- A Spotify playlist created every time a set is generated or regenerated.
- A wrong vinyl version in the saved playlist. A vinyl track with no
  confident Spotify match is **skipped**, never guessed.
- Records that clearly don't fit the vibe forced into the set just to keep
  vinyl/Spotify alternation going.

## Decided by the DJ

- **Vibe source: Last.fm.** One-time setup: the DJ creates a free Last.fm
  API key and pastes it into Settings (stored in `localStorage` like the
  Spotify Client ID, never committed).
- **Seeds come from Spotify** (search, the existing search UI pattern).
- **Output is a set in Live Set** of both vinyl and Spotify songs, not a
  separate list.
- **Alternation:** vinyl → Spotify → vinyl → Spotify while fitting vinyl
  remains. **After the fitting vinyl runs out, the rest of the set is
  Spotify** (consecutive Spotify songs allowed). This applies to seed-vibe
  sets.
- **Save:** the existing "💾 Save this set" saves in-app and also saves a
  Spotify playlist. The playlist contains **all songs, vinyl and Spotify, in
  set order**. A vinyl song with no exact Spotify match is skipped, and the
  DJ is told how many were skipped.

## How it works

### 1. Last.fm module (`js/lastfm.js`, new)

Thin client over `https://ws.audioscrobbler.com/2.0/?format=json&api_key=…`:

- `track.getSimilar(artist, track)`: Spotify candidates.
- `artist.getSimilar(artist)` + `artist.getTopTags(artist)`: vinyl scoring.
- `artist.getTopTracks(artist)` / `album.getInfo(artist, album)`: picking a
  song from a vinyl album.

Throttle to about 5 requests/second (Last.fm's guideline). Cache artist
tags and similar-artist lists in `localStorage` for a long time (they rarely
change), so the ~189-record collection is fetched once, not on every
generate. Show progress the first time ("Learning your collection… 40/189").
Errors (bad key, rate limit, network) show a plain message and never leave
a half-built set behind.

### 2. Seed-vibe set builder

New entry point on Live Set: **"🎯 Vibe set"** next to Save/Open/Create/Reset
(name is the builder's call). Its panel has:

- three seed slots, each a Spotify search box with a results list (song +
  artist + album + art). Pick one to fill the slot;
- a song count (same input as Create set; default 20);
- Generate.

Generate:

1. **Spotify candidate pool.** `track.getSimilar` for each seed. Merge, and
   rank by how many seeds a track appears under, then by Last.fm match
   score. Resolve each candidate on Spotify via search (artist + title),
   accepting only a confident match (normalized artist and title equal,
   ignoring "remaster"/"live"/parenthetical suffixes). Drop unresolved
   candidates. Keep the leftover ranked pool for Shuffle (below).
2. **Vinyl scoring.** For every collection record, score its artist against
   the seeds: Last.fm artist similarity to any seed artist (direct
   similar-artist hit is strongest; the seed artist itself counts as a top
   match) combined with top-tag overlap. A record **fits** if its score
   clears a threshold (exact threshold and weighting are the builder's call,
   tuned so an obviously off-vibe record, e.g. a Ramón Ayala norteño record
   against three indie-folk seeds, does not fit).
3. **Song for each fitting vinyl.** Pick a specific track on that album: the
   artist's most popular Last.fm track that is on that album (via
   `album.getInfo` tracklist ∩ `artist.getTopTracks`), else the album's first
   track. Records with `"(album unspecified)"` or a `"note"` flag use the
   artist's top track and show the album as unknown. Also resolve each vinyl
   pick on Spotify now (album + track search) for art and for Save later.
   Store `spotifyUri` only on a confident match.
4. **Assemble.** Fitting vinyl sorted best fit first. Lay out
   V, S, V, S… until fitting vinyl runs out, then S, S, S… up to the song
   count. Include the 3 seeds themselves as Spotify songs in the set (they
   are the vibe the DJ chose; placing them is the builder's call).
5. Replace the live set (confirm first, like Open set does). Reset clears it.

### 3. Live Set changes for consecutive Spotify songs

Today the plan (`planOrder`) holds only vinyl IDs. Spotify slots are
implicit gaps between vinyls (`plannedSpotify[afterVinylId]`), and
`getTurn()` enforces strict alternation. That can't represent "S, S, S"
after the vinyl runs out.

Required behavior for a seed-vibe set: Live Set's Next-up card and Full Set
list follow the set's **explicit order** of vinyl and Spotify songs, so the
next item is simply the next unplayed song, whatever its source. Marking
played, ▲/▼ reordering, Change and Shuffle work on every row.

How to represent it is the builder's call. A sensible route: store Spotify
songs as real `source: 'spotify'` tracks inside `planOrder`, with a
per-set mode flag (e.g. `sequence` vs today's `alternate`) so existing
mood-wave sets and saved sets keep working unchanged. Saved sets and
Export/Import must round-trip the new shape. Old saved sets must still load.

### 4. Real suggestions in the existing flows

- **Create set (mood wave)** and Crate Builder's "Build a crate": every
  vinyl pick names a song (same song-picking rule as step 3 above), not
  "(DJ's choice)". Requires the Last.fm key; without it, fall back to the
  album's first track via Spotify `getAlbumTracks`, and only then to
  today's behavior.
- **Shuffle on a Spotify row** in a seed-vibe set: next unused song from
  that set's candidate pool, not a fresh text search.
- **Spotify turns in existing alternate-mode sets:** suggestions use Last.fm
  `track.getSimilar` seeded from the vinyl just played and the next vinyl
  (blended with the DJ's synced playlists as today's 90/10 rule does). The
  BPM/energy target can stay as secondary info, but the row always shows a
  concrete song + album.

### 5. Save to Spotify

- Add scopes `playlist-modify-private playlist-modify-public` to `login()`.
  The DJ re-logs in once after release (Settings should say so if the
  current token lacks the scope).
- On "Save this set": save the snapshot as today, then create a **private**
  playlist named after the set (my call: private), and add every song in set
  order: Spotify songs by URI, vinyl songs by their stored `spotifyUri`, or
  resolved now by exact search. Skip any vinyl with no confident match.
- **Vinyl match rule (decided by the DJ): exact version only.** A vinyl
  song matches only the same track on the **same album** on Spotify
  (normalized artist, title and album name all equal; a "Remastered"/
  "Deluxe Edition" suffix on the album name is fine, but no fallback to
  the studio version, another album, a compilation or a single). Live
  albums, compilations and soundtracks that aren't on Spotify as that
  album are skipped. The looser title-only rule in step 1 is for Spotify
  candidates from Last.fm, not for vinyl.
- Report: "Saved. Spotify playlist: 18 of 20 songs (2 vinyl not found on
  Spotify)" with a link to open it.
- **Re-saving the same live set updates its playlist** (replace items)
  instead of creating another. The live set remembers the playlist ID from
  its last save. Generating, Opening, or Resetting a set clears that link.
  A saved set keeps its playlist ID in the snapshot.
- If Spotify save fails, the in-app save still succeeds and the error is
  shown.
- **Verify endpoints against live responses before trusting docs.** This
  repo was bitten repeatedly by Spotify's March 2026 Dev Mode migration
  (`/tracks` → `/items`, renamed nesting). The playlist-create and add-items
  paths/shapes must be checked live the same way (`getPlaylistRawSample`
  pattern).

## Constraints

- Static site, no build step, plain ES modules. Bump the `?v=` cache tag on
  push (see `CLAUDE.md`).
- Keys (Last.fm API key, Spotify Client ID) live in `localStorage` only.
- Last.fm requests are throttled and cached. Spotify requests stay
  serialized/limited as today (rate limits).
- Must work at phone width (400px) in the current theme.
- Tests follow the repo's existing pattern: Node tests with mocked `fetch`
  for the Last.fm client, vinyl scoring/threshold, set assembly (alternate
  then Spotify-tail), Spotify match confidence, and save/skip counting.

## Calls made after review (designer's calls, not the DJ's)

- **Saving a mood-wave (alternate-mode) set to Spotify:** the playlist is the
  set in play order: played songs by `playedAt`, then the remaining plan
  with each vinyl followed by its planned Spotify pick where one exists.
  Empty (TBD) gaps are skipped, not filled at save time. Snapshots start
  storing planned Spotify picks so a saved set re-saves the same way.
- **Spotify turns in mood-wave sets:** keep today's ~90% from the DJ's
  synced playlists (with mood tags). The ~10% "fresh discovery" text search
  is **replaced** by Last.fm `track.getSimilar` seeded from the vinyl just
  played and the next vinyl, resolved on Spotify. If Last.fm has nothing,
  fall back to today's search. Lookahead stays at 25 gaps (a full night).
- **Actions inside a seed-vibe set:**
  - A guest vinyl goes into one of the next 3 vinyl positions, as today. In
    the Spotify-only tail it goes right after the current song.
  - Adding from Crate Builder inserts the record as the next vinyl.
  - "Create set" or "Vibe set" on top of an existing set **replaces** it
    after a confirm, and switches the mode accordingly.
  - The mood lever and BPM target are hidden or ignored in seed-vibe sets.
    The vibe comes from the seeds.
  - Shuffle on a vinyl row swaps in the next best-fitting unused record,
    with a named song.
- **Hand-added vinyl with a blank title** (`trackForm.js`, the Live Set
  vinyl edit form) also gets a named song via the same song-picking rule,
  with a loading state. "(DJ's choice)" only remains as a last resort when
  both Last.fm and Spotify fail.

## Left to the builder

- Exact scoring weights and fit threshold (tune against the real
  collection).
- Data shape for mixed-order sets, as long as old sets and saves keep
  working.
- Button name and panel layout.
- Where the 3 seeds sit in the set.
- Fallback wording and error copy.

## Addendum 2026-11-05: mix choice (requested by the DJ)

The Vibe set panel has a **Mixed / Vinyl only / Spotify only** choice next
to the song count. Mixed is the behavior above. Vinyl only ranks the whole
collection by vibe and takes the top `count` records (no fit threshold, so
the DJ always gets the number asked for, closest matches first). Spotify
only uses the seeds + Last.fm pool and never scores the collection.
