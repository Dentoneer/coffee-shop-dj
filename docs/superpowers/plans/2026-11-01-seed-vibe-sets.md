# Seed-Vibe Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick 3 Spotify songs and get a full vinyl + Spotify set that matches their vibe (via Last.fm), with a named song on every row, and save any set to Spotify as a playlist.

**Architecture:** New focused ES modules: `lastfm.js` (API client), `matching.js` (Spotify match rules), `songPicker.js` (song for a vinyl record), `vibeScore.js` (record fit), `vibeSet.js` (pool + assembly), `spotifySave.js` (playlist save), `sequenceView.js` (Live Set rendering for explicit-order sets). A seed-vibe set is a **sequence-mode** set: Spotify songs become real `source: 'spotify'` tracks inside `planOrder`, and `settings.planMode = 'sequence'`. Existing mood-wave sets stay `'alternate'` and keep today's gap model untouched.

**Tech Stack:** Plain HTML/CSS/ES modules, no build step, `localStorage`; Last.fm API 2.0 (JSON); Spotify Web API (PKCE, existing `js/spotify.js`); tests on Node 24 `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-01-seed-vibe-sets-design.md`

## Global Constraints

- Static site, no build step, no backend, no new dependencies.
- Every internal import carries the shared `?v=<tag>` cache tag; bump it once at the end (Task 11) with the `sed` one-liner in `CLAUDE.md`. New modules use the current tag (`20261101shame`) in their imports until then.
- Last.fm API key and Spotify Client ID live in `localStorage` only (Settings), never in code or commits.
- Last.fm: base `https://ws.audioscrobbler.com/2.0/`, `format=json`, at most 5 requests/second.
- Generating a set never writes to the DJ's Spotify account. Only Save does.
- Spotify playlists are **private**.
- Vinyl → Spotify matching for Save is **exact version only**: same normalized artist, title and album. A "Remastered"/"Deluxe Edition"-style album suffix is allowed; studio-for-live, compilation, single or other-album fallbacks are not.
- "(DJ's choice)" appears only as a last resort when Last.fm and Spotify both fail.
- UI works at 400px width in the current Shame Boys theme. Reuse existing classes (`card`, `track-row`, `badge`, `hint`, `row`, `secondary`).
- Spotify's March 2026 Dev Mode migration renamed endpoints. Verify every new Spotify endpoint against a live response before trusting docs (Task 11).

## Review Focus

1. **No Last.fm key, or an invalid one** → the Vibe set panel says how to add one in Settings, and nothing in the live set changes. Tested in Task 5.
2. **Seeds Last.fm knows nothing about** (obscure track, no similar tracks) → build from the seeds that do have data. If none do, show "Last.fm has no similar songs for these seeds", and the live set is untouched. Tested in Task 5.
3. **No record in the collection fits** → an all-Spotify set (seeds + pool), not an error. Tested in Task 5 (`assembleSequence` with zero vinyl).
4. **Save while logged out of Spotify, or with a token missing the playlist-modify scope** → the in-app save still succeeds, and the message says to log in again in Settings. Tested in Task 9.
5. **Shuffle when the candidate pool is used up** → the row stays as-is and shows "No more suggestions — use Change to search". Tested in Task 7 (`takeNextFromPool` returns null).

---

### Task 1: Test harness + Last.fm client

**Files:**
- Create: `tests/helpers/env.js`, `tests/lastfm.test.js`, `js/lastfm.js`
- Modify: `js/store.js` (add `lastfmApiKey: ''` to `DEFAULT_SETTINGS`; add key `lastfmCache: 'csdj.lastfmCache'`)

**Interfaces:**
- Produces (`tests/helpers/env.js`): `installEnv()` sets `globalThis.localStorage` (in-memory Map-backed shim with `getItem/setItem/removeItem/clear`) and `globalThis.fetch` routed through `mockFetch(handler)`, where `handler(url: URL) => {status, json}`. Also `resetEnv()`. Every test file calls `installEnv()` before dynamically importing modules under test.
- Produces (`js/lastfm.js`):
  - `hasLastfmKey(): boolean`
  - `class LastfmError extends Error { code: number|null }`
  - `getSimilarTracks(artist: string, title: string, limit = 50): Promise<Array<{artist, title, match: number}>>`
  - `getSimilarArtists(artist: string, limit = 250): Promise<Array<{name, match: number}>>`
  - `getArtistTopTags(artist: string): Promise<Array<{name, count: number}>>` (top 15, names lowercased)
  - `getArtistTopTracks(artist: string, limit = 50): Promise<Array<{title, playcount: number}>>`
  - `getAlbumTrackTitles(artist: string, album: string): Promise<string[]>` (empty array when Last.fm returns error 6 "not found")
  - `_resetThrottleForTests(): void`

- [ ] **Step 1: Write failing tests** in `tests/lastfm.test.js`, run with `node --test tests/`:
  - `getSimilarTracks maps similartracks.track[] to {artist,title,match}`: mock returns `{similartracks:{track:[{name:'Song A',artist:{name:'Art'},match:'0.81'}]}}` → `[{artist:'Art',title:'Song A',match:0.81}]`; request URL has `method=track.getsimilar`, `api_key=<settings key>`, `format=json`, `autocorrect=1`.
  - `caches responses`: two identical calls → fetch called once; cache entry lives under `csdj.lastfmCache`.
  - `throws LastfmError with code 10 on invalid key`: mock `{error:10,message:'Invalid API key'}` → rejects, `err.code === 10`.
  - `throws when no key configured`: `lastfmApiKey: ''` → rejects with `LastfmError` whose message contains `Settings`.
  - `getAlbumTrackTitles returns [] on error 6`.
  - `throttles to ≤5 req/s`: 6 uncached calls → the 6th call's fetch timestamp is ≥ 1000 ms after the 1st (use real timers, short test).
- [ ] **Step 2: Run** `node --test tests/` → FAIL (module missing).
- [ ] **Step 3: Implement `js/lastfm.js`.** Single `lastfmGet(method, params)` does the throttling (serialized promise chain, ≥200 ms between request starts), caching (`{[url-without-api_key]: {at, data}}`, TTL 30 days for `artist.*`/`album.*`, 7 days for `track.*`, capped at 2000 entries with oldest-first eviction), and error mapping (`json.error` → `LastfmError(json.message, json.error)`; network/HTTP failure → `LastfmError('Last.fm unreachable', null)`). Last.fm returns a lone object instead of an array when there is one result; normalize with `[].concat(x || [])`.
- [ ] **Step 4: Run** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** `feat: Last.fm client with throttle + cache, node:test harness`.

### Task 2: Spotify match rules

**Files:**
- Create: `js/matching.js`, `tests/matching.test.js`

**Interfaces:**
- Consumes: `searchTracks(query, limit)` from `js/spotify.js` (returns `{title, artist, album, trackNumber, albumArt, uri, externalUrl}`).
- Produces:
  - `normalizeText(s: string): string`: lowercase, strip accents (NFD + remove combining marks), `&`→`and`, drop punctuation, collapse spaces.
  - `normalizeTitle(s, {loose}: {loose: boolean}): string`: always strips a trailing ` - <n> Remaster(ed)…`/`(Remastered …)`. With `loose: true` it also strips every parenthetical/bracket and any ` - …live…/version/edit/mix` suffix.
  - `normalizeAlbum(s): string`: strips trailing `(…Remaster…|…Deluxe…|…Edition…|…Expanded…|…Anniversary…)` and the same after ` - `.
  - `artistMatches(want, got): boolean`: `got` may be a comma-joined multi-artist string. True if any part equals `want` after `normalizeText` (also ignoring a leading `the `).
  - `isLooseTrackMatch(want: {artist, title}, got): boolean`: artist matches and `normalizeTitle(…,{loose:true})` equal.
  - `isExactVinylMatch(want: {artist, title, album}, got): boolean`: artist matches, `normalizeTitle(…,{loose:false})` equal, `normalizeAlbum` equal.
  - `findSpotifyTrack({artist, title}): Promise<SpotifyResult|null>`: searches `track:"<title>" artist:"<artist>"` (limit 5), returns the first `isLooseTrackMatch`.
  - `findExactVinylOnSpotify({artist, title, album}): Promise<SpotifyResult|null>`: searches `track:"<title>" artist:"<artist>" album:"<album>"` (limit 10), returns the first `isExactVinylMatch`, else null.

- [ ] **Step 1: Write failing tests:**
  - `isExactVinylMatch accepts remastered album suffix`: want `{artist:'David Bowie', title:'Rebel Rebel', album:'Diamond Dogs'}`, got album `'Diamond Dogs (2016 Remaster)'`, title `'Rebel Rebel - 2016 Remaster'` → true.
  - `isExactVinylMatch rejects other album`: same want, got album `'David Live (2005 Mix)'` → false; got album `'Best of Bowie'` → false.
  - `isExactVinylMatch rejects live title on studio album want`: got title `'Rebel Rebel - Live'`, album `'Diamond Dogs'` → false.
  - `isLooseTrackMatch accepts live/parenthetical variants`: `'Chan Chan (Remasterizado)'` vs `'Chan Chan'`, artist `'Buena Vista Social Club'` → true.
  - `artistMatches handles accents, 'The', multi-artist`: `'Ramón Ayala y sus Bravos del Norte'` vs `'Ramon Ayala Y Sus Bravos Del Norte'` → true; `'Black Keys'` vs `'The Black Keys'` → true; `'Herb Alpert'` vs `'Herb Alpert, Tijuana Brass'` → true.
  - `findExactVinylOnSpotify returns null when only a compilation matches` (mock Spotify search + a stored auth token in `csdj.spotifyAuth` with future `expiresAt`).
- [ ] **Step 2: Run** `node --test tests/` → new tests FAIL.
- [ ] **Step 3: Implement `js/matching.js`.**
- [ ] **Step 4: Run** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** `feat: exact/loose Spotify match rules`.

### Task 3: Song picker for vinyl records, wired into every "(DJ's choice)" spot

**Files:**
- Create: `js/songPicker.js`, `tests/songPicker.test.js`
- Modify: `js/crateGenerator.js` (each pick gets a song), `js/trackForm.js:112-130` (blank title), `js/liveset.js:323` (vinyl edit form blank title)

**Interfaces:**
- Consumes: Task 1 `getAlbumTrackTitles`, `getArtistTopTracks`, `hasLastfmKey`. Task 2 `findExactVinylOnSpotify`. `searchAlbums`, `getAlbumTracks`, `isLoggedIn` from `js/spotify.js`.
- Produces: `pickSongForRecord(record: {artist, album, note?}, opts?: {excludeTitles?: string[]}): Promise<{title, trackNumber: number|null, albumUnknown: boolean, spotifyUri: string|null, spotifyArt: string|null} | null>`

Rule, in order:
1. Album is unknown if `album` contains `unspecified` or is empty → artist's top Last.fm track, `albumUnknown: true`.
2. Last.fm album tracklist ∩ artist top tracks (by `normalizeTitle loose`) → highest playcount, `trackNumber` = its index in the tracklist + 1.
3. Else the first tracklist entry.
4. Else (no Last.fm key or no tracklist) Spotify `searchAlbums("<album> <artist>")` → first result whose artist matches → `getAlbumTracks` → first track.
5. Else null.

Skip titles in `excludeTitles`. When logged in to Spotify and the album is known, also call `findExactVinylOnSpotify` and fill `spotifyUri`/`spotifyArt` only on a hit. Any Last.fm/Spotify error falls through to the next rule.

- [ ] **Step 1: Write failing tests** (`songPicker.test.js`, mocked fetch for both APIs):
  - `picks most-played track that is on the album`: tracklist `['Intro','Hit','Deep Cut']`, top tracks `[{title:'Other Album Song',playcount:900},{title:'Hit',playcount:500}]` → `{title:'Hit', trackNumber:2}`.
  - `falls back to first album track when no overlap`.
  - `album unspecified uses artist top track with albumUnknown true`.
  - `no Last.fm key falls back to Spotify album tracklist`.
  - `returns null when both services fail`.
  - `spotifyUri only set on exact match` (exact-match mock → uri set; compilation-only mock → null).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `songPicker.js`.**
- [ ] **Step 4: Wire it in.** `generateCrate` awaits `pickSongForRecord` per pick (sequentially, the throttle handles pacing) and sets `title`, `trackNumber`, `spotifyUri`, `spotifyArt`. It keeps `"(DJ's choice)"` only on null. `trackForm.js` and the Live Set vinyl edit form: when the title is left blank, show `Picking a song…`, await the picker, then save. Its signature changes to `generateCrate(count, curvePoints, onProgress?: (done:number,total:number)=>void)`. Both callers (`crate.js`, `liveset.js` Create set) show `Picking songs… done/total`.
- [ ] **Step 5: Run** `node --test tests/` → PASS. Manually: serve with `python -m http.server 8765`, Crate Builder → Build a crate (4) with a Last.fm key set → every row has a song title, none says "(DJ's choice)".
- [ ] **Step 6: Commit** `feat: name a real song for every vinyl pick`.

### Task 4: Vibe scoring of the collection

**Files:**
- Create: `js/vibeScore.js`, `tests/vibeScore.test.js`

**Interfaces:**
- Consumes: Task 1 `getSimilarArtists`, `getArtistTopTags`. Task 2 `normalizeText`.
- Produces:
  - `FIT_THRESHOLD = 0.3`
  - `scoreArtist(artist: string, seedProfile): number` (pure, 0..1)
  - `buildSeedProfile(seedArtists: string[]): Promise<{seedNames: Set<string>, similar: Map<string, number>, tags: Map<string, number>}>`. `similar` = max match per normalized artist across seeds. `tags` = summed counts of the seeds' top tags.
  - `scoreRecords(collection: Array<{artist, album}>, seedProfile, onProgress?: (done, total) => void): Promise<Array<{record, score}>>`, sorted by score descending. Fetches `getArtistTopTags` once per distinct collection artist (cached by Task 1).

Score:

```
direct  = seedNames has artist ? 1 : (similar.get(artist) ?? 0)
tagSim  = cosine(artistTags, seedTags)   // tag-name -> count vectors, 0 when either is empty
score   = 0.7 * direct + 0.3 * tagSim
```

- [ ] **Step 1: Write failing tests:**
  - `seed artist itself scores >= 0.7`.
  - `similar artist with match 0.6 and shared tags fits`: score ≥ `FIT_THRESHOLD`.
  - `off-vibe record does not fit`: seeds are three indie-folk artists (tags `indie folk`, `folk`, `acoustic`); `Ramón Ayala y sus Bravos del Norte` with tags `norteno`, `regional mexican`, not in similar → score < `FIT_THRESHOLD`.
  - `scoreRecords calls getArtistTopTags once per distinct artist` (two records by the same artist → one fetch) and reports progress `total` = distinct artists.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: score collection records against seed vibe`.

### Task 5: Vibe set builder (pool, assembly, generate)

**Files:**
- Create: `js/vibeSet.js`, `tests/vibeSet.test.js`
- Modify: `js/store.js`: add `planMode: 'alternate'` to `DEFAULT_SETTINGS`; keys `vibePool: 'csdj.vibePool'`, `liveSpotifyPlaylist: 'csdj.liveSpotifyPlaylist'`; methods `getVibePool()/saveVibePool(pool)` (`{spotify: SpotifyResult[], vinyl: Array<{record, score}>}`), `getLiveSpotifyPlaylist()/setLiveSpotifyPlaylist(id|null)`. `resetSetData()` also clears both new keys. Export/Import include `vibePool`.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `buildSpotifyPool(seeds: SpotifyResult[], excludeUris: string[]): Promise<SpotifyResult[]>`: `getSimilarTracks` per seed (a seed that errors or returns [] is skipped). Merge by normalized `artist|title`, rank by (number of seeds it appears under desc, summed match desc), resolve via `findSpotifyTrack` in rank order until 60 resolved, drop unresolved and excluded. Throws `Error('Last.fm has no similar songs for these seeds')` if every seed returned nothing.
  - `assembleSequence(vinyl: Track[], spotify: Track[], count: number): Track[]` (pure): if `vinyl.length` > 0 the set opens on vinyl and alternates V,S,V,S while vinyl remains, then S… until `count` total. Fewer candidates than `count` → shorter result.
  - `generateVibeSet(seeds: SpotifyResult[] /*exactly 3*/, count: number, onProgress: (label: string, done?: number, total?: number) => void): Promise<{count, vinylCount, spotifyCount, short: boolean}>`

`generateVibeSet` steps:
1. Throw `LastfmError` with a Settings hint if `!hasLastfmKey()`.
2. `buildSpotifyPool`.
3. `buildSeedProfile(seed artists)` → `scoreRecords(collection)` → fitting = score ≥ `FIT_THRESHOLD`.
4. Vinyl: walk fitting records best-first, `pickSongForRecord`, take up to `ceil(count/2)` that return a song.
5. Spotify tracks = the 3 seeds first, then the pool.
6. `assembleSequence`.
7. **Only now** write the Store: `saveTracks`, `savePlanOrder` (all ids), `updateSettings({planMode:'sequence', setStartedAt:null, leverOverride:null, autoDrift:true})`, `clearAllPlannedSpotify`, `saveLiveState({lastPlayedTrackId:null, turn:'vinyl'})`, `saveVibePool({spotify: unused pool, vinyl: unused fitting})`, `setLiveSpotifyPlaylist(null)`.

Count includes the seeds. Track objects use the existing shape (see `js/crateGenerator.js`), with `bpm: null, bpmEstimated: true, energy: 3`. Spotify tracks have `played: false, playedAt: null`.

- [ ] **Step 1: Write failing tests:**
  - `assembleSequence alternates then Spotify tail`: 2 vinyl, 10 spotify, count 8 → sources `V S V S S S S S`.
  - `assembleSequence with zero vinyl is all Spotify` (Review Focus 3).
  - `assembleSequence returns fewer than count when candidates run out`.
  - `buildSpotifyPool ranks tracks shared by 2 seeds above single-seed tracks`.
  - `buildSpotifyPool skips a seed with no similar tracks; throws when all are empty` (Review Focus 2).
  - `generateVibeSet without Last.fm key rejects and leaves tracks/planOrder unchanged` (Review Focus 1: pre-seed Store with one track, assert it's still there).
  - `generateVibeSet writes sequence-mode set with seeds included` (full mock: 3 seeds, Last.fm similar, tags, Spotify search) → `planMode === 'sequence'`, planOrder length = count, all 3 seed URIs present.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: build seed-vibe sets from Last.fm + collection`.

### Task 6: Sequence mode in the plan model

**Files:**
- Modify: `js/plan.js`, `js/savedSets.js`, `js/crateGenerator.js`, `js/crate.js`, `js/liveset.js` (guest add path ~line 951; Open/Create/Reset)
- Create: `tests/plan.test.js`

**Interfaces:**
- Produces (`plan.js`):
  - `getPlanMode(settings): 'alternate'|'sequence'`
  - `getNextInSequence(planOrder, tracks): Track|null`: first unplayed id in `planOrder`, any source.
  - `insertSoon(trackId, planOrder, tracks): string[]`: inserts right after the next unplayed item, or appends if none.
  - `computeLiveSnapshot()` adds `mode` and `nextItem` (sequence: `getNextInSequence`; alternate: unchanged behavior, `nextItem = null`).
- Produces (`savedSets.js`): the snapshot adds `planMode`, `plannedSpotify` (the map), `spotifyPlaylistId`. `loadSavedSet` restores `planMode` (default `'alternate'` for old sets) and `plannedSpotify`, and calls `Store.setLiveSpotifyPlaylist(null)`. Old saved sets without these fields load as before.

Behavior changes:
- In sequence mode, guest vinyl (Live Set) and Crate Builder single adds use `insertSoon` instead of `insertVinylTrack`.
- Crate Builder "Build a crate" and Live Set "Create set": when the current mode is `'sequence'`, `confirm()` then reset first, and set `planMode: 'alternate'`.
- Open set and Reset set call `Store.setLiveSpotifyPlaylist(null)`. Reset also sets `planMode: 'alternate'`.

- [ ] **Step 1: Write failing tests:**
  - `getNextInSequence returns first unplayed of any source` (`[V played, S unplayed, V]` → the S).
  - `insertSoon places after the next unplayed item` (`[a(played), b, c]` + g → `[a, b, g, c]`), and appends on an empty/fully-played plan.
  - `loadSavedSet of an old snapshot without planMode → alternate`.
  - `buildSnapshot round-trips planMode and plannedSpotify`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: sequence-mode plan model`.

### Task 7: Live Set rendering for sequence-mode sets

**Files:**
- Create: `js/sequenceView.js`, `tests/sequenceView.test.js` (pure helpers only)
- Modify: `js/liveset.js` (`refreshTurn`, `refreshLever`)

**Interfaces:**
- Consumes: Task 6 snapshot (`mode`, `nextItem`). Task 5 `Store.getVibePool/saveVibePool`. `searchTracks`.
- Produces (`sequenceView.js`):
  - `takeNextFromPool(pool: {spotify, vinyl}, kind: 'spotify'|'vinyl', excludeKeys: Set<string>): {pick, pool} | null` (pure). Key = `spotifyUri` for Spotify, `artist|album` normalized for vinyl. Returns null when exhausted.
  - `moveInOrder(planOrder, id, delta, tracks): string[]` (pure): swaps with the neighbor among **unplayed** items only.
  - `renderSequenceTurn(turnCard, snap, ctx)` and `renderSequenceList(listEl, snap, ctx)`, where `ctx = {refreshTurn, renderVinylEditForm, trackLine, bpmLabel}`, passed from `renderLiveTab`.

Behavior:
- **Turn card:** shows `nextItem` with its badge. Every row shows song title, artist and album (`trackLine`), plus art when present.
  - Vinyl: Mark played / Shuffle / Change track, as today. Shuffle = next fitting record from `pool.vinyl`, with its song via `pickSongForRecord`, replacing this track's fields in place. The old record goes back to the end of `pool.vinyl`.
  - Spotify: Play this (`markPlayed`) / Shuffle (next from `pool.spotify`, replacing the track's title/artist/album/uri/art in place) / Change (existing search UI pattern, replaces in place).
  - No BPM/energy target box.
- **Full list:** played rows (`playedAt` order, dimmed, as today), then every unplayed `planOrder` item. Each has ▲/▼ (`moveInOrder`), Shuffle and Change as above. No drag handle in sequence mode (▲/▼ is the reliable path).
- Exhausted pool → hint "No more suggestions — use Change to search", row unchanged (Review Focus 5).
- `refreshLever`: hides the Mood lever card when `mode === 'sequence'`.
- `refreshTurn`: `if (snap.mode === 'sequence') { renderSequenceTurn(...); renderSequenceList(...) } else` today's code, unchanged.

- [ ] **Step 1: Write failing tests:** `takeNextFromPool skips excluded and returns null when exhausted`, `moveInOrder skips played items and is a no-op at the ends`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** helpers and the two renderers, and wire them into `liveset.js`.
- [ ] **Step 4: Run** `node --test tests/` → PASS. Manually (local server): load a hand-built sequence set via devtools (`localStorage` with 2 vinyl + 4 Spotify tracks, `planMode:'sequence'`). Check that Next-up walks V,S,V,S,S,S on Mark played / Play this, ▲/▼ reorders, and the mood lever is hidden.
- [ ] **Step 5: Commit** `feat: Live Set view for sequence-mode sets`.

### Task 8: Vibe set panel + Last.fm key in Settings

**Files:**
- Modify: `js/liveset.js` (fifth quick-action button + panel), `js/settings.js` (Last.fm key card)

**Interfaces:**
- Consumes: Task 5 `generateVibeSet`, `searchTracks`, `hasLastfmKey`.

Behavior:
- Live Set quick actions gain **"🎯 Vibe set"**, toggling a panel like Create set does (closing the others).
- Panel: three seed slots. Each has a text input and a Search button → result rows (art, title, artist · album). Clicking a row fills the slot as a compact row with a ✕ to clear it. Then a song count (default 20, min 6, max 60) and **Generate**, disabled until 3 seeds are filled.
- No Last.fm key → the panel body is only: "Vibe sets use Last.fm. Add your free API key in Settings → Last.fm (takes 2 minutes)."
- Not logged into Spotify → "Log in to Spotify in Settings to search for seed songs."
- Generate: if the live set has tracks, `confirm('Replace the current set with a new vibe set?')`. Show progress labels from `onProgress` (first run: "Learning your collection… 40/189"). On success: "Built 20 songs: 7 vinyl, 13 Spotify", plus " (fewer than asked, not enough matches)" when `short`, then `refreshTurn()`. On error: show `err.message`, set untouched.
- Settings: a new card **"Last.fm"** with a password-type input bound to `lastfmApiKey`, a "Test key" button (calls `getArtistTopTags('Radiohead')`, shows ✓ or the error), and a hint linking `https://www.last.fm/api/account/create`.

- [ ] **Step 1: Implement** the Settings card. Manually verify the key persists across reload and Test key reports an invalid key.
- [ ] **Step 2: Implement** the panel.
- [ ] **Step 3: Verify manually** (local server, real Last.fm key + Spotify login if available, otherwise the mocked-Store path from Task 7). Check the no-key message, the not-logged-in message, Generate disabled until 3 seeds, and the panel at 400px (iframe screenshot method from STATE.md).
- [ ] **Step 4: Run** `node --test tests/` → PASS (no regressions).
- [ ] **Step 5: Commit** `feat: Vibe set panel and Last.fm settings`.

### Task 9: Save to Spotify

**Files:**
- Modify: `js/spotify.js` (scopes, auth stores granted scope, playlist write calls), `js/liveset.js` (Save handler), `js/settings.js` (saved-set row shows "Open in Spotify" when it has `spotifyPlaylistId`; re-login notice)
- Create: `js/spotifySave.js`, `tests/spotifySave.test.js`

**Interfaces:**
- Produces (`spotify.js`):
  - `login()` scope becomes `playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public`.
  - `handleRedirect`/`refresh` store `scope` from the token response in the auth object.
  - `hasScope(name: string): boolean`
  - `createPlaylist(name: string): Promise<{id, url}>`: `POST /me/playlists` `{name, public:false, description:'Saved from Coffee Shop DJ'}`.
  - `replacePlaylistItems(id, uris: string[]): Promise<void>`: `PUT /playlists/{id}/items` with the first 100, then `POST /playlists/{id}/items` in chunks of 100. On 404 for `/items`, retry the same call on `/tracks` once and log which path worked.
- Produces (`spotifySave.js`):
  - `collectSetEntries(state: {mode, tracks, planOrder, plannedSpotify}): Array<{kind:'spotify', uri} | {kind:'vinyl', track}>` (pure). Sequence: `planOrder` order. Alternate: played by `playedAt`, then each unplayed vinyl in `planOrder` followed by `plannedSpotify[vinyl.id]?.uri` when present (TBD gaps skipped).
  - `saveSetToSpotify(set /* snapshot from buildSnapshot */, existingPlaylistId: string|null): Promise<{playlistId, url, added, total, skippedVinyl}>`. Vinyl uses `track.spotifyUri`, else `findExactVinylOnSpotify`, else skipped. Replaces the items of `existingPlaylistId` if given; if that playlist is gone (404), creates a new one.

Save handler (Live Set): `saveCurrentSet(name)` first (in-app save always happens). Then, if logged in and `hasScope('playlist-modify-private')`, call `saveSetToSpotify(set, Store.getLiveSpotifyPlaylist())`, `Store.setLiveSpotifyPlaylist(id)`, and write `spotifyPlaylistId` onto the saved snapshot. Message: `Saved "<name>". Spotify playlist: 18 of 20 songs (2 vinyl not found on Spotify). Open in Spotify`. Not logged in or missing scope → `Saved "<name>" in the app. To also save it to Spotify, log out and back in to Spotify in Settings.` (Review Focus 4). A Spotify error → `Saved in the app; Spotify save failed: <message>`.

- [ ] **Step 1: Write failing tests:**
  - `collectSetEntries sequence keeps planOrder order`.
  - `collectSetEntries alternate: played by time, then vinyl + planned pick, TBD skipped`.
  - `saveSetToSpotify skips vinyl without exact match and counts them`: 2 vinyl (one with `spotifyUri`, one resolving only to a compilation) + 2 Spotify → `added 3, total 4, skippedVinyl 1`. Mock asserts the PUT body uris in set order.
  - `re-save replaces items on the existing playlist, no create call`.
  - `existing playlist 404 → creates a new one`.
  - `save without modify scope keeps the in-app save` (call the Live Set's extracted `saveSetEverywhere(name)` helper, exported from `spotifySave.js` so it is testable). Assert the saved set exists and the result has `spotify: null, reason: 'scope'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `spotify.js` additions, `spotifySave.js` (including `saveSetEverywhere(name): Promise<{set, spotify: {...}|null, reason?: 'logged-out'|'scope'|'error', error?}>`), the Live Set handler, and the Settings link + notice ("Spotify login is missing playlist permission — log out and in again" when logged in without the scope).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: Save this set also saves a private Spotify playlist`.

### Task 10: Last.fm suggestions in mood-wave Spotify turns

**Files:**
- Modify: `js/liveset.js:23-77` (`pickSpotifyCandidate`) and its callers (turn Shuffle, lookahead, gap Shuffle)

**Interfaces:**
- Consumes: Task 1 `getSimilarTracks`, Task 2 `findSpotifyTrack`.
- Produces: `pickSpotifyCandidate(autoQuery, excludeUris = [], energyTarget = null, neighbors = [])`, where `neighbors: Array<{artist, title}>` are the vinyls on either side of the gap. Callers pass the gap's `leftVinyl`/`rightVinyl` (turn card: `snap.lastPlayed`, `snap.nextVinyl`), filtering out titles equal to `"(DJ's choice)"`.

Rule: the ~90% playlist path is unchanged. The ~10% discovery path: if `hasLastfmKey()` and neighbors exist, merge `getSimilarTracks` for each neighbor (limit 30), shuffle the top 10, and return the first `findSpotifyTrack` hit not in `excludeUris`, as `{...hit, fromPlaylist:false, fromLastfm:true}`. Otherwise (or on any Last.fm error) use today's `searchTracks(autoQuery)`. Row label: `from Last.fm` instead of `new` when `fromLastfm`.

- [ ] **Step 1: Extract** the discovery branch into an exported `discoverSimilar(neighbors, excludeUris): Promise<SpotifyResult|null>` in `js/vibeSet.js` (beside `buildSpotifyPool`, sharing its merge logic). Write tests: `discoverSimilar returns a resolved similar track not excluded`; `returns null with no key/neighbors`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** and wire into `pickSpotifyCandidate`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: Last.fm-similar discovery picks in mood-wave sets`.

### Task 11: Ship and verify live

**Files:**
- Modify: `index.html` + `js/*.js` (cache tag), `CLAUDE.md` (architecture: new modules, sequence mode, Last.fm key, scopes, tests via `node --test tests/`), `STATE.md`

- [ ] **Step 1: Bump the cache tag** to `20261101vibe` with the `CLAUDE.md` sed one-liner (also covers new modules). Run `node --test tests/` → PASS. Run `grep -rn "v=20261101shame" js index.html` → no output.
- [ ] **Step 2: Headless screenshots** (local server) of Live Set with the Vibe set panel open, at 1200px and 400px (iframe method). There should be no horizontal overflow.
- [ ] **Step 3: Update `CLAUDE.md` and `STATE.md`.** Commit `chore: ship seed-vibe sets`. Push to `master`.
- [ ] **Step 4: Live verification with the DJ** (needs their accounts, so ask them to do it):
  1. Create a Last.fm API key, paste it into Settings, and press Test key.
  2. Log out of Spotify and back in to grant the playlist permission.
  3. Build a Vibe set from 3 real seeds and check every row has song + album.
  4. Save it and confirm the private playlist appears in Spotify with the reported count.
  5. Save again and confirm no second playlist was created.

  If any Spotify write call fails, capture the raw response (as with `getPlaylistRawSample`) and fix the endpoint shape before declaring done.
- [ ] **Step 5: Record** in `STATE.md` what was verified live versus only in tests.
