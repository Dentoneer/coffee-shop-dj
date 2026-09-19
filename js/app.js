import { handleRedirect } from './spotify.js?v=20260918e';
import { renderCrateTab } from './crate.js?v=20260918e';
import { renderLiveTab } from './liveset.js?v=20260918e';
import { renderSettingsTab } from './settings.js?v=20260918e';
import { renderCollectionTab } from './collection.js?v=20260918e';
import { renderSpotifyCornerTab } from './spotifyCorner.js?v=20260918e';
import { syncPlaylistsInBackground } from './spotifySync.js?v=20260918e';

const panels = {
  live: { el: document.getElementById('tab-live'), render: renderLiveTab },
  crate: { el: document.getElementById('tab-crate'), render: renderCrateTab },
  collection: { el: document.getElementById('tab-collection'), render: renderCollectionTab },
  spotifyCorner: { el: document.getElementById('tab-spotifyCorner'), render: renderSpotifyCornerTab },
  settings: { el: document.getElementById('tab-settings'), render: renderSettingsTab },
};

function showTab(name) {
  Object.entries(panels).forEach(([key, panel]) => {
    panel.el.classList.toggle('active', key === name);
  });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  panels[name].render(panels[name].el);
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

async function init() {
  const cameFromSpotify = await handleRedirect();
  showTab(cameFromSpotify ? 'settings' : 'live');
  // Seamless sync: if already logged in with playlists configured, start
  // pulling them in the background right away instead of waiting for the
  // DJ to visit Settings or Spotify Corner first.
  syncPlaylistsInBackground();
}

init();
