import { beforeAll, describe, expect, it } from 'vitest';
import { LEGACY_CHUNKS, defaultConfig, worldSize } from '../src/world/config';
import { BIOME_NAMES, Biome, WorldGenerator } from '../src/world/generator';
import { Mat } from '../src/world/materials';

// The full-size world: every biome needs room to appear.
let gen: WorldGenerator;
beforeAll(() => { gen = new WorldGenerator(defaultConfig(1337)); });

describe('biomes', () => {
  it('new worlds are 768 m across; legacy saves keep 512 m', () => {
    expect(worldSize(defaultConfig(1)).x).toBe(768);
    expect(worldSize(defaultConfig(1, LEGACY_CHUNKS)).x).toBe(512);
  });

  it('every biome appears on dry land, and spawn is Greenhollow', () => {
    const seen = new Set<number>();
    for (let z = 20; z < gen.size.z; z += 6)
      for (let x = 20; x < gen.size.x; x += 6)
        if (gen.height(x, z) > gen.cfg.seaLevel) seen.add(gen.biomeAt(x, z));
    expect([...seen].sort()).toEqual(BIOME_NAMES.map((_, i) => i));
    expect(gen.biomeAt(gen.spawn.x, gen.spawn.z)).toBe(Biome.Forest);
  });

  it('places root arches, titan skeletons and amber nodules in their biomes', () => {
    const by = (m: number) => gen.features.filter(f => f.mat === m);
    for (const [mat, biome] of [[Mat.Rootwood, Biome.Rootwold], [Mat.Fossil, Biome.Ossuary], [Mat.Amber, Biome.Amberwood]]) {
      const list = by(mat);
      expect(list.length).toBeGreaterThan(10);
      const inside = list.filter(f => gen.biomeAt((f.ax + f.bx) / 2, (f.az + f.bz) / 2) === biome).length;
      expect(inside / list.length).toBeGreaterThan(0.8);
    }
  });

  it('features are solid, carry their own material, and arches leave open air beneath', () => {
    const arch = gen.features.filter(f => f.mat === Mat.Rootwood).sort((a, b) => (b.ay + b.by) - (a.ay + a.by))[0];
    const [x, y, z] = [(arch.ax + arch.bx) / 2, (arch.ay + arch.by) / 2, (arch.az + arch.bz) / 2];
    expect(gen.densityAt(x, y, z)).toBeGreaterThan(0);
    expect([Mat.Rootwood, Mat.Moss]).toContain(gen.materialFor(x, y, z, 2, 0));
    // Somewhere between the ground and the top of the arch is open air.
    const ground = gen.height(x, z);
    let air = false;
    for (let yy = ground + 2; yy < y - 2; yy += 0.5) if (gen.densityAt(x, yy, z) < 0) air = true;
    expect(air).toBe(true);
    // Regions containing features are never skipped as empty sky.
    expect(gen.featureTop(x - 1, z - 1, x + 1, z + 1)).toBeGreaterThan(y);
  });

  it('each new biome has its own surface', () => {
    const surfaces = new Map<number, Set<number>>();
    for (let z = 20; z < gen.size.z; z += 9)
      for (let x = 20; x < gen.size.x; x += 9) {
        const b = gen.biomeAt(x, z);
        if (b < Biome.Rootwold || gen.featureAt(x, gen.height(x, z), z)) continue;
        const s = gen.surfaceAt(x, z);
        if (!s || s.ny < 0.8 || s.y < gen.cfg.seaLevel + 3) continue;
        (surfaces.get(b) ?? surfaces.set(b, new Set()).get(b)!).add(s.mat);
      }
    expect(surfaces.get(Biome.Rootwold)).toContain(Mat.Moss);
    expect(surfaces.get(Biome.Ossuary)).toContain(Mat.Salt);
    expect(surfaces.get(Biome.Amberwood)).toContain(Mat.Leaflitter);
  });
});

describe('volcanoes', () => {
  it('raises volcanoes away from spawn, each with a crater bowl below its rim', () => {
    expect(gen.volcanoes.length).toBeGreaterThanOrEqual(1);
    for (const v of gen.volcanoes) {
      expect(Math.hypot(v.x - gen.spawn.x, v.z - gen.spawn.z)).toBeGreaterThan(v.r + 40);
      expect(gen.height(v.x, v.z)).toBeLessThan(v.rim - 6);
      expect(gen.height(v.x + v.rc + 3, v.z)).toBeGreaterThan(v.foot + 20);
      expect(v.lavaLevel).toBeLessThan(v.rim);
      expect(gen.biomeAt(v.x + v.r * 0.5, v.z)).toBe(Biome.Volcano);
    }
  });

  it('volcanoes are made of ash, basalt and glowing magma rock, with an open lava tube inside', () => {
    const v = gen.volcanoes[0];
    const sx = v.x + v.r * 0.55, sz = v.z;
    expect([Mat.Ash, Mat.Basalt, Mat.Magmarock]).toContain(gen.materialFor(sx, gen.height(sx, sz) - 0.5, sz, 0, 1));
    // Sky islands drifting over a volcano keep their own rock.
    for (const isl of gen.islands.filter(i => gen.volcanoAt(i.x, i.z)))
      expect([Mat.Ash, Mat.Basalt, Mat.Magmarock, Mat.Obsidian]).not.toContain(gen.materialFor(isl.x, isl.y - 2, isl.z, 2, 0));
    expect([Mat.Magmarock, Mat.Obsidian, Mat.Basalt]).toContain(gen.materialFor(v.x, gen.height(v.x, v.z) - 1, v.z, 2, 1));
    const c = v.chamber;
    expect(gen.densityAt(c.x, c.y, c.z)).toBeLessThan(0); // the magma chamber is hollow
    const mid = gen.tubes[Math.floor(gen.tubes.length / (gen.volcanoes.length * 2))];
    expect(gen.densityAt((mid.ax + mid.bx) / 2, (mid.ay + mid.by) / 2, (mid.az + mid.bz) / 2)).toBeLessThan(0);
  });
});
