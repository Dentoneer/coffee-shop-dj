// Draggable "mood wave" editor: x = position through the set (start -> end),
// y = energy (1 mellow .. 5 party). Used by Crate Builder's crate generator
// to target a specific record's estimated BPM by where it falls on the
// curve, instead of only a straight-line start->end drift.

const POINT_COUNT = 6;
const MIN_E = 1;
const MAX_E = 5;
const VB_W = 320;
const VB_H = 130;
const PAD_X = 14;
const PAD_Y = 10;

function xForIndex(i) {
  return PAD_X + (i / (POINT_COUNT - 1)) * (VB_W - PAD_X * 2);
}
function yForEnergy(e) {
  const frac = (e - MIN_E) / (MAX_E - MIN_E); // 0..1, 0=mellow
  return VB_H - PAD_Y - frac * (VB_H - PAD_Y * 2);
}
function energyForY(y) {
  const frac = 1 - (y - PAD_Y) / (VB_H - PAD_Y * 2);
  const e = MIN_E + frac * (MAX_E - MIN_E);
  return Math.min(MAX_E, Math.max(MIN_E, Math.round(e * 2) / 2)); // snap to 0.5
}

export const PRESETS = {
  'Build up': [2, 2.2, 2.8, 3.5, 4.2, 4.5],
  'Wind down': [4.5, 4, 3.2, 2.5, 2, 1.5],
  'Peak middle': [2, 3, 4.5, 4.5, 3, 2],
  'Valley middle': [4, 3, 1.5, 1.5, 3, 4],
  Flat: [3, 3, 3, 3, 3, 3],
};

/** Linear-interpolated energy at `frac` (0..1) through the curve's points. */
export function sampleEnergyAtFraction(points, frac) {
  const f = Math.min(1, Math.max(0, frac));
  const pos = f * (points.length - 1);
  const i = Math.floor(pos);
  const j = Math.min(points.length - 1, i + 1);
  const t = pos - i;
  return points[i] + (points[j] - points[i]) * t;
}

/** Coffee-shop-appropriate BPM range: energy 1 -> ~65 BPM, energy 5 -> ~155 BPM. */
export function energyToBpm(energy) {
  return Math.round(65 + (energy - 1) * 22.5);
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 *   points: number[] (length POINT_COUNT, values 1-5) - initial curve
 *   onChange: (points) => void - called whenever the curve is edited
 */
export function renderMoodWave(container, { points, onChange }) {
  let current = points.slice();

  container.innerHTML = `
    <div class="row" style="margin-bottom:0.4rem;">
      ${Object.keys(PRESETS).map((name) => `<button type="button" class="secondary" data-preset="${name}" style="font-size:0.75rem;padding:0.25rem 0.5rem;">${name}</button>`).join('')}
    </div>
    <svg id="mw-svg" viewBox="0 0 ${VB_W} ${VB_H}" style="width:100%;height:130px;touch-action:none;cursor:default;">
      <line x1="${PAD_X}" y1="${yForEnergy(1)}" x2="${VB_W - PAD_X}" y2="${yForEnergy(1)}" stroke="var(--border)" stroke-width="1" />
      <line x1="${PAD_X}" y1="${yForEnergy(5)}" x2="${VB_W - PAD_X}" y2="${yForEnergy(5)}" stroke="var(--border)" stroke-width="1" />
      <polyline id="mw-line" fill="none" stroke="var(--accent2)" stroke-width="2" />
      <g id="mw-points"></g>
    </svg>
    <div class="row" style="margin-top:-0.2rem;">
      <span class="hint" style="flex:none;">mellow</span>
      <span class="hint" style="text-align:right;">party</span>
    </div>
    <p class="hint">Start &rarr; end of the set. Drag any point up/down, or pick a preset then tweak it.</p>
  `;

  const svg = container.querySelector('#mw-svg');
  const line = container.querySelector('#mw-line');
  const pointsG = container.querySelector('#mw-points');

  function redraw() {
    line.setAttribute('points', current.map((e, i) => `${xForIndex(i)},${yForEnergy(e)}`).join(' '));
    pointsG.innerHTML = '';
    current.forEach((e, i) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', xForIndex(i));
      c.setAttribute('cy', yForEnergy(e));
      c.setAttribute('r', 7);
      c.setAttribute('fill', 'var(--accent)');
      c.style.cursor = 'grab';
      c.style.touchAction = 'none';
      c.addEventListener('pointerdown', (ev) => startDrag(ev, i));
      pointsG.appendChild(c);
    });
  }

  function svgY(clientY) {
    const rect = svg.getBoundingClientRect();
    return ((clientY - rect.top) / rect.height) * VB_H;
  }

  let draggingIndex = null;
  function startDrag(ev, i) {
    ev.preventDefault();
    draggingIndex = i;
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  }
  function onDrag(ev) {
    if (draggingIndex == null) return;
    current[draggingIndex] = energyForY(svgY(ev.clientY));
    redraw();
  }
  function endDrag() {
    if (draggingIndex == null) return;
    draggingIndex = null;
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
    onChange(current.slice());
  }

  container.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      current = PRESETS[btn.dataset.preset].slice();
      redraw();
      onChange(current.slice());
    });
  });

  redraw();
}
