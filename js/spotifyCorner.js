// Spotify Corner: a browsable view of every track synced from the DJ's own
// playlists (Settings -> "Your playlist(s) for Spotify bridges"), grouped
// by playlist like a Serato-style Spotify panel. Read-only - this is the
// same pool Live Set draws bridge picks from (see spotifySync.js), just
// visible on its own instead of buried in Settings.

import { syncPlaylists, getSyncStatus, onSyncChange } from './spotifySync.js?v=20260918c';

// Tab containers in this app are hidden (display:none), not removed from
// the DOM, on tab-switch - so a plain "unsubscribe the previous listener
// before subscribing a new one" is enough; no need to watch for removal.
let unsubscribePrevious = null;

function statusLine(status) {
  if (status.syncing) return 'Syncing…';
  if (status.reason === 'not-logged-in') return 'Not logged into Spotify - log in under Settings first.';
  if (status.reason === 'no-playlists') return 'No playlists configured yet - add some under Settings.';
  if (!status.at) return 'Not synced yet.';
  const when = new Date(status.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const failedCount = status.playlists.filter((p) => !p.ok).length;
  const okCount = status.playlists.length - failedCount;
  return `Synced ${when} — ${status.tracks.length} track(s) from ${okCount} playlist(s)`
    + (failedCount ? `, ${failedCount} failed` : '');
}

export function renderSpotifyCornerTab(container) {
  container.innerHTML = `
    <div class="card">
      <h2>&#127911; Spotify Corner</h2>
      <p class="hint">Everything synced from your playlists - the same pool Live Set pulls bridge picks from.</p>
      <div class="row">
        <input type="text" id="sc-filter" placeholder="Search artist, song, or playlist..." />
        <button type="button" class="secondary" id="sc-sync-btn" style="flex:none;">&#128260; Sync now</button>
      </div>
      <p class="hint" id="sc-status"></p>
    </div>
    <div id="sc-shelf"></div>
  `;

  const filterInput = container.querySelector('#sc-filter');
  const statusEl = container.querySelector('#sc-status');
  const shelfEl = container.querySelector('#sc-shelf');
  const syncBtn = container.querySelector('#sc-sync-btn');

  function render(filterText) {
    const status = getSyncStatus();
    statusEl.textContent = statusLine(status);

    if (status.reason === 'not-logged-in' || status.reason === 'no-playlists') {
      shelfEl.innerHTML = `<div class="card"><p class="hint">${
        status.reason === 'not-logged-in'
          ? 'Log into Spotify in Settings, then come back here.'
          : 'Paste one or more playlist links in Settings, click "Save & test," then come back here.'
      }</p></div>`;
      return;
    }

    const q = filterText.trim().toLowerCase();
    const groups = new Map(); // playlistName -> tracks[]
    status.tracks.forEach((t) => {
      const hay = `${t.artist} ${t.title} ${t.playlistName}`.toLowerCase();
      if (q && !hay.includes(q)) return;
      if (!groups.has(t.playlistName)) groups.set(t.playlistName, []);
      groups.get(t.playlistName).push(t);
    });

    shelfEl.innerHTML = '';
    if (groups.size === 0) {
      shelfEl.innerHTML = '<div class="card"><p class="hint">No matches.</p></div>';
      return;
    }

    for (const [playlistName, tracks] of groups) {
      const card = document.createElement('div');
      card.className = 'card';
      const heading = document.createElement('h3');
      heading.textContent = `${playlistName} (${tracks.length})`;
      card.appendChild(heading);
      tracks.forEach((t) => {
        const row = document.createElement('div');
        row.className = 'track-row';
        row.innerHTML = `
          ${t.albumArt ? `<img src="${t.albumArt}" />` : '<div class="spotify-disc">&#127925;</div>'}
          <div class="track-meta">
            <div class="title">${t.title}</div>
            <div class="sub">${t.artist}${t.album ? ` &middot; ${t.album}` : ''}</div>
          </div>
        `;
        card.appendChild(row);
      });
      shelfEl.appendChild(card);
    }
  }

  filterInput.addEventListener('input', () => render(filterInput.value));
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    await syncPlaylists({ force: true });
    syncBtn.disabled = false;
  });

  if (unsubscribePrevious) unsubscribePrevious();
  unsubscribePrevious = onSyncChange(() => render(filterInput.value));

  render('');
  // Seamless: sync automatically on opening the tab. Reuses an in-flight
  // or already-completed sync if one happened elsewhere (e.g. Live Set).
  syncPlaylists();
}
