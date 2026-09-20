// Monoline icon set (24x24, stroke = currentColor) in the missyCoco moodboard
// style: thin rounded strokes, no fill. Styling lives in css/style.css (.icon).

const PATHS = {
  save: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1V20l-6.5-4.2L5.5 20V4.5a1 1 0 0 1 1-1z"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  sparkle: '<path d="M11 3.5c.6 4.3 2.7 6.4 7 7-4.3.6-6.4 2.7-7 7-.6-4.3-2.7-6.4-7-7 4.3-.6 6.4-2.7 7-7z"/><path d="M18.5 3v3M17 4.5h3"/>',
  refresh: '<path d="M19.5 11A7.5 7.5 0 0 0 6 7.2"/><path d="M4.5 4v3.5H8"/><path d="M4.5 13A7.5 7.5 0 0 0 18 16.8"/><path d="M19.5 20v-3.5H16"/>',
  shuffle: '<path d="M3.5 17h3c4.5 0 5-10 10-10h3"/><path d="M17 4l3 3-3 3"/><path d="M3.5 7h3c1.6 0 2.7.9 3.6 2.2"/><path d="M14 14.8c.9 1.3 1.5 2.2 3 2.2h3"/><path d="M17 14l3 3-3 3"/>',
  vinyl: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6.8 12a5.2 5.2 0 0 1 5.2-5.2"/>',
  headphones: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h2.5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z"/><path d="M20 14h-2.5a1 1 0 0 0-1 1v3.5a1 1 0 0 0 1 1h.5a2 2 0 0 0 2-2z"/>',
  note: '<path d="M9.5 17.5V6l9-2v11.5"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="16.5" cy="15.5" r="2"/>',
  alert: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10.5v4"/><path d="M12 17.2v.05"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.4l2.5 2.5 4.9-5.2"/>',
  leaf: '<path d="M5 19c0-8.5 4.5-13.5 14-14 0 9-5 14-14 14z"/><path d="M5 19l8.5-8.5"/>',
};

export function icon(name, extraClass = '') {
  const body = PATHS[name];
  if (!body) throw new Error(`Unknown icon: ${name}`);
  return `<svg class="icon${extraClass ? ` ${extraClass}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
