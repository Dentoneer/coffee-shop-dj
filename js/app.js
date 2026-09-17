import { handleRedirect } from './spotify.js';
import { renderCrateTab } from './crate.js';
import { renderLiveTab } from './liveset.js';
import { renderSettingsTab } from './settings.js';
import { renderCollectionTab } from './collection.js';

const panels = {
  live: { el: document.getElementById('tab-live'), render: renderLiveTab },
  crate: { el: document.getElementById('tab-crate'), render: renderCrateTab },
  collection: { el: document.getElementById('tab-collection'), render: renderCollectionTab },
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
}

init();
