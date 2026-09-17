import { Store } from './store.js?v=20260917n';
import { login, logout, isLoggedIn, handleRedirect } from './spotify.js?v=20260917n';

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
