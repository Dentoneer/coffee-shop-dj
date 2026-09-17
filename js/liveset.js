import { Store, newId } from './store.js?v=20260917j';
import { computeLiveSnapshot, markPlayed, insertVinylTrack, getBridgeTarget, getPlanDirection } from './plan.js?v=20260917j';
import { renderTrackForm } from './trackForm.js?v=20260917j';
import { searchTracks, searchAlbums, getAlbumTracks, isLoggedIn } from './spotify.js?v=20260917j';
import { createTapTempo } from './tapTempo.js?v=20260917j';

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
    <div class="card">
      <h3>Mood lever <span id="lever-value"></span></h3>
      <input type="range" id="lever-slider" min="1" max="5" step="0.1" />
      <div class="row">
        <label style="margin:0;flex:none;">
          <input type="checkbox" id="lever-autodrift" /> Auto-drift
        </label>
        <button type="button" class="secondary" id="lever-start-set">Start set now</button>
      </div>
      <p class="hint" id="lever-hint"></p>
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
      ? `Set started ${new Date(settings.setStartedAt).toLocaleTimeString()} · drifts ${settings.leverStart} → ${settings.leverEnd} over ${settings.setDurationMinutes}min`
      : 'Set not started — lever stays fixed until you hit "Start set now".';
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
      <div class="row">
        <input type="text" id="ve-title" placeholder="Song title" value="${track.title || ''}" />
        <input type="number" id="ve-tracknum" placeholder="Track #" style="flex:none;width:6rem;" value="${track.trackNumber ?? ''}" />
      </div>
      <button type="button" class="secondary" id="ve-lookup">Look up ${track.album || 'album'} on Spotify</button>
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
    mountEl.querySelector('#ve-lookup').addEventListener('click', async () => {
      const resultsEl = mountEl.querySelector('#ve-lookup-results');
      if (!isLoggedIn()) { resultsEl.innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>'; return; }
      if (!track.album) { resultsEl.innerHTML = '<p class="hint">No album on file for this track.</p>'; return; }
      resultsEl.innerHTML = '<p class="hint">Searching…</p>';
      try {
        const albums = await searchAlbums(`${track.artist} ${track.album}`, 3);
        if (albums.length === 0) { resultsEl.innerHTML = '<p class="hint">No match.</p>'; return; }
        const tracks = await getAlbumTracks(albums[0].id);
        resultsEl.innerHTML = '';
        tracks.forEach((t) => {
          const row = document.createElement('div');
          row.className = 'track-row';
          row.style.cursor = 'pointer';
          row.innerHTML = `<div class="track-meta"><div class="title">${t.trackNumber != null ? `${t.trackNumber}. ` : ''}${t.title}</div></div>`;
          row.addEventListener('click', () => {
            mountEl.querySelector('#ve-title').value = t.title;
            mountEl.querySelector('#ve-tracknum').value = t.trackNumber ?? '';
          });
          resultsEl.appendChild(row);
        });
      } catch (e) {
        resultsEl.innerHTML = `<p class="hint">Lookup failed: ${e.message}</p>`;
      }
    });
    mountEl.querySelector('#ve-save').addEventListener('click', () => {
      const title = mountEl.querySelector('#ve-title').value.trim() || "(DJ's choice)";
      const tn = mountEl.querySelector('#ve-tracknum').value.trim();
      const newBpm = editedBpm ?? track.bpm;
      const updated = Store.updateTrack(track.id, {
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
        <button type="button" class="secondary" id="change-vinyl-btn">Change track</button>
      </div>
      <div id="change-vinyl-mount" style="margin-top:0.6rem"></div>
    `;
    turnCard.querySelector('#mark-played-btn').addEventListener('click', () => {
      markPlayed(nv.id);
      refreshTurn();
    });
    turnCard.querySelector('#change-vinyl-btn').addEventListener('click', () => {
      const mount = turnCard.querySelector('#change-vinyl-mount');
      renderVinylEditForm(mount, nv, () => refreshTurn());
    });
  }

  // --- The single active Spotify bridge turn ("Next up") ---
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
      <div id="spotify-suggestion"></div>
      <details id="spotify-change-details" style="margin-top:0.6rem">
        <summary class="hint" style="cursor:pointer">Don't like it? Search for something else</summary>
        <div class="row" style="margin-top:0.5rem">
          <input type="text" id="spotify-search-input" value="${autoQuery}" />
          <button type="button" id="spotify-search-btn">Search</button>
        </div>
        <div id="spotify-search-results"></div>
      </details>
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
      const suggestionEl = turnCard.querySelector('#spotify-suggestion');
      if (!r) {
        suggestionEl.innerHTML = '<p class="hint">No auto-match found — use the search below.</p>';
        return;
      }
      suggestionEl.innerHTML = `
        <label>Suggested next</label>
        <div class="track-row">
          ${r.albumArt ? `<img src="${r.albumArt}" />` : ''}
          <div class="track-meta">
            <div class="title">${r.title}</div>
            <div class="sub">${r.artist} &middot; ${r.album || ''}${r.trackNumber != null ? ` #${r.trackNumber}` : ''}</div>
          </div>
        </div>
        <button type="button" id="spotify-play-suggestion">Play this</button>
      `;
      suggestionEl.querySelector('#spotify-play-suggestion').addEventListener('click', () => playResult(r));
    }

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

    async function doSearch({ intoSuggestion } = {}) {
      const q = turnCard.querySelector('#spotify-search-input').value.trim();
      const resultsEl = turnCard.querySelector('#spotify-search-results');
      if (!q) return;
      if (!isLoggedIn()) {
        turnCard.querySelector('#spotify-suggestion').innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>';
        return;
      }
      if (!intoSuggestion) resultsEl.innerHTML = '<p class="hint">Searching…</p>';
      try {
        const results = await searchTracks(q, 8);
        if (intoSuggestion) {
          if (afterVinylId && results[0]) Store.setPlannedSpotifyFor(afterVinylId, results[0]);
          renderSuggestion(results[0] || null);
          resultsEl.innerHTML = '';
          results.slice(1).forEach((r) => resultsEl.appendChild(resultRow(r, playResult)));
          return;
        }
        resultsEl.innerHTML = '';
        results.forEach((r) => resultsEl.appendChild(resultRow(r, playResult)));
        if (results.length === 0) resultsEl.innerHTML = '<p class="hint">No results — try editing the search above.</p>';
      } catch (e) {
        const target = intoSuggestion ? turnCard.querySelector('#spotify-suggestion') : resultsEl;
        target.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
      }
    }

    turnCard.querySelector('#spotify-search-btn').addEventListener('click', () => doSearch());
    turnCard.querySelector('#spotify-search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });

    if (!isLoggedIn()) {
      turnCard.querySelector('#spotify-suggestion').innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>';
      return;
    }

    // Reuse a planned pick from the Full Set preview if one exists, so the
    // suggestion here matches what was already shown/chosen below — only
    // fall back to a fresh auto-search if nothing was planned yet.
    const planned = afterVinylId ? Store.getPlannedSpotifyFor(afterVinylId) : null;
    if (planned) renderSuggestion(planned);
    else doSearch({ intoSuggestion: true });
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
        if (entry.upNow) row.style.background = 'var(--accent-soft)';
        row.innerHTML = `
          <span class="badge vinyl">VINYL</span>
          ${t.guestRequested ? '<span class="badge guest">guest</span>' : ''}
          <div class="track-meta">
            <div class="title">${t.artist}</div>
            <div class="sub">${trackLine(t)} &middot; ${bpmLabel(t)}</div>
          </div>
        `;
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
        row.innerHTML = `
          <span class="badge spotify">SPOTIFY</span>
          <div class="track-meta">
            <div class="title">${pick ? pick.title : placeholder}</div>
            <div class="sub">${pick ? `${pick.artist}${pick.album ? ` &middot; ${pick.album}` : ''}` : (errorMsg || '')}${entry.upNow ? ' (bridging next, see above)' : ''}</div>
          </div>
        `;
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
              const results = await searchTracks(query, 1);
              const pick = results[0] || null;
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
  toggleBtn.addEventListener('click', () => {
    guestFormShown = !guestFormShown;
    if (guestFormShown) {
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
    } else {
      guestFormEl.innerHTML = '';
    }
  });

  refreshLever();
  refreshTurn();
}
