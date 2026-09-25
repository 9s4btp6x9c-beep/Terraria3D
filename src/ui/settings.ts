// Player settings, kept in localStorage (falls back to defaults when storage
// is unavailable). Quality applies on the next load; the rest apply live.

export interface Settings {
  quality: 'auto' | 'low' | 'medium' | 'high';
  /** Field of view in degrees. */
  fov: number;
  /** Look sensitivity multiplier. */
  sensitivity: number;
  invertY: boolean;
  /** Master volume 0..1. */
  volume: number;
  showFps: boolean;
}

const KEY = 'hollowdeep-settings';

export const DEFAULTS: Settings = { quality: 'auto', fov: 78, sensitivity: 1, invertY: false, volume: 0.6, showFps: false };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* storage blocked */ }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}
