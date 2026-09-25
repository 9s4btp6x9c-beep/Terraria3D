import { beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/world/config';
import { WorldGenerator } from '../src/world/generator';
import { Mat } from '../src/world/materials';
import { meshChunk } from '../src/world/mesher';
import { TerrainField } from '../src/world/terrain';

const cfg = defaultConfig(1337);
let gen: WorldGenerator;
let field: TerrainField;

beforeAll(() => {
  const t0 = performance.now();
  gen = new WorldGenerator(cfg);
  field = new TerrainField(cfg);
  gen.generate(field);
  console.log(`generated world in ${(performance.now() - t0).toFixed(0)} ms`);
});

describe('generation', () => {
  it('is deterministic from the seed', () => {
    const g2 = new WorldGenerator(cfg);
    for (const [x, y, z] of [[40, 70, 90], [128, 50, 128], [200, 20, 33]]) {
      expect(g2.densityAt(x, y, z)).toBe(gen.densityAt(x, y, z));
    }
  });

  it('places spawn on dry land in open air', () => {
    const { x, y, z } = gen.spawn;
    expect(y).toBeGreaterThan(cfg.seaLevel);
    expect(field.sample(x, y + 1, z)).toBeLessThan(0);
    // ground within a few metres below
    let found = false;
    for (let d = 0; d < 8; d += 0.25) if (field.sample(x, y - d, z) > 0) { found = true; break; }
    expect(found).toBe(true);
  });

  it('has an open cave entrance tunnel leading underground', () => {
    const last = gen.entrance[gen.entrance.length - 2];
    expect(last.by).toBeLessThan(gen.height(last.bx, last.bz) - 10);
    expect(field.sample(last.bx, last.by, last.bz)).toBeLessThan(0);
  });

  it('contains underground air (caves) and several materials', () => {
    let caveAir = 0;
    const seen = new Set<number>();
    for (let z = 8; z < field.sz - 8; z += 3)
      for (let x = 8; x < field.sx - 8; x += 3)
        for (let y = 6; y < 50; y += 2) {
          if (field.density(x, y, z) <= 0 && y < gen.height(x, z) - 10) caveAir++;
          else seen.add(field.material(x, y, z));
        }
    expect(caveAir).toBeGreaterThan(500);
    expect(seen.has(Mat.Stone)).toBe(true);
    expect(seen.has(Mat.Copper) || seen.has(Mat.Iron)).toBe(true);
  });
});

describe('meshing', () => {
  it('produces surface triangles whose winding faces out of the solid', () => {
    let tris = 0, agree = 0;
    for (const c of field.chunks) {
      const m = meshChunk(field, c.cx, c.cy, c.cz);
      if (!m) continue;
      tris += m.triangleCount;
      const p = m.positions, n = m.normals;
      for (let t = 0; t < m.triangleCount; t += 7) {
        const o = t * 9;
        const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
        const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
        const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
        if (fx * n[o] + fy * n[o + 1] + fz * n[o + 2] > 0) agree++;
      }
      let finite = true;
      for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) finite = false;
      expect(finite).toBe(true);
    }
    expect(tris).toBeGreaterThan(10000);
    expect(agree / Math.ceil(tris / 7)).toBeGreaterThan(0.97);
  });
});

/** Fresh field with only the chunks around a point generated (fast). */
function freshField(x: number, y: number, z: number) {
  const f = new TerrainField(cfg);
  for (const c of f.chunks) {
    if (Math.abs(c.cx * 32 + 16 - x) < 48 && Math.abs(c.cy * 32 + 16 - y) < 48 && Math.abs(c.cz * 32 + 16 - z) < 48) gen.fillChunk(c);
  }
  return f;
}

describe('editing', () => {
  it('mining carves a tunnel, reports removed material and dirties chunks', () => {
    const x = 128, z = 128, y = gen.height(x, z) - 12;
    const f = freshField(x, y, z);
    expect(f.sample(x, y, z)).toBeGreaterThan(0);
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const r = f.sphere(x + i, y, z, 1.6, 'sub');
      for (const v of r.volumes.values()) total += v;
    }
    expect(f.sample(x + 4, y, z)).toBeLessThan(0);
    expect(total).toBeGreaterThan(20);
    expect(f.dirty.size).toBeGreaterThan(0);
  });

  it('never removes unbreakable bedrock', () => {
    const f = freshField(100, 2, 100);
    f.sphere(100, 1.5, 100, 2, 'sub');
    expect(f.density(100, 1, 100)).toBeGreaterThan(0);
  });

  it('add mode deposits material', () => {
    const f = new TerrainField(cfg);
    const p = gen.spawn;
    f.sphere(p.x, p.y + 5, p.z, 1.5, 'add', Mat.Stone);
    expect(f.sample(p.x, p.y + 5, p.z)).toBeGreaterThan(0);
    expect(f.material(Math.round(p.x), Math.round(p.y + 5), Math.round(p.z))).toBe(Mat.Stone);
  });

  it('raycast finds the ground below spawn', () => {
    const p = gen.spawn;
    const hit = field.raycast(p.x, p.y + 1, p.z, 0, -1, 0, 20);
    expect(hit).not.toBeNull();
    expect(hit!.ny).toBeGreaterThan(0.3);
    expect(hit!.material).not.toBe(Mat.Air);
  });
});
