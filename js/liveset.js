import { Store, newId } from './store.js?v=20260918b';
import { computeLiveSnapshot, markPlayed, insertVinylTrack, getBridgeTarget, getPlanDirection } from './plan.js?v=20260918b';
import { renderTrackForm } from './trackForm.js?v=20260918b';
import { searchTracks, isLoggedIn } from './spotify.js?v=20260918b';
import { createTapTempo } from './tapTempo.js?v=20260918b';
import { syncPlaylists } from './spotifySync.js?v=20260918b';
import { saveCurrentSet } from './savedSets.js?v=20260918b';

// Fraction of Spotify bridge picks that come from a fresh catalog search
// instead of the DJ's own playlists, for variety. Playlist tracks carry no
// tempo data either (same limitation as search), so this is about mixing
// familiar with new, not a smarter pick.
const NEW_MUSIC_FRACTION = 0.1;

// The single source of "get me a Spotify bridge candidate" - used for the
// initial auto-suggestion, the Full Set lookahead, and the Shuffle button,
// so all three pull from the same 90/10 playlist/discovery mix. Playlist
// tracks come from spotifySync's shared cache (synced once, reused
// everywhere - Live Set, Spotify Corner - instead of each screen
// fetching its own copy).
async function pickSpotifyCandidate(autoQuery, excludeUris = []) {
  const { tracks: pool } = await syncPlaylists();
  const excluded = new Set(excludeUris.filter(Boolean));
  const available = pool.filter((t) => !excluded.has(t.uri));
  const useDiscovery = available.length === 0 || Math.random() < NEW_MUSIC_FRACTION;
  if (!useDiscovery) {
    const pick = available[Math.floor(Math.random() * available.length)];
    return { ...pick, fromPlaylist: true };
  }
  const results = await searchTracks(autoQuery, 5);
  const fresh = results.find((r) => !excluded.has(r.uri)) || results[0] || null;
  return fresh ? { ...fresh, fromPlaylist: false } : null;
}

// Spotify's actual recommendation/audio-features endpoints are blocked for
// any developer app created after Nov 2024 (403, permanently, short of
// 250k+ MAU extended access) — there is no real "Spotify algorithm" this
// app can call. Best honest substitute: auto-build a search query from the
// bridge target's flavor tags and run it automatically, so the DJ never
// has to type anything, just pick from what comes back.
const FLAVOR_TO_GENRE_HINT = {
  'Latin/Bossa/Cumbia': 'bossa nova',
  'Jazz/Soul': 'jazz',
  'Lo-fi/Chill': 'chill',
  'Indie/Folk': 'indie folk',
  'Funk/Groove': 'funk',
  'World': 'world',
};

function buildAutoQuery(bridgeTarget) {
  const genres = bridgeTarget.flavorHint
    .map((f) => FLAVOR_TO_GENRE_HINT[f])
    .filter(Boolean);
  const unique = Array.from(new Set(genres));
  return unique.slice(0, 2).join(' ') || 'coffee shop jazz';
}

// How many upcoming Spotify gaps get a real pre-fetched suggestion in the
// Full Set list (vs. "TBD"). Fetches are serialized (one at a time), so
// raising this just takes a bit longer to fill in, not more load at once -
// covers a full night's worth of tracks rather than only the next couple.
const LOOKAHEAD_GAPS = 25;

export function renderLiveTab(container) {
  container.innerHTML = `
    <div class="card" style="padding:0.5rem 0.8rem;">
      <div class="row" style="gap:0.5rem;">
        <strong style="flex:none;font-size:0.85rem;">Mood <span id="lever-value"></span></strong>
        <input type="range" id="lever-slider" min="1" max="5" step="0.1" style="flex:2;" />
        <label style="margin:0;flex:none;font-size:0.8rem;white-space:nowrap;">
          <input type="checkbox" id="lever-autodrift" /> auto
        </label>
        <button type="button" class="secondary" id="lever-start-set" style="flex:none;padding:0.3rem 0.6rem;font-size:0.8rem;">Start</button>
      </div>
      <p class="hint" id="lever-hint" style="margin:0.2rem 0 0;font-size:0.75rem;"></p>
    </div>

    <div class="card" style="padding:0.5rem 0.8rem;">
      <button type="button" class="secondary" id="toggle-save-set">&#128190; Save this set</button>
      <div id="save-set-form" style="margin-top:0.5rem;"></div>
    </div>

    <div class="card" id="turn-card"></div>

    <div class="card">
      <button type="button" class="secondary" id="toggle-guest-form">+ Add guest vinyl</button>
      <div id="guest-form" style="margin-top:0.8rem;"></div>
    </div>

    <div class="card">
      <h3>Guest crate</h3>
      <p class="hint">Every vinyl a guest has handed you tonight, in one place.</p>
      <div id="guest-crate-list"></div>
    </div>

    <div class="card">
      <h3>Full set</h3>
      <p class="hint">Played so far, then the upcoming plan. Every row has a "Change" link if you want a different song.</p>
      <div id="full-list"></div>
    </div>
  `;

  const leverSlider = container.querySelector('#lever-slider');
  const leverAutoDrift = container.querySelector('#lever-autodrift');

  function refreshLever() {
    const settings = Store.getSettings();
    const snap = computeLiveSnapshot();
    leverSlider.value = snap.leverValue;
    leverAutoDrift.checked = settings.autoDrift;
    container.querySelector('#lever-value').textContent = `— ${snap.leverValue.toFixed(1)} / 5`;
    container.querySelector('#lever-hint').textContent = settings.setStartedAt
      ? `Drifting ${settings.leverStart}→${settings.leverEnd} over ${settings.setDurationMinutes}min`
      : 'Not started — hit "Start" to begin the drift.';
  }

  leverSlider.addEventListener('input', () => {
    Store.updateSettings({ leverOverride: Number(leverSlider.value), autoDrift: false });
    leverAutoDrift.checked = false;
    refreshTurn();
  });
  leverAutoDrift.addEventListener('change', () => {
    Store.updateSettings({ autoDrift: leverAutoDrift.checked, leverOverride: leverAutoDrift.checked ? null : Number(leverSlider.value) });
    refreshLever();
    refreshTurn();
  });
  container.querySelector('#lever-start-set').addEventListener('click', () => {
    Store.updateSettings({ setStartedAt: Date.now(), autoDrift: true, leverOverride: null });
    refreshLever();
    refreshTurn();
  });

  function trackLine(t) {
    const bits = [];
    if (t.album) bits.push(t.album);
    if (t.trackNumber != null) bits.push(`#${t.trackNumber}`);
    return bits.length ? `${t.title} &middot; ${bits.join(' ')}` : t.title;
  }

  function playedSpotifyUris() {
    return Store.getTracks().filter((t) => t.source === 'spotify' && t.playedAt).map((t) => t.spotifyUri);
  }

  // Swaps the vinyl in this slot with a random other unplayed vinyl
  // elsewhere in the plan - the vinyl equivalent of Spotify's Shuffle:
  // a different option with no manual dragging/searching.
  function shuffleVinylSlot(id) {
    const tracksById = new Map(Store.getTracks().map((t) => [t.id, t]));
    const planOrder = Store.getPlanOrder();
    const idx = planOrder.indexOf(id);
    if (idx === -1) return;
    const candidateIdxs = planOrder
      .map((otherId, i) => ({ otherId, i }))
      .filter(({ otherId }) => {
        if (otherId === id) return false;
        const t = tracksById.get(otherId);
        return t && !t.played;
      });
    if (candidateIdxs.length === 0) return;
    const { i: pickIdx } = candidateIdxs[Math.floor(Math.random() * candidateIdxs.length)];
    const newOrder = planOrder.slice();
    [newOrder[idx], newOrder[pickIdx]] = [newOrder[pickIdx], newOrder[idx]];
    Store.savePlanOrder(newOrder);
    refreshTurn();
  }

  // A default (untapped) BPM means its position in the tempo-flow plan is
  // just a placeholder, not a real transition fit - flag it so it's never
  // mistaken for a considered placement.
  function bpmLabel(t) {
    return t.bpmEstimated
      ? `<span style="color:var(--accent);">&#9888; ${t.bpm} BPM (est. - tap tempo for a real transition fit)</span>`
      : `${t.bpm ?? '?'} BPM`;
  }

  function renderGuestCrate() {
    const listEl = container.querySelector('#guest-crate-list');
    const guests = Store.getTracks()
      .filter((t) => t.guestRequested)
      .sort((a, b) => a.addedAt - b.addedAt);

    if (guests.length === 0) {
      listEl.innerHTML = '<p class="hint">No guest vinyls yet — click "+ Add guest vinyl" above when someone hands you one.</p>';
      return;
    }

    listEl.innerHTML = '';
    guests.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.innerHTML = `
        <div class="vinyl-disc">&#9835;</div>
        <div class="track-meta">
          <div class="title">${t.artist} ${t.played ? '&#9989; played' : ''}</div>
          <div class="sub">${trackLine(t)} &middot; ${bpmLabel(t)} &middot; energy ${t.energy}</div>
        </div>
      `;
      listEl.appendChild(row);
    });
  }

  // --- Editing an existing (not-yet-played) vinyl track's song/track # ---
  function renderVinylEditForm(mountEl, track, onDone) {
    mountEl.innerHTML = `
      <label>Artist</label>
      <input type="text" id="ve-artist" value="${track.artist || ''}" />
      <label>Vinyl / album title</label>
      <input type="text" id="ve-album" value="${track.album || ''}" />
      <div class="row">
        <input type="text" id="ve-title" placeholder="Song title" value="${track.title || ''}" />
        <input type="number" id="ve-tracknum" placeholder="Track #" style="flex:none;width:6rem;" value="${track.trackNumber ?? ''}" />
      </div>
      <button type="button" class="secondary" id="ve-lookup">Look up on Spotify</button>
      <div id="ve-lookup-results"></div>
      <label>Tempo (tap along to the beat) <span class="hint">— currently ${track.bpm ?? '?'} BPM</span></label>
      <div class="tempo-readout" id="ve-bpm-readout">${track.bpm ?? '--'} BPM</div>
      <div class="row">
        <button type="button" id="ve-tap">Tap</button>
        <input type="number" id="ve-bpm-manual" placeholder="or type BPM" value="${track.bpm ?? ''}" />
      </div>
      <div style="margin-top:0.5rem"><button type="button" id="ve-save">Save</button>
      <button type="button" class="secondary" id="ve-cancel">Cancel</button></div>
    `;
    let editedBpm = track.bpm ?? null;
    let bpmConfirmed = false; // true once the DJ actually tapped/typed a tempo this round
    const veTapTempo = createTapTempo((bpm) => {
      if (!bpm) return;
      editedBpm = bpm;
      bpmConfirmed = true;
      mountEl.querySelector('#ve-bpm-readout').textContent = `${bpm} BPM`;
      mountEl.querySelector('#ve-bpm-manual').value = bpm;
    });
    mountEl.querySelector('#ve-tap').addEventListener('click', () => veTapTempo.tap());
    mountEl.querySelector('#ve-bpm-manual').addEventListener('input', (e) => {
      editedBpm = e.target.value ? Number(e.target.value) : null;
      bpmConfirmed = true;
    });
    // Searches whatever is currently typed - not locked to the record
    // this slot started as, so this can swap to a completely different
    // song/artist, not just pick another track off the same record.
    mountEl.querySelector('#ve-lookup').addEventListener('click', async () => {
      const resultsEl = mountEl.querySelector('#ve-lookup-results');
      const liveArtist = mountEl.querySelector('#ve-artist').value.trim();
      const liveAlbum = mountEl.querySelector('#ve-album').value.trim();
      const liveTitle = mountEl.querySelector('#ve-title').value.trim();
      const q = `${liveArtist} ${liveTitle || liveAlbum}`.trim();
      if (!q) { resultsEl.innerHTML = '<p class="hint">Type an artist and song/album first.</p>'; return; }
      if (!isLoggedIn()) { resultsEl.innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>'; return; }
      resultsEl.innerHTML = '<p class="hint">Searching…</p>';
      try {
        const results = await searchTracks(q, 6);
        resultsEl.innerHTML = '';
        if (results.length === 0) { resultsEl.innerHTML = '<p class="hint">No match.</p>'; return; }
        results.forEach((r) => {
          const row = document.createElement('div');
          row.className = 'track-row';
          row.style.cursor = 'pointer';
          row.innerHTML = `
            ${r.albumArt ? `<img src="${r.albumArt}" />` : ''}
            <div class="track-meta">
              <div class="title">${r.title}</div>
              <div class="sub">${r.artist} &middot; ${r.album || ''}${r.trackNumber != null ? ` #${r.trackNumber}` : ''}</div>
            </div>
          `;
          row.addEventListener('click', () => {
            mountEl.querySelector('#ve-artist').value = r.artist;
            mountEl.querySelector('#ve-album').value = r.album || liveAlbum;
            mountEl.querySelector('#ve-title').value = r.title;
            mountEl.querySelector('#ve-tracknum').value = r.trackNumber ?? '';
            resultsEl.innerHTML = `<p class="hint">Picked: ${r.title} — ${r.artist}. Tap tempo, then Save.</p>`;
          });
          resultsEl.appendChild(row);
        });
      } catch (e) {
        resultsEl.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
      }
    });
    mountEl.querySelector('#ve-save').addEventListener('click', () => {
      const artist = mountEl.querySelector('#ve-artist').value.trim() || track.artist;
      const album = mountEl.querySelector('#ve-album').value.trim() || track.album;
      const title = mountEl.querySelector('#ve-title').value.trim() || "(DJ's choice)";
      const tn = mountEl.querySelector('#ve-tracknum').value.trim();
      const newBpm = editedBpm ?? track.bpm;
      const updated = Store.updateTrack(track.id, {
        artist,
        album,
        title,
        trackNumber: tn ? Number(tn) : null,
        bpm: newBpm,
        bpmEstimated: bpmConfirmed ? false : track.bpmEstimated,
      });
      // A changed tempo can change where this track belongs in the plan -
      // pull it out and re-insert at its new best slot rather than leaving
      // it wherever it happened to land under the old (often default) BPM.
      if (newBpm !== track.bpm && !track.played) {
        const withoutThis = Store.getPlanOrder().filter((id) => id !== track.id);
        const direction = getPlanDirection(Store.getSettings());
        const reordered = insertVinylTrack(updated, withoutThis, Store.getTracks(), direction);
        Store.savePlanOrder(reordered);
      }
      onDone();
    });
    mountEl.querySelector('#ve-cancel').addEventListener('click', onDone);
  }

  function renderVinylTurn(turnCard, snap) {
    const nv = snap.nextVinyl;
    if (!nv) {
      turnCard.innerHTML = `<h3>Next up: <span class="badge vinyl">VINYL</span></h3><p class="hint">No unplayed vinyl left in the plan — add one below.</p>`;
      return;
    }
    turnCard.innerHTML = `
      <h3>Next up: <span class="badge vinyl">VINYL</span> ${nv.guestRequested ? '<span class="badge guest">guest</span>' : ''}</h3>
      <div class="track-row">
        ${nv.spotifyArt ? `<img src="${nv.spotifyArt}" />` : ''}
        <div class="track-meta">
          <div class="title">${nv.artist}</div>
          <div class="sub">${trackLine(nv)} &middot; ${nv.bpm ?? '?'} BPM &middot; energy ${nv.energy}
            ${nv.flavorTags.length ? `&middot; ${nv.flavorTags.join(', ')}` : ''}
          </div>
        </div>
      </div>
      <div class="row">
        <button type="button" id="mark-played-btn">Mark played</button>
        <button type="button" class="secondary" id="shuffle-vinyl-btn" title="Swap in a random other unplayed vinyl">&#128256; Shuffle</button>
        <button type="button" class="secondary" id="change-vinyl-btn">Change track</button>
      </div>
      <div id="change-vinyl-mount" style="margin-top:0.6rem"></div>
    `;
    turnCard.querySelector('#mark-played-btn').addEventListener('click', () => {
      markPlayed(nv.id);
      refreshTurn();
    });
    turnCard.querySelector('#shuffle-vinyl-btn').addEventListener('click', () => shuffleVinylSlot(nv.id));
    turnCard.querySelector('#change-vinyl-btn').addEventListener('click', () => {
      const mount = turnCard.querySelector('#change-vinyl-mount');
      renderVinylEditForm(mount, nv, () => refreshTurn());
    });
  }

  // --- The single active Spotify bridge turn ("Next up") ---
  // Mirrors renderVinylTurn's layout on purpose: a track-row, then a
  // .row of [primary action, secondary "Change"], then a mount point -
  // same shape as vinyl's [Mark played, Change track] + change-vinyl-mount.
  function renderSpotifyTurn(turnCard, snap) {
    const afterVinylId = snap.lastPlayed?.id;
    const bt = snap.bridgeTarget;
    const bpmText = bt.bpmRange ? `${Math.round(bt.bpmRange[0])}–${Math.round(bt.bpmRange[1])} BPM` : 'no BPM target yet';
    const autoQuery = buildAutoQuery(bt);
    turnCard.innerHTML = `
      <h3>Next up: <span class="badge spotify">SPOTIFY</span> (bridge)</h3>
      <div class="bridge-target">
        <div><strong>Target:</strong> ${bpmText} &middot; energy ~${bt.energyTarget}/5</div>
        ${bt.flavorHint.length ? `<div class="hint">Flavor: ${bt.flavorHint.join(', ')}</div>` : ''}
        <p class="hint">Spotify's own recommendation engine is blocked for new developer apps
          (locked down Nov 2024) — this auto-picks the top match from the target above, not a true ML pick.</p>
      </div>
      <div id="spotify-suggestion-row"></div>
      <div class="row" id="spotify-action-row" style="display:none;">
        <button type="button" id="spotify-play-suggestion">Play this</button>
        <button type="button" class="secondary" id="spotify-shuffle-btn" title="Get a different suggestion">&#128256; Shuffle</button>
        <button type="button" class="secondary" id="spotify-change-btn">Change</button>
      </div>
      <div id="spotify-search-mount" style="margin-top:0.6rem"></div>
    `;

    function playResult(r) {
      const track = {
        id: newId(),
        title: r.title,
        artist: r.artist,
        album: r.album || null,
        trackNumber: r.trackNumber ?? null,
        source: 'spotify',
        bpm: null,
        energy: bt.energyTarget,
        flavorTags: bt.flavorHint,
        guestRequested: false,
        played: true,
        playedAt: Date.now(),
        addedAt: Date.now(),
        spotifyArt: r.albumArt,
        spotifyUri: r.uri,
      };
      Store.addTrack(track);
      if (afterVinylId) Store.clearPlannedSpotifyFor(afterVinylId);
      refreshTurn();
    }

    function renderSuggestion(r) {
      const rowEl = turnCard.querySelector('#spotify-suggestion-row');
      const actionRow = turnCard.querySelector('#spotify-action-row');
      if (!r) {
        rowEl.innerHTML = '<p class="hint">No auto-match found — use Change to search.</p>';
        actionRow.style.display = 'flex';
        turnCard.querySelector('#spotify-play-suggestion').style.display = 'none';
        return;
      }
      rowEl.innerHTML = `
        <div class="track-row">
          ${r.albumArt ? `<img src="${r.albumArt}" />` : ''}
          <div class="track-meta">
            <div class="title">${r.title}</div>
            <div class="sub">${r.artist} &middot; ${r.album || ''}${r.trackNumber != null ? ` #${r.trackNumber}` : ''}
              ${r.fromPlaylist ? ' &middot; <span style="color:var(--accent2)">from your playlist</span>' : ' &middot; new'}
            </div>
          </div>
        </div>
      `;
      actionRow.style.display = 'flex';
      const playBtn = turnCard.querySelector('#spotify-play-suggestion');
      playBtn.style.display = '';
      playBtn.onclick = () => playResult(r);
    }

    turnCard.querySelector('#spotify-shuffle-btn').addEventListener('click', async () => {
      const rowEl = turnCard.querySelector('#spotify-suggestion-row');
      rowEl.innerHTML = '<p class="hint">Shuffling…</p>';
      const pick = await pickSpotifyCandidate(autoQuery, playedSpotifyUris());
      if (afterVinylId && pick) Store.setPlannedSpotifyFor(afterVinylId, pick);
      renderSuggestion(pick);
    });

    function resultRow(r, onPick) {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        ${r.albumArt ? `<img src="${r.albumArt}" />` : ''}
        <div class="track-meta">
          <div class="title">${r.title}</div>
          <div class="sub">${r.artist} &middot; ${r.album || ''}${r.trackNumber != null ? ` #${r.trackNumber}` : ''}</div>
        </div>
        <button type="button" class="secondary">Play this</button>
      `;
      row.querySelector('button').addEventListener('click', () => onPick(r));
      return row;
    }

    function renderSearchUI() {
      const mount = turnCard.querySelector('#spotify-search-mount');
      mount.innerHTML = `
        <label>Search Spotify</label>
        <div class="row">
          <input type="text" id="spotify-search-input" value="${autoQuery}" />
          <button type="button" id="spotify-search-btn">Search</button>
        </div>
        <div id="spotify-search-results"></div>
      `;
      async function doSearch() {
        const q = mount.querySelector('#spotify-search-input').value.trim();
        const resultsEl = mount.querySelector('#spotify-search-results');
        if (!q) return;
        if (!isLoggedIn()) { resultsEl.innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>'; return; }
        resultsEl.innerHTML = '<p class="hint">Searching…</p>';
        try {
          const results = await searchTracks(q, 8);
          resultsEl.innerHTML = '';
          results.forEach((r) => resultsEl.appendChild(resultRow(r, playResult)));
          if (results.length === 0) resultsEl.innerHTML = '<p class="hint">No results — try editing the search above.</p>';
        } catch (e) {
          resultsEl.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
        }
      }
      mount.querySelector('#spotify-search-btn').addEventListener('click', doSearch);
      mount.querySelector('#spotify-search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
      });
      doSearch();
    }

    turnCard.querySelector('#spotify-change-btn').addEventListener('click', renderSearchUI);

    if (!isLoggedIn()) {
      turnCard.querySelector('#spotify-suggestion-row').innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>';
      turnCard.querySelector('#spotify-action-row').style.display = 'flex';
      turnCard.querySelector('#spotify-play-suggestion').style.display = 'none';
      return;
    }

    // Reuse a planned pick from the Full Set preview if one exists, so the
    // suggestion here matches what was already shown/chosen below — only
    // fall back to a fresh auto-search if nothing was planned yet.
    const planned = afterVinylId ? Store.getPlannedSpotifyFor(afterVinylId) : null;
    turnCard.querySelector('#spotify-suggestion-row').innerHTML = planned ? '' : '<p class="hint">Finding a match…</p>';
    if (planned) {
      renderSuggestion(planned);
    } else if (afterVinylId) {
      pickSpotifyCandidate(autoQuery, playedSpotifyUris()).then((pick) => {
        if (pick) Store.setPlannedSpotifyFor(afterVinylId, pick);
        renderSuggestion(pick);
      }).catch(() => renderSuggestion(null));
    } else {
      renderSuggestion(null);
    }
  }

  // --- Full set list: history + upcoming plan, with per-row "Change" ---
  function renderFullList(snap) {
    const listEl = container.querySelector('#full-list');
    const played = snap.tracks
      .filter((t) => t.playedAt)
      .sort((a, b) => a.playedAt - b.playedAt);
    const unplayedVinyl = snap.planOrder
      .map((id) => snap.tracks.find((t) => t.id === id))
      .filter((t) => t && !t.played);

    // Build the future sequence: [spotify-gap?] vinyl [spotify-gap] vinyl ...
    // Each spotify-gap knows the vinyl before it (afterVinylId) and after
    // it (for the bridge target), so a fresh gap can be auto-suggested.
    const future = [];
    let prevVinyl = snap.turn === 'spotify' ? snap.lastPlayed : null;
    if (snap.turn === 'spotify') {
      future.push({ kind: 'spotify-gap', afterVinylId: prevVinyl?.id, leftVinyl: prevVinyl, rightVinyl: unplayedVinyl[0] || null });
    }
    unplayedVinyl.forEach((t, idx) => {
      future.push({ kind: 'vinyl', track: t });
      future.push({ kind: 'spotify-gap', afterVinylId: t.id, leftVinyl: t, rightVinyl: unplayedVinyl[idx + 1] || null });
    });
    if (future.length) future[0].upNow = true;

    listEl.innerHTML = '';
    let spotifyGapCount = 0; // counts only spotify-gap entries, not vinyl rows
    let fetchChain = Promise.resolve(); // serializes lookahead Spotify calls

    function makeRow() {
      const row = document.createElement('div');
      row.className = 'track-row';
      return row;
    }

    // --- Drag-to-reorder for upcoming vinyl rows (pointer events, so it
    // works on touch as well as mouse). Only the not-yet-played vinyl
    // rows are draggable - reordering history or Spotify placeholders
    // doesn't mean anything.
    let dragId = null;
    let dragRow = null;

    function vinylRowEls() {
      return Array.from(listEl.querySelectorAll('.track-row[data-vinyl-id]'));
    }

    function rowUnder(clientY) {
      return vinylRowEls().find((r) => {
        const rect = r.getBoundingClientRect();
        return clientY >= rect.top && clientY <= rect.bottom;
      });
    }

    function reorderVinyl(draggedId, targetId) {
      if (draggedId === targetId) return;
      const planOrder = Store.getPlanOrder();
      const fromIdx = planOrder.indexOf(draggedId);
      if (fromIdx === -1) return;
      const newOrder = planOrder.slice();
      newOrder.splice(fromIdx, 1);
      const toIdx = newOrder.indexOf(targetId);
      if (toIdx === -1) return;
      newOrder.splice(toIdx, 0, draggedId);
      Store.savePlanOrder(newOrder);
      refreshTurn();
    }

    // Guaranteed-to-work fallback for the drag (touch/pointer drag can be
    // finicky depending on browser/device) - swaps this vinyl with its
    // upcoming neighbor in the same direction.
    function moveVinyl(id, delta) {
      const planOrder = Store.getPlanOrder();
      const idx = planOrder.indexOf(id);
      const swapWith = idx + delta;
      if (idx === -1 || swapWith < 0 || swapWith >= planOrder.length) return;
      const tracksById = new Map(snap.tracks.map((t) => [t.id, t]));
      const other = tracksById.get(planOrder[swapWith]);
      if (other?.played) return; // never swap into the already-played history
      const newOrder = planOrder.slice();
      [newOrder[idx], newOrder[swapWith]] = [newOrder[swapWith], newOrder[idx]];
      Store.savePlanOrder(newOrder);
      refreshTurn();
    }

    function onDragMove(e) {
      if (!dragId) return;
      vinylRowEls().forEach((r) => r.classList.remove('drag-over'));
      const target = rowUnder(e.clientY);
      if (target && target.dataset.vinylId !== dragId) target.classList.add('drag-over');
    }

    function onDragEnd(e) {
      if (!dragId) return;
      const target = rowUnder(e.clientY);
      if (dragRow) dragRow.style.opacity = '';
      vinylRowEls().forEach((r) => r.classList.remove('drag-over'));
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
      const draggedId = dragId;
      dragId = null;
      dragRow = null;
      if (target && target.dataset.vinylId !== draggedId) reorderVinyl(draggedId, target.dataset.vinylId);
    }

    function makeDragHandle(id, row) {
      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture?.(e.pointerId);
        dragId = id;
        dragRow = row;
        row.style.opacity = '0.4';
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', onDragEnd);
      });
      return handle;
    }

    played.forEach((t) => {
      const row = makeRow();
      row.style.opacity = '0.6';
      row.innerHTML = `
        <span class="badge ${t.source}">${t.source.toUpperCase()}</span>
        ${t.guestRequested ? '<span class="badge guest">guest</span>' : ''}
        <div class="track-meta">
          <div class="title">${t.artist}</div>
          <div class="sub">${trackLine(t)} &middot; played</div>
        </div>
      `;
      listEl.appendChild(row);
    });

    future.forEach((entry) => {
      if (entry.kind === 'vinyl') {
        const t = entry.track;
        const row = makeRow();
        row.dataset.vinylId = t.id;
        if (entry.upNow) row.style.background = 'var(--accent-soft)';
        row.innerHTML = `
          <span class="badge vinyl">VINYL</span>
          ${t.guestRequested ? '<span class="badge guest">guest</span>' : ''}
          <div class="track-meta">
            <div class="title">${t.artist}</div>
            <div class="sub">${trackLine(t)} &middot; ${bpmLabel(t)}</div>
          </div>
        `;
        row.prepend(makeDragHandle(t.id, row));
        // Up/down buttons are a guaranteed-to-work fallback for reordering
        // if a drag doesn't register cleanly on a given device/browser.
        const moveWrap = document.createElement('span');
        moveWrap.style.display = 'flex';
        moveWrap.style.flexDirection = 'column';
        moveWrap.style.flex = 'none';
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'secondary';
        upBtn.textContent = '▲';
        upBtn.style.padding = '0.1rem 0.4rem';
        upBtn.style.fontSize = '0.7rem';
        upBtn.addEventListener('click', () => moveVinyl(t.id, -1));
        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'secondary';
        downBtn.textContent = '▼';
        downBtn.style.padding = '0.1rem 0.4rem';
        downBtn.style.fontSize = '0.7rem';
        downBtn.style.marginTop = '0.2rem';
        downBtn.addEventListener('click', () => moveVinyl(t.id, 1));
        moveWrap.appendChild(upBtn);
        moveWrap.appendChild(downBtn);
        row.insertBefore(moveWrap, row.querySelector('.track-meta'));
        const shuffleBtn = document.createElement('button');
        shuffleBtn.type = 'button';
        shuffleBtn.className = 'secondary';
        shuffleBtn.title = 'Swap in a random other unplayed vinyl';
        shuffleBtn.textContent = '\u{1F500}';
        shuffleBtn.addEventListener('click', () => shuffleVinylSlot(t.id));
        row.appendChild(shuffleBtn);
        const changeBtn = document.createElement('button');
        changeBtn.type = 'button';
        changeBtn.className = 'secondary';
        changeBtn.textContent = 'Change';
        changeBtn.addEventListener('click', () => {
          const mount = document.createElement('div');
          mount.style.width = '100%';
          renderVinylEditForm(mount, t, () => refreshTurn());
          row.replaceWith(mount);
        });
        row.appendChild(changeBtn);
        listEl.appendChild(row);
        return;
      }

      // spotify-gap
      const row = makeRow();
      if (entry.upNow) row.style.background = 'var(--accent-soft)';
      const planned = entry.afterVinylId ? Store.getPlannedSpotifyFor(entry.afterVinylId) : null;

      function fillRow(pick, { loading = false, errorMsg = null } = {}) {
        const placeholder = loading ? 'TBD — finding a match…' : 'TBD — no auto-match, tap Change to search';
        const sourceTag = pick
          ? (pick.fromPlaylist ? ' &middot; <span style="color:var(--accent2)">from your playlist</span>' : ' &middot; new')
          : '';
        row.innerHTML = `
          <span class="badge spotify">SPOTIFY</span>
          <div class="track-meta">
            <div class="title">${pick ? pick.title : placeholder}</div>
            <div class="sub">${pick ? `${pick.artist}${pick.album ? ` &middot; ${pick.album}` : ''}` : (errorMsg || '')}${sourceTag}${entry.upNow ? ' (bridging next, see above)' : ''}</div>
          </div>
        `;
        const shuffleBtn = document.createElement('button');
        shuffleBtn.type = 'button';
        shuffleBtn.className = 'secondary';
        shuffleBtn.title = 'Get a different suggestion';
        shuffleBtn.textContent = '\u{1F500}';
        shuffleBtn.addEventListener('click', async () => {
          if (!entry.afterVinylId) return;
          shuffleBtn.disabled = true;
          const bt2 = getBridgeTarget(entry.leftVinyl, entry.rightVinyl, Store.getSettings());
          const newPick = await pickSpotifyCandidate(buildAutoQuery(bt2), playedSpotifyUris());
          if (newPick) Store.setPlannedSpotifyFor(entry.afterVinylId, newPick);
          fillRow(newPick);
        });
        row.appendChild(shuffleBtn);
        const changeBtn = document.createElement('button');
        changeBtn.type = 'button';
        changeBtn.className = 'secondary';
        changeBtn.textContent = 'Change';
        changeBtn.addEventListener('click', () => renderGapChangeForm());
        row.appendChild(changeBtn);
      }

      function renderGapChangeForm() {
        const bt = getBridgeTarget(entry.leftVinyl, entry.rightVinyl, Store.getSettings());
        const q = buildAutoQuery(bt);
        const mount = document.createElement('div');
        mount.style.width = '100%';
        mount.innerHTML = `
          <div class="row">
            <input type="text" id="gap-search-input" value="${q}" />
            <button type="button" id="gap-search-btn">Search</button>
          </div>
          <div id="gap-search-results"></div>
        `;
        row.replaceWith(mount);
        async function doGapSearch() {
          const query = mount.querySelector('#gap-search-input').value.trim();
          const resultsEl = mount.querySelector('#gap-search-results');
          if (!query) return;
          if (!isLoggedIn()) { resultsEl.innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>'; return; }
          resultsEl.innerHTML = '<p class="hint">Searching…</p>';
          try {
            const results = await searchTracks(query, 8);
            resultsEl.innerHTML = '';
            results.forEach((r) => {
              const rRow = document.createElement('div');
              rRow.className = 'track-row';
              rRow.style.cursor = 'pointer';
              rRow.innerHTML = `
                ${r.albumArt ? `<img src="${r.albumArt}" />` : ''}
                <div class="track-meta">
                  <div class="title">${r.title}</div>
                  <div class="sub">${r.artist} &middot; ${r.album || ''}</div>
                </div>
              `;
              rRow.addEventListener('click', () => {
                Store.setPlannedSpotifyFor(entry.afterVinylId, r);
                refreshTurn();
              });
              resultsEl.appendChild(rRow);
            });
          } catch (e) {
            resultsEl.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
          }
        }
        mount.querySelector('#gap-search-btn').addEventListener('click', doGapSearch);
        doGapSearch();
      }

      // Bug fix: this used to be future.indexOf(entry) - an index into the
      // full vinyl+gap interleaved array (0, 2, 4, 6...), so it undercounted
      // which gaps actually qualified as "within the lookahead window" and
      // silently skipped fetching for the 2nd+ gap onward.
      const gapIndex = spotifyGapCount++;
      if (planned) {
        fillRow(planned);
      } else {
        const willAutoFetch = gapIndex < LOOKAHEAD_GAPS && isLoggedIn() && entry.afterVinylId;
        fillRow(null, { loading: willAutoFetch }); // always shows a Change button, even pre-login
        if (willAutoFetch) {
          // Chained rather than fired concurrently: parallel Spotify calls
          // right after a fresh page load can race on token refresh/rate
          // limits, which was intermittently starving every gap after the
          // first even once the indexing above is correct.
          fetchChain = fetchChain.then(async () => {
            const bt2 = getBridgeTarget(entry.leftVinyl, entry.rightVinyl, Store.getSettings());
            const query = buildAutoQuery(bt2);
            try {
              const pick = await pickSpotifyCandidate(query, playedSpotifyUris());
              if (pick) {
                Store.setPlannedSpotifyFor(entry.afterVinylId, pick);
                fillRow(pick);
              } else {
                fillRow(null, { errorMsg: `0 results for "${query}"` });
              }
            } catch (e) {
              console.warn('Bridge auto-search failed for gap', entry.afterVinylId, e);
              fillRow(null, { errorMsg: e.message });
            }
          });
        }
      }
      listEl.appendChild(row);
    });

    if (played.length === 0 && future.length === 0) {
      listEl.innerHTML = '<p class="hint">Nothing in the plan yet — add vinyls in Crate Builder or below.</p>';
    }
  }

  function refreshTurn() {
    refreshLever();
    const snap = computeLiveSnapshot();
    const turnCard = container.querySelector('#turn-card');
    if (snap.turn === 'vinyl') renderVinylTurn(turnCard, snap);
    else renderSpotifyTurn(turnCard, snap);
    renderGuestCrate();
    renderFullList(snap);
  }

  const toggleBtn = container.querySelector('#toggle-guest-form');
  const guestFormEl = container.querySelector('#guest-form');
  let guestFormShown = false;
  let guestFormIdleTimer = null;

  function closeGuestForm() {
    clearTimeout(guestFormIdleTimer);
    guestFormShown = false;
    guestFormEl.innerHTML = '';
  }

  // Reclaims the space automatically after a stretch of no interaction,
  // since guest vinyls tend to arrive in a burst and get left open
  // afterward otherwise - reset on any input/click inside the form so a
  // run of quick adds doesn't get cut off mid-way.
  function scheduleGuestFormAutoClose() {
    clearTimeout(guestFormIdleTimer);
    guestFormIdleTimer = setTimeout(closeGuestForm, 10000);
  }
  guestFormEl.addEventListener('input', () => { if (guestFormShown) scheduleGuestFormAutoClose(); });
  guestFormEl.addEventListener('click', () => { if (guestFormShown) scheduleGuestFormAutoClose(); });

  toggleBtn.addEventListener('click', () => {
    if (guestFormShown) {
      closeGuestForm();
      return;
    }
    guestFormShown = true;
    renderTrackForm(guestFormEl, {
      source: 'vinyl',
      guestRequested: true,
      title: "Guest's vinyl request",
      onSave: (track) => {
        const direction = getPlanDirection(Store.getSettings());
        const newOrder = insertVinylTrack(track, Store.getPlanOrder(), Store.getTracks(), direction);
        Store.savePlanOrder(newOrder);
        refreshTurn();
      },
    });
    scheduleGuestFormAutoClose();
  });

  const saveSetToggleBtn = container.querySelector('#toggle-save-set');
  const saveSetFormEl = container.querySelector('#save-set-form');
  let saveSetFormShown = false;
  saveSetToggleBtn.addEventListener('click', () => {
    if (saveSetFormShown) {
      saveSetFormShown = false;
      saveSetFormEl.innerHTML = '';
      return;
    }
    saveSetFormShown = true;
    const defaultName = `Set — ${new Date().toLocaleDateString()}`;
    saveSetFormEl.innerHTML = `
      <input type="text" id="ss-name" value="${defaultName}" />
      <div class="row" style="margin-top:0.4rem;">
        <button type="button" id="ss-save">Save</button>
        <button type="button" class="secondary" id="ss-cancel">Cancel</button>
      </div>
      <p class="hint" id="ss-status"></p>
    `;
    saveSetFormEl.querySelector('#ss-cancel').addEventListener('click', () => {
      saveSetFormShown = false;
      saveSetFormEl.innerHTML = '';
    });
    saveSetFormEl.querySelector('#ss-save').addEventListener('click', () => {
      const name = saveSetFormEl.querySelector('#ss-name').value;
      const set = saveCurrentSet(name);
      saveSetFormEl.innerHTML = `<p class="hint">Saved as "${set.name}". See it any time under Settings → Saved sets.</p>`;
      saveSetFormShown = false;
    });
  });

  refreshLever();
  refreshTurn();
}
