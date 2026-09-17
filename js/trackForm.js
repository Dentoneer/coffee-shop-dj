// Shared "add a track" form: used by Crate Builder (owned vinyls) and by
// Live Set's "add guest vinyl" flow. Title/artist + optional Spotify search
// autofill, tap-tempo BPM, energy slider, flavor chips.

import { FLAVOR_TAGS, newId, Store } from './store.js';
import { createTapTempo } from './tapTempo.js';
import { searchTracks, isLoggedIn } from './spotify.js';

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
      <label>Title</label>
      <input type="text" id="tf-title" placeholder="e.g. Baby" />
      ${source === 'vinyl' ? `
        <button type="button" class="secondary" id="tf-spotify-lookup">Look up on Spotify (art + confirm)</button>
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

  if (source === 'vinyl') {
    $('#tf-spotify-lookup').addEventListener('click', async () => {
      const resultsEl = $('#tf-spotify-results');
      const q = `${$('#tf-artist').value} ${$('#tf-title').value}`.trim();
      if (!q) { resultsEl.innerHTML = '<p class="hint">Enter artist/title first.</p>'; return; }
      if (!isLoggedIn()) { resultsEl.innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>'; return; }
      resultsEl.innerHTML = '<p class="hint">Searching…</p>';
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
    const trackTitle = $('#tf-title').value.trim();
    const statusEl = $('#tf-status');
    if (!artist || !trackTitle) {
      statusEl.textContent = 'Artist and title are required.';
      return;
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
    const resultsEl = container.querySelector('#tf-spotify-results');
    if (resultsEl) resultsEl.innerHTML = '';
  });
}
