// Live Set's "🎯 Vibe set" panel: pick 3 seed songs from Spotify, choose a
// length, Generate. The set itself is built by vibeSet.generateVibeSet; this
// is only the UI around it.

import { Store } from './store.js?v=20261105mix';
import { searchTracks, isLoggedIn } from './spotify.js?v=20261105mix';
import { hasLastfmKey } from './lastfm.js?v=20261105mix';
import { generateVibeSet } from './vibeSet.js?v=20261105mix';

const SEED_COUNT = 3;

function songRow(r) {
  return `
    ${r.albumArt ? `<img src="${r.albumArt}" />` : ''}
    <div class="track-meta"><div class="title">${r.title}</div><div class="sub">${r.artist} &middot; ${r.album || ''}</div></div>
  `;
}

export function renderVibePanel(mountEl, { onBuilt, onClose }) {
  if (!hasLastfmKey()) {
    mountEl.innerHTML = '<p class="hint">Vibe sets use Last.fm. Add your free API key in Settings → Last.fm (takes 2 minutes).</p>';
    return;
  }
  if (!isLoggedIn()) {
    mountEl.innerHTML = '<p class="hint">Log in to Spotify in Settings to search for seed songs.</p>';
    return;
  }

  const seeds = new Array(SEED_COUNT).fill(null);
  mountEl.innerHTML = `
    <p class="hint">Pick 3 songs that set the vibe, how many songs you want, and the mix. Mixed alternates your
      records that fit with Spotify songs listeners pair with these, then goes all Spotify when your records run out.</p>
    <div class="vp-seeds"></div>
    <div class="chip-row vp-mix" style="margin-top:0.6rem;">
      <span class="chip selected" data-mix="mixed">Mixed</span>
      <span class="chip" data-mix="vinyl">Vinyl only</span>
      <span class="chip" data-mix="spotify">Spotify only</span>
    </div>
    <div class="row" style="margin-top:0.5rem;">
      <label style="margin:0;flex:none;">Songs</label>
      <input type="number" class="vp-count" min="6" max="60" value="20" style="flex:none;width:5rem;" />
      <button type="button" class="vp-generate" disabled>Generate</button>
      <button type="button" class="secondary vp-cancel" style="flex:none;">Cancel</button>
    </div>
    <p class="hint vp-status"></p>
  `;
  const seedsEl = mountEl.querySelector('.vp-seeds');
  const generateBtn = mountEl.querySelector('.vp-generate');
  const statusEl = mountEl.querySelector('.vp-status');

  function renderSeeds() {
    seedsEl.innerHTML = '';
    seeds.forEach((seed, i) => {
      const slot = document.createElement('div');
      slot.style.marginTop = '0.5rem';
      if (seed) {
        slot.innerHTML = `<div class="track-row"><span class="badge spotify">SEED ${i + 1}</span>${songRow(seed)}<button type="button" class="secondary" style="flex:none;">✕</button></div>`;
        slot.querySelector('button').addEventListener('click', () => { seeds[i] = null; renderSeeds(); });
      } else {
        slot.innerHTML = `
          <div class="row"><input type="text" placeholder="Seed ${i + 1}: song or artist" /><button type="button" class="secondary" style="flex:none;">Search</button></div>
          <div class="vp-results"></div>
        `;
        const input = slot.querySelector('input');
        const results = slot.querySelector('.vp-results');
        const search = async () => {
          const q = input.value.trim();
          if (!q) return;
          results.innerHTML = '<p class="hint">Searching…</p>';
          try {
            const found = await searchTracks(q, 5);
            results.innerHTML = found.length ? '' : '<p class="hint">No results.</p>';
            found.forEach((r) => {
              const row = document.createElement('div');
              row.className = 'track-row';
              row.style.cursor = 'pointer';
              row.innerHTML = songRow(r);
              row.addEventListener('click', () => { seeds[i] = r; renderSeeds(); });
              results.appendChild(row);
            });
          } catch (e) {
            results.innerHTML = `<p class="hint">Search failed: ${e.message}</p>`;
          }
        };
        slot.querySelector('button').addEventListener('click', search);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
      }
      seedsEl.appendChild(slot);
    });
    generateBtn.disabled = seeds.some((s) => !s);
  }
  renderSeeds();

  // Mixed / Vinyl only / Spotify only - one choice at a time.
  mountEl.querySelectorAll('.vp-mix .chip').forEach((chip) => chip.addEventListener('click', () => {
    mountEl.querySelectorAll('.vp-mix .chip').forEach((c) => c.classList.toggle('selected', c === chip));
  }));

  mountEl.querySelector('.vp-cancel').addEventListener('click', onClose);
  generateBtn.addEventListener('click', async () => {
    const count = Math.max(6, Math.min(60, Number(mountEl.querySelector('.vp-count').value) || 20));
    const mix = mountEl.querySelector('.vp-mix .chip.selected').dataset.mix;
    if (Store.getTracks().length && !confirm('Replace the current set with a new vibe set?')) return;
    generateBtn.disabled = true;
    try {
      const r = await generateVibeSet(seeds, count, (label, done, total) => {
        statusEl.textContent = total ? `${label} ${done}/${total}` : label;
      }, mix);
      statusEl.textContent = `Built ${r.count} songs: ${r.vinylCount} vinyl, ${r.spotifyCount} Spotify`
        + (r.short ? ' (fewer than asked, not enough matches).' : '.');
      onBuilt();
    } catch (e) {
      statusEl.textContent = e.code === 10 || e.code === 26
        ? 'Last.fm rejected your API key — check it in Settings → Last.fm (Test key).'
        : `Couldn't build the set: ${e.message}`;
    } finally {
      generateBtn.disabled = seeds.some((s) => !s);
    }
  });
}
