// Tap-tempo widget: tap along to a beat, get an averaged BPM. No external
// dependency, works for any vinyl (or Spotify track) instantly.

const MAX_TAPS = 8;
const IDLE_RESET_MS = 2000;

export function createTapTempo(onChange) {
  let taps = [];

  function tap() {
    const now = Date.now();
    if (taps.length && now - taps[taps.length - 1] > IDLE_RESET_MS) {
      taps = [];
    }
    taps.push(now);
    if (taps.length > MAX_TAPS) taps.shift();

    if (taps.length < 2) {
      onChange(null, taps.length);
      return;
    }
    const intervals = [];
    for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round(60000 / avgMs);
    onChange(bpm, taps.length);
  }

  function reset() {
    taps = [];
    onChange(null, 0);
  }

  return { tap, reset };
}
