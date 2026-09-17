import { Store } from './store.js';
import { insertVinylTrack } from './plan.js';
import { renderTrackForm } from './trackForm.js';

export function renderCrateTab(container) {
  container.innerHTML = `
    <div id="crate-form"></div>
    <div id="crate-bulk" class="card">
      <h3>Bulk import</h3>
      <p class="hint">Paste a JSON crate (e.g. one Claude generated for you after you dictated your collection).</p>
      <textarea id="bulk-json" rows="4" style="width:100%;font-family:monospace;"></textarea>
      <div style="margin-top:0.5rem">
        <button type="button" id="bulk-import-btn">Import</button>
      </div>
      <p class="hint" id="bulk-status"></p>
    </div>
    <div class="card">
      <h3>Your plan order (tempo-flow)</h3>
      <div id="crate-list"></div>
    </div>
  `;

  function refreshList() {
    const tracks = Store.getTracks();
    const planOrder = Store.getPlanOrder();
    const byId = new Map(tracks.filter((t) => t.source === 'vinyl').map((t) => [t.id, t]));
    const listEl = container.querySelector('#crate-list');
    listEl.innerHTML = '';
    if (planOrder.length === 0) {
      listEl.innerHTML = '<p class="hint">No vinyls yet — add some above.</p>';
      return;
    }
    planOrder.forEach((id, idx) => {
      const t = byId.get(id);
      if (!t) return;
      const albumBits = [];
      if (t.album) albumBits.push(t.album);
      if (t.trackNumber != null) albumBits.push(`#${t.trackNumber}`);
      const row = document.createElement('div');
      row.className = 'track-row';
      row.innerHTML = `
        <div class="track-meta">
          <div class="title">${idx + 1}. ${t.artist} — ${t.title} ${t.played ? '&#9989;' : ''}</div>
          <div class="sub">${albumBits.length ? `${albumBits.join(' ')} &middot; ` : ''}${t.bpm ?? '?'} BPM &middot; energy ${t.energy}
            ${t.guestRequested ? '<span class="badge guest">guest</span>' : ''}
          </div>
        </div>
      `;
      listEl.appendChild(row);
    });
  }

  renderTrackForm(container.querySelector('#crate-form'), {
    source: 'vinyl',
    guestRequested: false,
    title: 'Add a vinyl to your crate',
    onSave: (track) => {
      const newOrder = insertVinylTrack(track, Store.getPlanOrder(), Store.getTracks());
      Store.savePlanOrder(newOrder);
      refreshList();
    },
  });

  container.querySelector('#bulk-import-btn').addEventListener('click', () => {
    const statusEl = container.querySelector('#bulk-status');
    try {
      const parsed = JSON.parse(container.querySelector('#bulk-json').value);
      const incoming = Array.isArray(parsed) ? parsed : parsed.tracks;
      if (!Array.isArray(incoming)) throw new Error('Expected a JSON array of tracks, or {tracks: [...]}.');

      let order = Store.getPlanOrder();
      const existing = Store.getTracks();
      incoming.forEach((raw) => {
        const track = {
          id: raw.id || crypto.randomUUID(),
          title: raw.title,
          artist: raw.artist,
          album: raw.album || null,
          trackNumber: raw.trackNumber ?? null,
          source: raw.source || 'vinyl',
          bpm: raw.bpm ?? null,
          energy: raw.energy ?? 3,
          flavorTags: raw.flavorTags || [],
          guestRequested: !!raw.guestRequested,
          played: false,
          playedAt: null,
          addedAt: Date.now(),
          spotifyArt: raw.spotifyArt || null,
          spotifyUri: raw.spotifyUri || null,
        };
        Store.addTrack(track);
        existing.push(track);
        if (track.source === 'vinyl') {
          order = insertVinylTrack(track, order, existing);
        }
      });
      Store.savePlanOrder(order);
      statusEl.textContent = `Imported ${incoming.length} track(s).`;
      container.querySelector('#bulk-json').value = '';
      refreshList();
    } catch (e) {
      statusEl.textContent = `Import failed: ${e.message}`;
    }
  });

  refreshList();
}
