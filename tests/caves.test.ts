import { describe, expect, it } from 'vitest';
import { LEGACY_CHUNKS, defaultConfig } from '../src/world/config';
import { WorldGenerator } from '../src/world/generator';

/** Share of underground samples that are open air, and vertical openings to the surface. */
function survey(gen: WorldGenerator) {
  const S = gen.size.x;
  let air = 0, total = 0;
  const opens: [number, number][] = [];
  for (let z = 20; z < S - 20; z += 4) for (let x = 20; x < S - 20; x += 4) {
    const h = gen.height(x, z);
    if (h < gen.cfg.seaLevel + 3) continue;
    for (let y = 10; y < h - 6; y += 3) { total++; if (gen.densityAt(x, y, z) < 0) air++; }
    let depth = 0;
    for (let y = h + 1; y > h - 30; y -= 1) { if (gen.densityAt(x, y, z) < 0) depth = h - y; else break; }
    if (depth > 10 && !opens.some(([a, b]) => Math.hypot(a - x, b - z) < 20)) opens.push([x, z]);
  }
  return { air: air / total, openings: opens.length };
}

describe('cave systems', () => {
  const legacy = new WorldGenerator({ ...defaultConfig(1337, LEGACY_CHUNKS), caves: 1 });
  const modern = new WorldGenerator({ ...defaultConfig(1337, LEGACY_CHUNKS), caves: 2 });

  it('older saves keep their original caves', () => {
    expect(legacy.mouths.length).toBe(0);
    const unversioned = new WorldGenerator({ ...defaultConfig(1337, LEGACY_CHUNKS), caves: undefined });
    for (const [x, y, z] of [[100, 40, 120], [256, 30, 256], [300, 55, 90]]) expect(unversioned.densityAt(x, y, z)).toBe(legacy.densityAt(x, y, z));
  });

  it('new worlds have much roomier caves and many more ways in', () => {
    const a = survey(legacy), b = survey(modern);
    expect(b.air).toBeGreaterThan(a.air * 1.4);
    expect(b.air).toBeLessThan(0.4);
    expect(b.openings).toBeGreaterThan(a.openings);
    expect(modern.mouths.length).toBeGreaterThan(15);
    expect(modern.mouths.some(m => m.kind === 'sinkhole')).toBe(true);
  });

  it('cave mouths keep clear of spawn and lakes', () => {
    for (const m of modern.mouths) {
      expect(Math.hypot(m.x - modern.spawn.x, m.z - modern.spawn.z)).toBeGreaterThan(40);
      for (const l of modern.lakes) expect(Math.hypot(m.x - l.x, m.z - l.z)).toBeGreaterThan(l.r * 1.8);
    }
  });

  it('never breach a lake bed (the water would drain away)', () => {
    for (const l of modern.lakes) {
      let air = 0;
      for (let a = 0; a < 6.28; a += 0.4) for (let r = 0; r < l.r; r += 2) for (let y = l.level - l.depth - 6; y < l.level - l.depth - 1; y += 1)
        if (modern.densityAt(l.x + Math.cos(a) * r, y, l.z + Math.sin(a) * r) < 0) air++;
      expect(air).toBe(0);
    }
  });
});
