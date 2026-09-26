import { describe, expect, it } from 'vitest';
import { LEGACY_CHUNKS, defaultConfig } from '../src/world/config';
import { WorldGenerator } from '../src/world/generator';

/** Share of lowland (off the mountains) ground too steep to walk up at the old slope limit. */
function steepShare(gen: WorldGenerator) {
  let steep = 0, land = 0;
  const S = gen.size.x;
  for (let z = 30; z < S - 30; z += 3) for (let x = 30; x < S - 30; x += 3) {
    const s = gen.surfaceAt(x, z);
    if (!s || s.y < gen.cfg.seaLevel + 2 || (gen as unknown as { mountainMask: Float32Array }).mountainMask[Math.floor(x) + Math.floor(z) * (S + 1)] > 0.2) continue;
    land++;
    if (s.ny < 0.55) steep++;
  }
  return steep / land;
}

describe('terrain shape', () => {
  const v1 = new WorldGenerator({ ...defaultConfig(1337, LEGACY_CHUNKS), terrain: 1 });
  const v2 = new WorldGenerator({ ...defaultConfig(1337, LEGACY_CHUNKS), terrain: 2 });

  it('new worlds have far fewer steep steps to trip over, with the hills still there', () => {
    const a = steepShare(v1), b = steepShare(v2);
    expect(b).toBeLessThan(a * 0.8);
    // Still hilly: plenty of relief across the land.
    let lo = Infinity, hi = -Infinity;
    for (let z = 40; z < v2.size.z - 40; z += 8) for (let x = 40; x < v2.size.x - 40; x += 8) { const h = v2.height(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    expect(hi - lo).toBeGreaterThan(40);
  });

  it('older saves keep their original ground', () => {
    const old = new WorldGenerator({ ...defaultConfig(1337, LEGACY_CHUNKS), terrain: undefined });
    for (const [x, z] of [[100, 120], [256, 256], [300, 90]]) expect(old.height(x, z)).toBe(v1.height(x, z));
  });
});
