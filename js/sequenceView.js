// Live Set rendering for "sequence" sets (vibe sets): planOrder holds every
// song, vinyl and Spotify, in play order, so Next-up is simply the next
// unplayed song and the Spotify slots are real songs, not gaps to fill.
// Shuffle draws from the vibe set's own unused candidates (Store vibePool),
// not a fresh text search. Mood-wave ("alternate") sets keep liveset.js's
// original gap-based rendering untouched.

import { Store } from './store.js?v=20261105genre';
import { markPlayed } from './plan.js?v=20261105genre';
import { searchTracks, isLoggedIn } from './spotify.js?v=20261105genre';
import { normalizeText } from './matching.js?v=20261105genre';
import { pickSongForRecord } from './songPicker.js?v=20261105genre';

export const vinylKey = (r) => `${normalizeText(r.artist).replace(/^the /, '')}|${normalizeText(r.album)}`;

/** Pure: next unused candidate of `kind`, plus the pool without it. */
export function takeNextFromPool(pool, kind, excludeKeys) {
  const list = pool[kind] || [];
  const keyOf = kind === 'spotify' ? (p) => p.uri : (p) => vinylKey(p.record);
  const idx = list.findIndex((p) => !excludeKeys.has(keyOf(p)));
  if (idx === -1) return null;
  return { pick: list[idx], pool: { ...pool, [kind]: list.filter((_, i) => i !== idx) } };
}

/** Pure: swap `id` with its unplayed neighbor in direction delta (-1/+1). */
export function moveInOrder(planOrder, id, delta, tracks) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const unplayed = planOrder.filter((x) => byId.get(x) && !byId.get(x).played);
  const i = unplayed.indexOf(id);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= unplayed.length) return planOrder;
  const a = planOrder.indexOf(id);
  const b = planOrder.indexOf(unplayed[j]);
  const out = planOrder.slice();
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

const NO_MORE = 'No more suggestions — use Change to search.';

/** Replace a track's song in place with the next pool candidate. Returns an error hint or null. */
async function shuffleTrack(track) {
  const tracks = Store.getTracks();
  let pool = Store.getVibePool();
  if (track.source === 'spotify') {
    const inSet = new Set(tracks.map((t) => t.spotifyUri).filter(Boolean));
    const next = takeNextFromPool(pool, 'spotify', inSet);
    if (!next) return NO_MORE;
    const r = next.pick;
    const old = { title: track.title, artist: track.artist, album: track.album, trackNumber: track.trackNumber, albumArt: track.spotifyArt, uri: track.spotifyUri };
    Store.updateTrack(track.id, { title: r.title, artist: r.artist, album: r.album || null, trackNumber: r.trackNumber ?? null, spotifyArt: r.albumArt || null, spotifyUri: r.uri });
    Store.saveVibePool({ ...next.pool, spotify: old.uri ? [...next.pool.spotify, old] : next.pool.spotify });
    return null;
  }
  const inSet = new Set(tracks.filter((t) => t.source === 'vinyl').map(vinylKey));
  for (;;) {
    const next = takeNextFromPool(pool, 'vinyl', inSet);
    if (!next) return NO_MORE;
    pool = next.pool;
    const { record } = next.pick;
    const song = await pickSongForRecord(record);
    if (!song) { inSet.add(vinylKey(record)); continue; }
    const back = { record: { artist: track.artist, album: track.album }, score: 0 };
    Store.updateTrack(track.id, {
      artist: record.artist, album: record.album, title: song.title, trackNumber: song.trackNumber ?? null,
      albumUnknown: !!song.albumUnknown, spotifyArt: song.spotifyArt, spotifyUri: song.spotifyUri, bpm: null, bpmEstimated: true,
    });
    Store.saveVibePool({ ...pool, vinyl: [...pool.vinyl, back] });
    return null;
  }
}

/** Spotify search that replaces `track`'s song in place on pick. */
function renderSpotifyChange(mount, track, onDone) {
  mount.innerHTML = `
    <label>Search Spotify</label>
    <div class="row">
      <input type="text" class="sq-q" value="${track.artist}" />
      <button type="button" class="sq-go" style="flex:none;">Search</button>
      <button type="button" class="secondary sq-cancel" style="flex:none;">Cancel</button>
    </div>
    <div class="sq-results"></div>
  `;
  const resultsEl = mount.querySelector('.sq-results');
  async function doSearch() {
    const q = mount.querySelector('.sq-q').value.trim();
    if (!q) return;
    if (!isLoggedIn()) { resultsEl.innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>'; return; }
    resultsEl.innerHTML = '<p class="hint">Searching…</p>';
    try {
      const results = await searchTracks(q, 8);
      resultsEl.innerHTML = results.length ? '' : '<p class="hint">No results — try a different search.</p>';
      results.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'track-row';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          ${r.albumArt ? `<img src="${r.albumArt}" />` : ''}
          <div class="track-meta"><div class="title">${r.title}</div><div class="sub">${r.artist} &middot; ${r.album || ''}</div></div>
        `;
        row.addEventListener('click', () => {
          Store.updateTrack(track.id, { title: r.title, artist: r.artist, album: r.album || null, trackNumber: r.trackNumber ?? null, spotifyArt: r.albumArt || null, spotifyUri: r.uri });
          onDone();
        });
        resultsEl.appendChild(row);
      });
    } catch (e) {
      resultsEl.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
    }
  }
  mount.querySelector('.sq-go').addEventListener('click', doSearch);
  mount.querySelector('.sq-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  mount.querySelector('.sq-cancel').addEventListener('click', onDone);
  doSearch();
}

function openChange(mount, track, ctx) {
  if (track.source === 'vinyl') ctx.renderVinylEditForm(mount, track, ctx.refreshTurn);
  else renderSpotifyChange(mount, track, ctx.refreshTurn);
}

async function runShuffle(track, hintEl, ctx) {
  hintEl.textContent = 'Shuffling…';
  const err = await shuffleTrack(track);
  if (err) hintEl.textContent = err;
  else ctx.refreshTurn();
}

function songMeta(t) {
  if (t.albumUnknown || !t.album) return 'album unknown';
  return `${t.album}${t.trackNumber != null ? ` #${t.trackNumber}` : ''}`;
}

export function renderSequenceTurn(turnCard, snap, ctx) {
  const t = snap.nextItem;
  if (!t) {
    turnCard.innerHTML = '<h3>Next up</h3><p class="hint">That was the last song in this set. Build another with 🎯 Vibe set or ✨ Create set.</p>';
    return;
  }
  const isVinyl = t.source === 'vinyl';
  turnCard.innerHTML = `
    <h3>Next up: <span class="badge ${t.source}">${t.source.toUpperCase()}</span> ${t.guestRequested ? '<span class="badge guest">guest</span>' : ''}</h3>
    <div class="track-row">
      ${t.spotifyArt ? `<img src="${t.spotifyArt}" />` : ''}
      <div class="track-meta">
        <div class="title">${t.title} &mdash; ${t.artist}</div>
        <div class="sub">${songMeta(t)}</div>
      </div>
    </div>
    <div class="row">
      <button type="button" class="sq-play">${isVinyl ? 'Mark played' : 'Play this'}</button>
      <button type="button" class="secondary sq-shuffle" title="Swap in the next best match">&#128256; Shuffle</button>
      <button type="button" class="secondary sq-change">Change</button>
    </div>
    <p class="hint sq-hint"></p>
    <div class="sq-mount" style="margin-top:0.6rem"></div>
  `;
  turnCard.querySelector('.sq-play').addEventListener('click', () => { markPlayed(t.id); ctx.refreshTurn(); });
  turnCard.querySelector('.sq-shuffle').addEventListener('click', () => runShuffle(t, turnCard.querySelector('.sq-hint'), ctx));
  turnCard.querySelector('.sq-change').addEventListener('click', () => openChange(turnCard.querySelector('.sq-mount'), t, ctx));
}

function smallButton(label, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'secondary';
  b.textContent = label;
  if (title) b.title = title;
  b.style.flex = 'none';
  b.addEventListener('click', onClick);
  return b;
}

export function renderSequenceList(listEl, snap, ctx) {
  listEl.innerHTML = '';
  const byId = new Map(snap.tracks.map((t) => [t.id, t]));
  const played = snap.tracks.filter((t) => t.playedAt).sort((a, b) => a.playedAt - b.playedAt);
  const upcoming = snap.planOrder.map((id) => byId.get(id)).filter((t) => t && !t.played);

  played.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.style.opacity = '0.6';
    row.innerHTML = `
      <span class="badge ${t.source}">${t.source.toUpperCase()}</span>
      <div class="track-meta"><div class="title">${t.title} &mdash; ${t.artist}</div><div class="sub">${songMeta(t)} &middot; played</div></div>
    `;
    listEl.appendChild(row);
  });

  upcoming.forEach((t, i) => {
    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'track-row seq-row';
    if (i === 0) row.style.background = 'var(--accent-soft)';
    row.innerHTML = `
      <span class="badge ${t.source}">${t.source.toUpperCase()}</span>
      ${t.guestRequested ? '<span class="badge guest">guest</span>' : ''}
      <div class="track-meta"><div class="title">${t.title} &mdash; ${t.artist}</div><div class="sub">${songMeta(t)}</div></div>
    `;
    const move = document.createElement('span');
    move.style.cssText = 'display:flex;flex-direction:column;gap:0.2rem;flex:none;';
    const mv = (delta) => () => {
      Store.savePlanOrder(moveInOrder(Store.getPlanOrder(), t.id, delta, Store.getTracks()));
      ctx.refreshTurn();
    };
    [smallButton('▲', 'Move up', mv(-1)), smallButton('▼', 'Move down', mv(1))].forEach((b) => {
      b.style.padding = '0.1rem 0.4rem';
      b.style.fontSize = '0.7rem';
      move.appendChild(b);
    });
    row.insertBefore(move, row.querySelector('.track-meta'));
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.style.margin = '0';
    const mount = document.createElement('div');
    row.appendChild(smallButton('\u{1F500}', 'Swap in the next best match', () => runShuffle(t, hint, ctx)));
    row.appendChild(smallButton('Change', null, () => openChange(mount, t, ctx)));
    wrap.appendChild(row);
    wrap.appendChild(hint);
    wrap.appendChild(mount);
    listEl.appendChild(wrap);
  });

  if (!played.length && !upcoming.length) listEl.innerHTML = '<p class="hint">Nothing in this set yet.</p>';
}
