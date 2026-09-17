// Shared "add a track" form: used by Crate Builder (owned vinyls) and by
// Live Set's "add guest vinyl" flow. Artist + album are the record; song
// title/track number are optional and can come from a Spotify album
// lookup (search albums, then pick the real track off the tracklist) or
// be left blank for "DJ picks by ear."

import { FLAVOR_TAGS, newId, Store } from './store.js';
import { createTapTempo } from './tapTempo.js';
import { searchTracks, searchAlbums, getAlbumTracks, isLoggedIn } from './spotify.js';

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
  let spotifyMatch = null; // { albumArt, uri }

  container.innerHTML = `
    <div class="card">
      <h3>${title}</h3>
      <label>Artist</label>
      <input type="text" id="tf-artist" placeholder="e.g. Bebel Gilberto" />
      ${source === 'vinyl' ? `
        <label>Vinyl / album title</label>
        <input type="text" id="tf-album" placeholder="e.g. Amoroso" />
      ` : ''}
      <label>Song title <span class="hint">(optional — leave blank to pick by ear)</span></label>
      <div class="row">
        <input type="text" id="tf-title" placeholder="e.g. Baby" />
        <input type="number" id="tf-tracknum" placeholder="Track #" style="flex:none;width:6rem;" />
      </div>
      ${source === 'vinyl' ? `
        <button type="button" class="secondary" id="tf-spotify-lookup">Look up vinyl on Spotify (shows real tracklist)</button>
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

  if (source === 'vinyl') {
    $('#tf-spotify-lookup').addEventListener('click', async () => {
      const resultsEl = $('#tf-spotify-results');
      const artist = $('#tf-artist').value.trim();
      const album = $('#tf-album').value.trim();
      const q = `${artist} ${album}`.trim();
      if (!q) { resultsEl.innerHTML = '<p class="hint">Enter artist and album first.</p>'; return; }
      if (!isLoggedIn()) { resultsEl.innerHTML = '<p class="hint">Log into Spotify in Settings first.</p>'; return; }
      resultsEl.innerHTML = '<p class="hint">Searching…</p>';
      try {
        const albums = await searchAlbums(q, 5);
        resultsEl.innerHTML = '';
        if (albums.length === 0) {
          resultsEl.innerHTML = '<p class="hint">No match — that\'s fine, just fill in the fields by hand.</p>';
          return;
        }
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
            resultsEl.innerHTML = '<p class="hint">Loading tracklist…</p>';
            try {
              const tracks = await getAlbumTracks(a.id);
              if (tracks.length === 0) { resultsEl.innerHTML = '<p class="hint">No tracklist found for that album.</p>'; return; }
              resultsEl.innerHTML = `<p class="hint">Pick the track you'll play from <strong>${a.name}</strong>:</p>`;
              const list = document.createElement('div');
              tracks.forEach((t) => {
                const tRow = document.createElement('div');
                tRow.className = 'track-row';
                tRow.style.cursor = 'pointer';
                tRow.innerHTML = `
                  <div class="track-meta">
                    <div class="title">${t.trackNumber != null ? `${t.trackNumber}. ` : ''}${t.title}</div>
                  </div>
                `;
                tRow.addEventListener('click', () => {
                  spotifyMatch = { albumArt: a.albumArt, uri: t.uri };
                  $('#tf-artist').value = t.artist || a.artist;
                  $('#tf-album').value = a.name;
                  $('#tf-title').value = t.title;
                  $('#tf-tracknum').value = t.trackNumber ?? '';
                  resultsEl.innerHTML = `<p class="hint">Picked: ${t.trackNumber != null ? `#${t.trackNumber} ` : ''}${t.title} — ${a.name}</p>`;
                });
                list.appendChild(tRow);
              });
              resultsEl.appendChild(list);
            } catch (e) {
              resultsEl.innerHTML = `<p class="hint">Tracklist lookup failed: ${e.message}</p>`;
            }
          });
          resultsEl.appendChild(row);
        });
      } catch (e) {
        resultsEl.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
      }
    });
  }

  $('#tf-save').addEventListener('click', () => {
    const artist = $('#tf-artist').value.trim();
    const album = source === 'vinyl' ? $('#tf-album').value.trim() : '';
    const songTitle = $('#tf-title').value.trim();
    const trackNumberRaw = $('#tf-tracknum').value.trim();
    const trackNumber = trackNumberRaw ? Number(trackNumberRaw) : null;
    const statusEl = $('#tf-status');

    if (!artist || (source === 'vinyl' && !album) || (source === 'spotify' && !songTitle)) {
      statusEl.textContent = source === 'vinyl'
        ? 'Artist and vinyl/album title are required.'
        : 'Artist and song title are required.';
      return;
    }
    if (source === 'vinyl' && currentBpm == null) {
      statusEl.textContent = 'Tap the tempo (or type a BPM) so it can be placed in the plan.';
      return;
    }

    const displayTitle = songTitle || "(DJ's choice)";

    const track = {
      id: newId(),
      title: source === 'vinyl' ? displayTitle : songTitle,
      artist,
      album: source === 'vinyl' ? album : null,
      trackNumber,
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
    statusEl.textContent = source === 'vinyl'
      ? `Added "${album}" — ${artist}${songTitle ? ` (${songTitle})` : ''}.`
      : `Added "${songTitle}" — ${artist}.`;
    onSave && onSave(track);

    // Reset for the next entry.
    $('#tf-artist').value = '';
    if (source === 'vinyl') $('#tf-album').value = '';
    $('#tf-title').value = '';
    $('#tf-tracknum').value = '';
    setBpm(null);
    $('#tf-energy').value = 3;
    selectedFlavors = new Set();
    flavorsEl.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
    spotifyMatch = null;
    const resultsEl = container.querySelector('#tf-spotify-results');
    if (resultsEl) resultsEl.innerHTML = '';
  });
}
