import { describe, expect, it } from 'vitest';
import { WaterSim, type WaterWorld } from '../src/world/water';

/** A 24x16x24 box world: solid floor at y < 4, optional walls/pits. */
function world(extra: (i: number, j: number, k: number) => boolean = () => false, ocean: (i: number, k: number) => number | null = () => null): WaterWorld {
  return { sx: 24, sy: 16, sz: 24, seaLevel: 8, solid: (i, j, k) => j < 4 || extra(i, j, k), oceanFloor: ocean };
}
const total = (w: WaterSim) => [...w.cells.values()].reduce((a, b) => a + b, 0);
const run = (w: WaterSim, ticks: number) => { for (let t = 0; t < ticks; t++) w.step(100000, 12, 12, 100); };

describe('water', () => {
  it('falls and pools at the bottom of a pit, conserving volume', () => {
    // A 3x3 pit two cells deep in a raised floor (solid below y = 6 except the pit).
    const w = new WaterSim(world((i, j, k) => j < 6 && !(i >= 10 && i < 13 && k >= 10 && k < 13 && j >= 4)));
    expect(w.add(11, 8, 11, 5)).toBeCloseTo(5, 5);
    run(w, 200);
    expect(total(w)).toBeCloseTo(5, 1);
    for (const key of w.cells.keys()) {
      const [i, j, k] = w.unkey(key);
      expect(i >= 10 && i < 13 && k >= 10 && k < 13).toBe(true);
      expect(j).toBeLessThan(6);
    }
    expect(w.surfaceAt(11.5, 4.2, 11.5)).toBeGreaterThan(4.4);
  });

  it('spreads out and levels on flat ground', () => {
    const w = new WaterSim(world((i, j, k) => (i < 8 || i > 12 || k < 8 || k > 12) && j < 6));
    w.add(10, 4, 10, 1);
    w.add(10, 5, 10, 1);
    run(w, 400);
    const levels = [...w.cells.values()];
    expect(total(w)).toBeCloseTo(2, 1);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(0.12);
    expect(w.cells.size).toBeGreaterThan(15);
  });

  it('floods a tunnel dug from the sea below sea level', () => {
    // Ocean for i < 6 (sea bed at 4); a tunnel at j = 5 running inland to i = 18.
    const w = new WaterSim(world((i, j, k) => i >= 6 && j < 12 && !(j === 5 && k === 12 && i < 18), (i) => (i < 6 ? 4 : null)));
    w.wake(8, 5, 12, 2);
    run(w, 200);
    for (let i = 6; i < 18; i++) expect(w.level(i, 5, 12)).toBeGreaterThan(0.9);
    expect(w.surfaceAt(12.5, 5.2, 12.5)).toBeGreaterThan(5.8);
  });

  it('round-trips through a save', () => {
    const w = new WaterSim(world());
    w.add(3, 4, 3, 0.6);
    const copy = new WaterSim(world());
    copy.load(JSON.parse(JSON.stringify(w.serialize())));
    expect(copy.level(3, 4, 3)).toBeCloseTo(0.6, 1);
  });
});
