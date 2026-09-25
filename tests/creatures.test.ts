import { describe, expect, it } from 'vitest';
import { CREATURES, Creature, peaceful } from '../src/entities/creatures';

describe('creature temperament', () => {
  const blob = () => new Creature(CREATURES.blob, 0, 70, 0);

  it('meadow creatures are docile by day but not at night', () => {
    const c = blob();
    expect(peaceful(c, true)).toBe(true);
    expect(peaceful(c, false)).toBe(false);
  });

  it('a struck creature stays hostile', () => {
    const c = blob();
    c.provoked = true;
    expect(peaceful(c, true)).toBe(false);
  });

  it('dangerous lands and night hunters are never docile', () => {
    for (const id of ['rift_blob', 'rootwalker', 'drifter', 'bonepicker', 'dune_crawler']) {
      expect(peaceful(new Creature(CREATURES[id], 0, 70, 0), true)).toBe(false);
    }
  });

  it('every surface biome has something docile to hunt by day, except the Riftlands', () => {
    for (const b of [0, 1, 2, 4, 5, 6]) {
      expect(Object.values(CREATURES).some(d => d.docile && d.spawn?.biomes?.includes(b))).toBe(true);
    }
  });
});
