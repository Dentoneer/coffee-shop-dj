import { Store } from './store.js?v=20260918d';
import { insertVinylTrack, getPlanDirection } from './plan.js?v=20260918d';
import { renderTrackForm } from './trackForm.js?v=20260918d';
import { renderMoodWave, PRESETS } from './moodWave.js?v=20260918d';
import { generateCrate } from './crateGenerator.js?v=20260918d';

export function renderCrateTab(container) {
  let curvePoints = PRESETS['Build up'].slice();

  container.innerHTML = `
    <div id="crate-form"></div>
    <div class="card">
      <h3>Build a crate</h3>
      <p class="hint">Picks a fresh, random selection from your full collection every time (no more repeats),
        shaped to whatever mood curve you draw below. Once it's in the plan, every pick stays editable in
        Live Set's Full Set list — change the song, tap the real BPM, or hit Shuffle for a different record.</p>
      <label>How many vinyls?</label>
      <input type="number" id="bc-count" value="12" min="1" max="40" style="max-width:8rem;" />
      <label>Mood wave for this stretch of the set</label>
      <div id="bc-wave"></div>
      <button type="button" id="build-crate-btn">Generate crate</button>
      <p class="hint" id="build-crate-status"></p>
    </div>
    <div id="crate-bulk" class="card">
      <h3>Bulk import (advanced)</h3>
      <p class="hint">Paste a JSON crate manually — useful if Claude hands you a researched list to use as-is.</p>
      <textarea id="bulk-json" rows="4" style="width:100%;font-family:monospace;"></textarea>
      <div style="margin-top:0.5rem">
        <button type="button" id="bulk-import-btn">Import</button>
      </div>
      <p class="hint" id="bulk-status"></p>
    </div>
    <div class="card">
      <h3>Your plan order (tempo-flow)</h3>
      <p class="hint">Starts mellow and builds up if your mood lever's start is lower than its end
        (Settings → Set arc), or starts energetic and winds down if start is higher than end.</p>
      <button type="button" class="secondary" id="reverse-plan-btn">Reverse order (flip start ↔ end vibe)</button>
      <div id="crate-list"></div>
    </div>
  `;

  renderMoodWave(container.querySelector('#bc-wave'), {
    points: curvePoints,
    onChange: (pts) => { curvePoints = pts; },
  });

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
      const bpmText = t.bpmEstimated
        ? `<span style="color:var(--accent);">&#9888; ${t.bpm} BPM (est.)</span>`
        : `${t.bpm ?? '?'} BPM`;
      row.innerHTML = `
        <div class="track-meta">
          <div class="title">${idx + 1}. ${t.artist} — ${t.title} ${t.played ? '&#9989;' : ''}</div>
          <div class="sub">${albumBits.length ? `${albumBits.join(' ')} &middot; ` : ''}${bpmText} &middot; energy ${t.energy}
            ${t.guestRequested ? '<span class="badge guest">guest</span>' : ''}
          </div>
        </div>
      `;
      listEl.appendChild(row);
    });
  }

  function importTrackArray(incoming) {
    if (!Array.isArray(incoming)) throw new Error('Expected a JSON array of tracks, or {tracks: [...]}.');
    let order = Store.getPlanOrder();
    const existing = Store.getTracks();
    const direction = getPlanDirection(Store.getSettings());
    incoming.forEach((raw) => {
      const track = {
        id: raw.id || crypto.randomUUID(),
        title: raw.title,
        artist: raw.artist,
        album: raw.album || null,
        trackNumber: raw.trackNumber ?? null,
        source: raw.source || 'vinyl',
        bpm: raw.bpm ?? null,
        bpmEstimated: !!raw.bpmEstimated,
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
        order = insertVinylTrack(track, order, existing, direction);
      }
    });
    Store.savePlanOrder(order);
    return incoming.length;
  }

  renderTrackForm(container.querySelector('#crate-form'), {
    source: 'vinyl',
    guestRequested: false,
    title: 'Add a vinyl to your crate',
    onSave: (track) => {
      const direction = getPlanDirection(Store.getSettings());
      const newOrder = insertVinylTrack(track, Store.getPlanOrder(), Store.getTracks(), direction);
      Store.savePlanOrder(newOrder);
      refreshList();
    },
  });

  container.querySelector('#reverse-plan-btn').addEventListener('click', () => {
    const tracks = Store.getTracks();
    const tracksById = new Map(tracks.map((t) => [t.id, t]));
    const planOrder = Store.getPlanOrder();
    const playedPrefixEnd = planOrder.reduce((last, id, idx) => {
      const t = tracksById.get(id);
      return t && t.played ? idx : last;
    }, -1);
    const prefix = planOrder.slice(0, playedPrefixEnd + 1);
    const tail = planOrder.slice(playedPrefixEnd + 1).reverse();
    Store.savePlanOrder([...prefix, ...tail]);
    refreshList();
  });

  container.querySelector('#build-crate-btn').addEventListener('click', async () => {
    const statusEl = container.querySelector('#build-crate-status');
    const count = Math.max(1, Math.min(40, Number(container.querySelector('#bc-count').value) || 12));
    statusEl.textContent = 'Picking records…';
    try {
      const result = await generateCrate(count, curvePoints);
      if (result.error) {
        statusEl.textContent = result.error;
      } else {
        statusEl.textContent = `Added ${result.count} record(s) shaped to your mood wave. `
          + `BPMs are estimates (&#9888; marked) - tap tempo or Shuffle any row to refine.`;
      }
      refreshList();
    } catch (e) {
      statusEl.textContent = `Couldn't build the crate: ${e.message}`;
    }
  });

  container.querySelector('#bulk-import-btn').addEventListener('click', () => {
    const statusEl = container.querySelector('#bulk-status');
    try {
      const parsed = JSON.parse(container.querySelector('#bulk-json').value);
      const incoming = Array.isArray(parsed) ? parsed : parsed.tracks;
      const count = importTrackArray(incoming);
      statusEl.textContent = `Imported ${count} track(s).`;
      container.querySelector('#bulk-json').value = '';
      refreshList();
    } catch (e) {
      statusEl.textContent = `Import failed: ${e.message}`;
    }
  });

  refreshList();
}
