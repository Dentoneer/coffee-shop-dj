import { Store } from './store.js?v=20260917t';
import { login, logout, isLoggedIn, handleRedirect, getPlaylistTracks, parsePlaylistId, getPlaylistRawSample } from './spotify.js?v=20260917t';

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
      <div style="margin-top:0.4rem"><button type="button" class="secondary" id="s-save-playlists">Save &amp; test</button></div>
      <p class="hint" id="s-playlist-status"></p>
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
      statusEl.textContent = 'Saved, but you\'re not logged into Spotify — click "Log into Spotify" above first, then Save & test again.';
      return;
    }
    statusEl.textContent = 'Testing…';
    const results = await Promise.all(ids.map(async (id) => {
      try {
        const tracks = await getPlaylistTracks(id, 50);
        return { id, ok: true, count: tracks.length };
      } catch (e) {
        return { id, ok: false, error: e.message };
      }
    }));
    const failed = results.filter((r) => !r.ok);
    const okTotal = results.filter((r) => r.ok).reduce((sum, r) => sum + r.count, 0);
    if (failed.length === 0 && okTotal > 0) {
      statusEl.textContent = `Connected — pulled ${okTotal} track(s) from ${results.length} playlist(s). Bridges will use these.`;
    } else if (failed.length === 0 && okTotal === 0) {
      // Request succeeded but parsed zero tracks - grab a raw sample so
      // there's something concrete to look at instead of guessing blind.
      statusEl.textContent = 'Connected, but parsed 0 tracks - fetching a raw sample to see why…';
      try {
        const sample = await getPlaylistRawSample(ids[0]);
        statusEl.textContent = `Connected, but parsed 0 tracks from ${ids.length} playlist(s). `
          + `Raw response for the first one (status ${sample.status}): ${sample.body}`;
      } catch (e) {
        statusEl.textContent = `Connected, but parsed 0 tracks, and the raw sample fetch also failed: ${e.message}`;
      }
    } else if (failed.some((r) => r.error.includes('403'))) {
      statusEl.textContent = `Failed (403 — missing permission). Click "Log out" above, then "Log into Spotify" again to grant playlist access, then Save & test once more.`;
    } else {
      statusEl.textContent = `${okTotal} track(s) loaded OK, but ${failed.length} playlist(s) failed: ${failed.map((r) => `${r.id} (${r.error})`).join(', ')}. Check the link(s) are correct.`;
    }
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
