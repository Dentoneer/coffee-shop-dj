import { Store } from './store.js';
import { computeLiveSnapshot, markPlayed, insertVinylTrack } from './plan.js';
import { renderTrackForm } from './trackForm.js';
import { searchTracks, isLoggedIn } from './spotify.js';
import { newId } from './store.js';

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
          <div class="title">${nv.title}</div>
          <div class="sub">${nv.artist} &middot; ${nv.bpm ?? '?'} BPM &middot; energy ${nv.energy}
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
    turnCard.innerHTML = `
      <h3>Next up: <span class="badge spotify">SPOTIFY</span> (bridge)</h3>
      <div class="bridge-target">
        <div><strong>Target:</strong> ${bpmText} &middot; energy ~${bt.energyTarget}/5</div>
        ${bt.flavorHint.length ? `<div class="hint">Flavor: ${bt.flavorHint.join(', ')}</div>` : ''}
      </div>
      <label>Search Spotify</label>
      <div class="row">
        <input type="text" id="spotify-search-input" placeholder="artist or song" />
        <button type="button" id="spotify-search-btn">Search</button>
      </div>
      <div id="spotify-search-results"></div>
    `;

    function pickResult(r) {
      const track = {
        id: newId(),
        title: r.title,
        artist: r.artist,
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
              <div class="sub">${r.artist}</div>
            </div>
            <button type="button" class="secondary">Play this</button>
          `;
          row.querySelector('button').addEventListener('click', () => pickResult(r));
          resultsEl.appendChild(row);
        });
      } catch (e) {
        resultsEl.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
      }
    }
    turnCard.querySelector('#spotify-search-btn').addEventListener('click', doSearch);
    turnCard.querySelector('#spotify-search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });
  }

  function refreshTurn() {
    refreshLever();
    const snap = computeLiveSnapshot();
    const turnCard = container.querySelector('#turn-card');
    if (snap.turn === 'vinyl') renderVinylTurn(turnCard, snap);
    else renderSpotifyTurn(turnCard, snap);
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
