// Vinyl Corner: a cozy, browsable, alphabetized view of the full personal
// collection (data/collection.json). Separate from Crate Builder, which is
// only the subset tagged with tempo/energy for a specific live set.

let cachedCollection = null;

function stripLeadingArticle(name) {
  return name.replace(/^(the|los|la|el)\s+/i, '');
}

async function loadCollection() {
  if (cachedCollection) return cachedCollection;
  const res = await fetch('data/collection.json');
  cachedCollection = await res.json();
  return cachedCollection;
}

export function renderCollectionTab(container) {
  container.innerHTML = `
    <div class="card">
      <h2>&#128191; Vinyl Corner</h2>
      <p class="hint">Your personal collection, alphabetized by artist.</p>
      <input type="text" id="vc-filter" placeholder="Search artist or album..." />
      <p class="hint" id="vc-count"></p>
    </div>
    <div id="vc-shelf" class="vinyl-shelf"></div>
  `;

  const filterInput = container.querySelector('#vc-filter');
  const shelfEl = container.querySelector('#vc-shelf');
  const countEl = container.querySelector('#vc-count');

  loadCollection().then((records) => {
    const sorted = [...records].sort((a, b) =>
      stripLeadingArticle(a.artist).localeCompare(stripLeadingArticle(b.artist)) ||
      a.album.localeCompare(b.album)
    );

    function render(filterText) {
      const q = filterText.trim().toLowerCase();
      const filtered = q
        ? sorted.filter((r) => `${r.artist} ${r.album}`.toLowerCase().includes(q))
        : sorted;

      countEl.textContent = `${filtered.length} of ${sorted.length} records`;
      shelfEl.innerHTML = '';

      let currentLetter = null;
      filtered.forEach((r) => {
        const letter = stripLeadingArticle(r.artist)[0]?.toUpperCase() || '#';
        if (letter !== currentLetter) {
          currentLetter = letter;
          const heading = document.createElement('div');
          heading.className = 'vinyl-letter';
          heading.textContent = letter;
          shelfEl.appendChild(heading);
        }
        const card = document.createElement('div');
        card.className = 'vinyl-card';
        card.innerHTML = `
          <div class="vinyl-disc">&#9835;</div>
          <div class="vinyl-info">
            <div class="vinyl-artist">${r.artist}</div>
            <div class="vinyl-album">${r.album}</div>
          </div>
        `;
        shelfEl.appendChild(card);
      });
    }

    render('');
    filterInput.addEventListener('input', () => render(filterInput.value));
  });
}
