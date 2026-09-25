import { describe, expect, it } from 'vitest';
import { WanderingMerchant } from '../src/entities/merchant';
import { MERCHANT_STOCK } from '../src/entities/npcs';
import { WaterSim } from '../src/world/water';

const fresh = { bossDefeated: false, rocDefeated: false, raidDefeated: false };

describe('wandering merchant', () => {
  it('always brings torches and red elixirs, plus a handful of other goods', () => {
    const s = WanderingMerchant.stockFor(3, 1337, fresh);
    expect(s.map(e => e.item)).toEqual(expect.arrayContaining(['torch', 'healing_potion']));
    expect(s.length).toBe(7);
    expect(new Set(s.map(e => e.item)).size).toBe(s.length);
  });

  it('stock changes between visits but is the same for the same day and seed', () => {
    const a = WanderingMerchant.stockFor(3, 1337, fresh), b = WanderingMerchant.stockFor(3, 1337, fresh);
    expect(a).toEqual(b);
    const days = new Set([3, 5, 8, 11, 14].map(d => WanderingMerchant.stockFor(d, 1337, fresh).map(e => e.item).join()));
    expect(days.size).toBeGreaterThan(2);
  });

  it('rarer goods only appear after the Deepwyrm falls', () => {
    const gated = new Set(MERCHANT_STOCK.filter(s => s.after).map(s => s.item));
    for (let d = 2; d < 60; d++) for (const e of WanderingMerchant.stockFor(d, 7, fresh)) expect(gated.has(e.item)).toBe(false);
    const later = new Set<string>();
    for (let d = 2; d < 60; d++) for (const e of WanderingMerchant.stockFor(d, 7, { ...fresh, bossDefeated: true })) later.add(e.item);
    expect([...later].some(i => gated.has(i))).toBe(true);
  });
});

describe('lava', () => {
  it('is thick: a spill stops in a tongue where water would spread thin', () => {
    const world = (spreadMin?: number) => ({ sx: 40, sy: 10, sz: 40, seaLevel: -1, solid: (_i: number, j: number) => j < 1, oceanFloor: () => null, spreadMin });
    const water = new WaterSim(world()), lava = new WaterSim(world(0.3));
    for (const sim of [water, lava]) { sim.add(20, 1, 20, 2); for (let t = 0; t < 200; t++) sim.step(5000, 20, 20, 40); }
    const reach = (sim: WaterSim) => Math.max(...[...sim.cells.keys()].map(k => { const [i, , k2] = sim.unkey(k); return Math.hypot(i - 20, k2 - 20); }));
    expect(reach(lava)).toBeLessThan(reach(water));
  });
});
