// Graphics quality presets. Detected from the device (touch-first devices get
// the light preset) and overridable with ?quality=low|medium|high.

export interface Quality {
  name: 'low' | 'medium' | 'high';
  /** Max device pixel ratio used for rendering. */
  pixelRatio: number;
  /** Shadow map size (0 disables shadows). */
  shadowSize: number;
  /** MSAA samples for the main render target. */
  msaa: number;
  mobile: boolean;
  /** Terrain detail distance scale. */
  detail: number;
  /** Grass draw radius (m) and far-tree distance (m). */
  grass: number;
  trees: number;
}

const PRESETS: Record<Quality['name'], Omit<Quality, 'mobile'>> = {
  low: { name: 'low', pixelRatio: 0.85, shadowSize: 1024, msaa: 0, detail: 0.72, grass: 30, trees: 360 },
  medium: { name: 'medium', pixelRatio: 1, shadowSize: 1024, msaa: 2, detail: 0.9, grass: 40, trees: 460 },
  high: { name: 'high', pixelRatio: 1.5, shadowSize: 2048, msaa: 4, detail: 1, grass: 46, trees: 520 },
};

export function isTouchDevice(): boolean {
  try {
    return (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

export function detectQuality(): Quality {
  const mobile = isTouchDevice();
  let name: Quality['name'] = mobile ? 'low' : 'high';
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'low' || q === 'medium' || q === 'high') name = q;
  } catch { /* no location (tests) */ }
  return { ...PRESETS[name], mobile };
}
