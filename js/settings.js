import { Store } from './store.js?v=20260918c';
import { login, logout, isLoggedIn, handleRedirect, parsePlaylistId, getPlaylistRawSample } from './spotify.js?v=20260918c';
import { syncPlaylists } from './spotifySync.js?v=20260918c';
import { summaryLine } from './savedSets.js?v=20260918c';

export function renderSettingsTab(container) {
  const settings = Store.getSettings();

  container.innerHTML = `
    <div class="card">
      <h3>Spotify</h3>
      <label>Client ID</label>
      <input type="text" id="s-client-id" value="${settings.spotifyClientId}" placeholder="from your Spotify Developer app" />
      <p class="hint">Register a free app at developer.spotify.com/dashboard, add
        <code id="s-redirect-uri"></code> as a Redirect URI, and paste the Client ID here.</p>
      <div id="s-spotify-status"></div>
      <label>Your playlist(s) for Spotify bridges</label>
      <textarea id="s-playlists" rows="2" placeholder="Paste one or more playlist links/IDs, separated by commas or new lines" style="width:100%;">${settings.spotifyPlaylistUrls}</textarea>
      <p class="hint">Live Set picks ~90% of Spotify bridges from these, ~10% fresh from search, for variety.
        Leave blank to use search only. Needs the <code>playlist-read</code> scope — if you logged in before
        this existed, click "Log out" above, then "Log into Spotify" again to grant it (one time).</p>
      <div style="margin-top:0.4rem"><button type="button" class="secondary" id="s-save-playlists">Save &amp; sync</button></div>
      <p class="hint" id="s-playlist-status"></p>
      <p class="hint">Browse everything synced under the "Spotify Corner" tab.</p>
    </div>

    <div class="card">
      <h3>Set arc</h3>
      <label>Set duration (minutes)</label>
      <input type="number" id="s-duration" value="${settings.setDurationMinutes}" />
      <label>Mood lever start (1 mellow – 5 upbeat)</label>
      <input type="number" id="s-lever-start" min="1" max="5" step="0.1" value="${settings.leverStart}" />
      <label>Mood lever end</label>
      <input type="number" id="s-lever-end" min="1" max="5" step="0.1" value="${settings.leverEnd}" />
      <div style="margin-top:0.6rem"><button type="button" id="s-save-arc">Save</button></div>
    </div>

    <div class="card">
      <h3>Saved sets</h3>
      <p class="hint">Named snapshots you've saved from Live Set ("&#128190; Save this set") — name, date, mood
        arc, duration, and a summary of what played. Saving never touches your current live set.</p>
      <div id="saved-sets-list"></div>
    </div>

    <div class="card">
      <h3>Backup</h3>
      <div class="row">
        <button type="button" class="secondary" id="s-export">Export JSON</button>
        <button type="button" class="secondary" id="s-reset">Reset crate/set</button>
      </div>
      <label>Import (paste JSON)</label>
      <textarea id="s-import-text" rows="3" style="width:100%;font-family:monospace;"></textarea>
      <div style="margin-top:0.5rem"><button type="button" id="s-import">Import</button></div>
      <p class="hint" id="s-backup-status"></p>
      <p class="hint">"Reset crate/set" clears tracks, the plan, and live progress only —
        it keeps your Spotify Client ID and login. There's no button that wipes those;
        edit or clear the Client ID field above yourself if you ever need to.</p>
    </div>
  `;

  container.querySelector('#s-redirect-uri').textContent = `${location.origin}${location.pathname}`;

  function refreshSpotifyStatus() {
    const statusEl = container.querySelector('#s-spotify-status');
    if (isLoggedIn()) {
      statusEl.innerHTML = `<p class="hint">Logged in.</p><button type="button" class="secondary" id="s-logout">Log out</button>`;
      statusEl.querySelector('#s-logout').addEventListener('click', () => { logout(); refreshSpotifyStatus(); });
    } else {
      statusEl.innerHTML = `<button type="button" id="s-login">Log into Spotify</button>`;
      statusEl.querySelector('#s-login').addEventListener('click', async () => {
        Store.updateSettings({ spotifyClientId: container.querySelector('#s-client-id').value.trim() });
        try { await login(); } catch (e) { alert(e.message); }
      });
    }
  }
  refreshSpotifyStatus();

  container.querySelector('#s-client-id').addEventListener('change', (e) => {
    Store.updateSettings({ spotifyClientId: e.target.value.trim() });
  });

  container.querySelector('#s-save-playlists').addEventListener('click', async () => {
    const raw = container.querySelector('#s-playlists').value.trim();
    Store.updateSettings({ spotifyPlaylistUrls: raw });
    const statusEl = container.querySelector('#s-playlist-status');
    const ids = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map(parsePlaylistId);
    if (ids.length === 0) {
      statusEl.textContent = 'Saved (no playlists set — bridges will use search only).';
      return;
    }
    if (!isLoggedIn()) {
      statusEl.textContent = 'Saved, but you\'re not logged into Spotify — click "Log into Spotify" above first, then Save & sync again.';
      return;
    }
    statusEl.textContent = 'Syncing…';
    // Goes through the same shared sync used by Live Set and Spotify
    // Corner, so this "test" is the real thing, not a separate check.
    const status = await syncPlaylists({ force: true });
    const failed = status.playlists.filter((p) => !p.ok);
    if (failed.length === 0 && status.tracks.length > 0) {
      statusEl.textContent = `Connected — synced ${status.tracks.length} track(s) from ${status.playlists.length} playlist(s). See them in Spotify Corner.`;
    } else if (failed.length === 0 && status.tracks.length === 0) {
      // Synced OK but parsed zero tracks - grab a raw sample so there's
      // something concrete to look at instead of guessing blind again.
      statusEl.textContent = 'Connected, but parsed 0 tracks - fetching a raw sample to see why…';
      try {
        const sample = await getPlaylistRawSample(ids[0]);
        statusEl.textContent = `Connected, but parsed 0 tracks from ${ids.length} playlist(s). `
          + `Raw response for the first one (status ${sample.status}): ${sample.body}`;
      } catch (e) {
        statusEl.textContent = `Connected, but parsed 0 tracks, and the raw sample fetch also failed: ${e.message}`;
      }
    } else if (failed.some((p) => p.error && p.error.includes('403'))) {
      statusEl.textContent = `Failed (403 — missing permission). Click "Log out" above, then "Log into Spotify" again to grant playlist access, then Save & sync once more.`;
    } else {
      statusEl.textContent = `${status.tracks.length} track(s) synced OK, but ${failed.length} playlist(s) failed: ${failed.map((p) => `${p.name || p.id} (${p.error})`).join(', ')}. Check the link(s) are correct.`;
    }
  });

  function renderSavedSets() {
    const listEl = container.querySelector('#saved-sets-list');
    const sets = Store.getSavedSets();
    if (sets.length === 0) {
      listEl.innerHTML = '<p class="hint">Nothing saved yet.</p>';
      return;
    }
    listEl.innerHTML = '';
    sets.forEach((set) => {
      const row = document.createElement('div');
      row.className = 'card';
      row.style.background = 'var(--accent-soft)';
      row.innerHTML = `
        <div class="row" style="align-items:flex-start;">
          <div style="flex:1;">
            <div class="title" style="font-weight:bold;">${set.name}</div>
            <div class="hint">${summaryLine(set)}</div>
            ${set.artists.length ? `<div class="hint">${set.artists.slice(0, 8).join(', ')}${set.artists.length > 8 ? ` +${set.artists.length - 8} more` : ''}</div>` : ''}
          </div>
          <div style="flex:none;display:flex;flex-direction:column;gap:0.3rem;">
            <button type="button" class="secondary" data-view="${set.id}">View tracks</button>
            <button type="button" class="secondary" data-delete="${set.id}">Delete</button>
          </div>
        </div>
        <div id="ss-view-${set.id}"></div>
      `;
      listEl.appendChild(row);
    });

    listEl.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const set = sets.find((s) => s.id === btn.dataset.view);
        const viewEl = listEl.querySelector(`#ss-view-${set.id}`);
        if (viewEl.innerHTML) { viewEl.innerHTML = ''; return; }
        viewEl.innerHTML = set.planOrder.map((id, i) => {
          const t = set.tracks.find((tr) => tr.id === id) || set.tracks.find((tr) => tr.source === 'vinyl');
          if (!t) return '';
          return `<div class="track-row"><div class="track-meta"><div class="title">${i + 1}. ${t.artist} — ${t.title}</div>
            <div class="sub">${t.album || ''}${t.bpm != null ? ` &middot; ${t.bpm} BPM` : ''} &middot; energy ${t.energy}</div></div></div>`;
        }).join('') || '<p class="hint">No vinyl plan recorded for this set.</p>';
      });
    });
    listEl.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const set = sets.find((s) => s.id === btn.dataset.delete);
        if (!confirm(`Delete saved set "${set.name}"? This can't be undone.`)) return;
        Store.deleteSavedSet(set.id);
        renderSavedSets();
      });
    });
  }
  renderSavedSets();

  container.querySelector('#s-save-arc').addEventListener('click', () => {
    Store.updateSettings({
      setDurationMinutes: Number(container.querySelector('#s-duration').value),
      leverStart: Number(container.querySelector('#s-lever-start').value),
      leverEnd: Number(container.querySelector('#s-lever-end').value),
    });
    container.querySelector('#s-backup-status').textContent = 'Saved.';
  });

  container.querySelector('#s-export').addEventListener('click', () => {
    const data = JSON.stringify(Store.exportAll(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `coffee-shop-dj-backup-${Date.now()}.json`;
    a.click();
  });

  container.querySelector('#s-import').addEventListener('click', () => {
    const statusEl = container.querySelector('#s-backup-status');
    try {
      const data = JSON.parse(container.querySelector('#s-import-text').value);
      Store.importAll(data);
      statusEl.textContent = 'Imported. Switch tabs to see it reflected.';
    } catch (e) {
      statusEl.textContent = `Import failed: ${e.message}`;
    }
  });

  container.querySelector('#s-reset').addEventListener('click', () => {
    if (!confirm('This clears your tracks, plan, and live progress on this device (keeps your Spotify Client ID and login). Continue?')) return;
    Store.resetSetData();
    location.reload();
  });
}

export { handleRedirect };
