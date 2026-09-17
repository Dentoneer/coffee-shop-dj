import { Store, newId } from './store.js';
import { computeLiveSnapshot, markPlayed, insertVinylTrack } from './plan.js';
import { renderTrackForm } from './trackForm.js';
import { searchTracks, isLoggedIn } from './spotify.js';

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
      <p class="hint">Played so far, then the upcoming plan (Spotify bridge slots show "TBD" until you pick one).</p>
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
          <div class="sub">${trackLine(t)} &middot; ${t.bpm ?? '?'} BPM &middot; energy ${t.energy}</div>
        </div>
      `;
      listEl.appendChild(row);
    });
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
      <button type="button" id="mark-played-btn">Mark played</button>
    `;
    turnCard.querySelector('#mark-played-btn').addEventListener('click', () => {
      markPlayed(nv.id);
      refreshTurn();
    });
  }

  function renderSpotifyTurn(turnCard, snap) {
    const bt = snap.bridgeTarget;
    const bpmText = bt.bpmRange ? `${Math.round(bt.bpmRange[0])}–${Math.round(bt.bpmRange[1])} BPM` : 'no BPM target yet';
    const autoQuery = buildAutoQuery(bt);
    turnCard.innerHTML = `
      <h3>Next up: <span class="badge spotify">SPOTIFY</span> (bridge)</h3>
      <div class="bridge-target">
        <div><strong>Target:</strong> ${bpmText} &middot; energy ~${bt.energyTarget}/5</div>
        ${bt.flavorHint.length ? `<div class="hint">Flavor: ${bt.flavorHint.join(', ')}</div>` : ''}
        <p class="hint">Spotify's own recommendation engine is blocked for new developer apps
          (locked down Nov 2024) — these are auto-searched from the target above, not true ML picks.</p>
      </div>
      <label>Search Spotify</label>
      <div class="row">
        <input type="text" id="spotify-search-input" value="${autoQuery}" />
        <button type="button" id="spotify-search-btn">Search</button>
      </div>
      <div id="spotify-search-results"></div>
    `;

    function pickResult(r) {
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
      refreshTurn();
    }

    async function doSearch() {
      const q = turnCard.querySelector('#spotify-search-input').value.trim();
      const resultsEl = turnCard.querySelector('#spotify-search-results');
      if (!q) return;
      if (!isLoggedIn()) { resultsEl.innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>'; return; }
      resultsEl.innerHTML = '<p class="hint">Searching…</p>';
      try {
        const results = await searchTracks(q, 8);
        resultsEl.innerHTML = '';
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
            <button type="button" class="secondary">Play this</button>
          `;
          row.querySelector('button').addEventListener('click', () => pickResult(r));
          resultsEl.appendChild(row);
        });
        if (results.length === 0) resultsEl.innerHTML = '<p class="hint">No results — try editing the search above.</p>';
      } catch (e) {
        resultsEl.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
      }
    }
    turnCard.querySelector('#spotify-search-btn').addEventListener('click', doSearch);
    turnCard.querySelector('#spotify-search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });

    // Auto-run so the DJ sees picks immediately without typing anything.
    if (isLoggedIn()) doSearch();
  }

  function renderFullList(snap) {
    const listEl = container.querySelector('#full-list');
    const played = snap.tracks
      .filter((t) => t.playedAt)
      .sort((a, b) => a.playedAt - b.playedAt);
    const unplayedVinyl = snap.planOrder
      .map((id) => snap.tracks.find((t) => t.id === id))
      .filter((t) => t && !t.played);

    const future = [];
    if (snap.turn === 'spotify') future.push({ kind: 'spotify-tbd' });
    unplayedVinyl.forEach((t) => {
      future.push({ kind: 'vinyl', track: t });
      future.push({ kind: 'spotify-tbd' });
    });
    if (future.length) future[0].upNow = true;

    listEl.innerHTML = '';

    function addRow({ badgeClass, badgeText, guest, line1, line2, muted, highlight }) {
      const row = document.createElement('div');
      row.className = 'track-row';
      if (highlight) row.style.background = 'var(--accent-soft)';
      if (muted) row.style.opacity = '0.6';
      row.innerHTML = `
        <span class="badge ${badgeClass}">${badgeText}</span>
        ${guest ? '<span class="badge guest">guest</span>' : ''}
        <div class="track-meta">
          <div class="title">${line1}</div>
          ${line2 ? `<div class="sub">${line2}</div>` : ''}
        </div>
      `;
      listEl.appendChild(row);
    }

    played.forEach((t) => {
      addRow({
        badgeClass: t.source,
        badgeText: t.source.toUpperCase(),
        guest: t.guestRequested,
        line1: t.artist,
        line2: `${trackLine(t)} &middot; played`,
        muted: true,
      });
    });

    future.forEach((row) => {
      if (row.kind === 'spotify-tbd') {
        addRow({
          badgeClass: 'spotify',
          badgeText: 'SPOTIFY',
          line1: 'TBD — chosen live',
          line2: row.upNow ? 'bridging next, see above' : null,
          highlight: row.upNow,
        });
      } else {
        const t = row.track;
        addRow({
          badgeClass: 'vinyl',
          badgeText: 'VINYL',
          guest: t.guestRequested,
          line1: t.artist,
          line2: trackLine(t),
          highlight: row.upNow,
        });
      }
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
          const newOrder = insertVinylTrack(track, Store.getPlanOrder(), Store.getTracks());
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
