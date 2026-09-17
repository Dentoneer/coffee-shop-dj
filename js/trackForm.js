// Shared "add a track" form: used by Crate Builder (owned vinyls) and by
// Live Set's "add guest vinyl" flow. Title/artist + optional Spotify search
// autofill, tap-tempo BPM, energy slider, flavor chips.

import { FLAVOR_TAGS, newId, Store } from './store.js';
import { createTapTempo } from './tapTempo.js';
import { searchTracks, searchAlbums, getAlbumFirstTrack, isLoggedIn } from './spotify.js';

/**
 * @param {HTMLElement} container
 * @param {object} opts
 *   source: 'vinyl' | 'spotify'
 *   guestRequested: boolean
 *   onSave: (track) => void
 *   title: string — heading text for the form card
 */
export function renderTrackForm(container, opts) {
  const { source, guestRequested = false, onSave, title } = opts;
  let selectedFlavors = new Set();
  let currentBpm = null;

  container.innerHTML = `
    <div class="card">
      <h3>${title}</h3>
      <label>Artist</label>
      <input type="text" id="tf-artist" placeholder="e.g. Bebel Gilberto" />
      ${source === 'vinyl' ? `
        <label>What do you have?</label>
        <div class="row">
          <label style="flex:none;margin:0;">
            <input type="radio" name="${container.id || 'tf'}-mode" id="tf-mode-song" value="song" checked /> Song title
          </label>
          <label style="flex:none;margin:0;">
            <input type="radio" name="${container.id || 'tf'}-mode" id="tf-mode-vinyl" value="vinyl" /> Just the vinyl (pick a song for me)
          </label>
        </div>
      ` : ''}
      <label id="tf-title-label">Title</label>
      <input type="text" id="tf-title" placeholder="e.g. Baby" />
      ${source === 'vinyl' ? `
        <button type="button" class="secondary" id="tf-spotify-lookup">Look up on Spotify</button>
        <div id="tf-spotify-results"></div>
      ` : ''}
      <label>Tempo (tap along to the beat)</label>
      <div class="tempo-readout" id="tf-bpm-readout">-- BPM</div>
      <div class="row">
        <button type="button" id="tf-tap">Tap</button>
        <button type="button" class="secondary" id="tf-tap-reset">Reset</button>
        <input type="number" id="tf-bpm-manual" placeholder="or type BPM" />
      </div>
      <label>Energy (mellow &#8596; upbeat)</label>
      <input type="range" id="tf-energy" min="1" max="5" step="1" value="3" />
      <label>Flavor</label>
      <div class="chip-row" id="tf-flavors"></div>
      <div style="margin-top:0.8rem">
        <button type="button" id="tf-save">${guestRequested ? 'Add guest request' : 'Add to crate'}</button>
      </div>
      <p class="hint" id="tf-status"></p>
    </div>
  `;

  const $ = (sel) => container.querySelector(sel);

  const flavorsEl = $('#tf-flavors');
  FLAVOR_TAGS.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      if (selectedFlavors.has(tag)) {
        selectedFlavors.delete(tag);
        chip.classList.remove('selected');
      } else {
        selectedFlavors.add(tag);
        chip.classList.add('selected');
      }
    });
    flavorsEl.appendChild(chip);
  });

  function setBpm(bpm) {
    currentBpm = bpm;
    $('#tf-bpm-readout').textContent = bpm ? `${bpm} BPM` : '-- BPM';
    $('#tf-bpm-manual').value = bpm || '';
  }

  const tapTempo = createTapTempo((bpm) => { if (bpm) setBpm(bpm); });
  $('#tf-tap').addEventListener('click', () => tapTempo.tap());
  $('#tf-tap-reset').addEventListener('click', () => { tapTempo.reset(); setBpm(null); });
  $('#tf-bpm-manual').addEventListener('input', (e) => {
    currentBpm = e.target.value ? Number(e.target.value) : null;
  });

  let spotifyMatch = null;

  function currentMode() {
    if (source !== 'vinyl') return 'song';
    return $('#tf-mode-vinyl')?.checked ? 'vinyl' : 'song';
  }

  function applyModeUI() {
    const mode = currentMode();
    const titleInput = $('#tf-title');
    if (mode === 'vinyl') {
      $('#tf-title-label').textContent = 'Vinyl / album title';
      titleInput.placeholder = 'e.g. Amoroso';
    } else {
      $('#tf-title-label').textContent = 'Song title';
      titleInput.placeholder = 'e.g. Baby';
    }
  }

  if (source === 'vinyl') {
    applyModeUI();
    $('#tf-mode-song').addEventListener('change', applyModeUI);
    $('#tf-mode-vinyl').addEventListener('change', applyModeUI);

    $('#tf-spotify-lookup').addEventListener('click', async () => {
      const resultsEl = $('#tf-spotify-results');
      const artist = $('#tf-artist').value.trim();
      const titleVal = $('#tf-title').value.trim();
      const q = `${artist} ${titleVal}`.trim();
      if (!q) { resultsEl.innerHTML = '<p class="hint">Enter artist/title first.</p>'; return; }
      if (!isLoggedIn()) { resultsEl.innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>'; return; }
      resultsEl.innerHTML = '<p class="hint">Searching…</p>';

      if (currentMode() === 'vinyl') {
        try {
          const albums = await searchAlbums(q, 5);
          resultsEl.innerHTML = '';
          albums.forEach((a) => {
            const row = document.createElement('div');
            row.className = 'track-row';
            row.style.cursor = 'pointer';
            row.innerHTML = `
              ${a.albumArt ? `<img src="${a.albumArt}" />` : ''}
              <div class="track-meta">
                <div class="title">${a.name}</div>
                <div class="sub">${a.artist}</div>
              </div>
            `;
            row.addEventListener('click', async () => {
              resultsEl.innerHTML = '<p class="hint">Picking a song from this vinyl…</p>';
              try {
                const track = await getAlbumFirstTrack(a.id);
                if (!track) { resultsEl.innerHTML = '<p class="hint">Could not find a track on that album.</p>'; return; }
                spotifyMatch = { albumArt: a.albumArt, uri: track.uri };
                $('#tf-artist').value = track.artist || a.artist;
                $('#tf-title').value = `${track.title} (${a.name})`;
                resultsEl.innerHTML = `<p class="hint">Auto-picked "${track.title}" from ${a.name}.</p>`;
              } catch (e) {
                resultsEl.innerHTML = `<p class="hint">Lookup failed: ${e.message}</p>`;
              }
            });
            resultsEl.appendChild(row);
          });
          if (albums.length === 0) resultsEl.innerHTML = '<p class="hint">No match — that\'s fine, just fill in the fields by hand and pick a track by ear.</p>';
        } catch (e) {
          resultsEl.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
        }
        return;
      }

      try {
        const results = await searchTracks(q, 5);
        resultsEl.innerHTML = '';
        results.forEach((r) => {
          const row = document.createElement('div');
          row.className = 'track-row';
          row.style.cursor = 'pointer';
          row.innerHTML = `
            ${r.albumArt ? `<img src="${r.albumArt}" />` : ''}
            <div class="track-meta">
              <div class="title">${r.title}</div>
              <div class="sub">${r.artist} &middot; ${r.album || ''}</div>
            </div>
          `;
          row.addEventListener('click', () => {
            spotifyMatch = r;
            $('#tf-artist').value = r.artist;
            $('#tf-title').value = r.title;
            resultsEl.innerHTML = `<p class="hint">Matched: ${r.title} — ${r.artist}</p>`;
          });
          resultsEl.appendChild(row);
        });
        if (results.length === 0) resultsEl.innerHTML = '<p class="hint">No match — that\'s fine, just fill in the fields by hand.</p>';
      } catch (e) {
        resultsEl.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
      }
    });
  }

  $('#tf-save').addEventListener('click', () => {
    const artist = $('#tf-artist').value.trim();
    let trackTitle = $('#tf-title').value.trim();
    const statusEl = $('#tf-status');
    if (!artist || !trackTitle) {
      statusEl.textContent = 'Artist and title are required.';
      return;
    }
    // Vinyl mode without a Spotify auto-pick: the title field holds the
    // album name, not a song — label it honestly rather than pretending
    // it's a specific track.
    if (currentMode() === 'vinyl' && !spotifyMatch) {
      trackTitle = `(DJ's choice, from ${trackTitle})`;
    }
    if (source === 'vinyl' && currentBpm == null) {
      statusEl.textContent = 'Tap the tempo (or type a BPM) so it can be placed in the plan.';
      return;
    }

    const track = {
      id: newId(),
      title: trackTitle,
      artist,
      source,
      bpm: currentBpm,
      energy: Number($('#tf-energy').value),
      flavorTags: Array.from(selectedFlavors),
      guestRequested,
      played: false,
      playedAt: null,
      addedAt: Date.now(),
      spotifyArt: spotifyMatch?.albumArt || null,
      spotifyUri: spotifyMatch?.uri || null,
    };
    Store.addTrack(track);
    statusEl.textContent = `Added "${trackTitle}" — ${artist}.`;
    onSave && onSave(track);

    // Reset for the next entry.
    $('#tf-artist').value = '';
    $('#tf-title').value = '';
    setBpm(null);
    $('#tf-energy').value = 3;
    selectedFlavors = new Set();
    flavorsEl.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
    spotifyMatch = null;
    if (source === 'vinyl') {
      $('#tf-mode-song').checked = true;
      applyModeUI();
    }
    const resultsEl = container.querySelector('#tf-spotify-results');
    if (resultsEl) resultsEl.innerHTML = '';
  });
}
