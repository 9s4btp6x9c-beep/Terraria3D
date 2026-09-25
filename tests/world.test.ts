import { beforeAll, describe, expect, it } from 'vitest';
import { type WorldConfig, defaultConfig } from '../src/world/config';
import type { TerrainEdit } from '../src/world/edits';
import { WorldGenerator } from '../src/world/generator';
import { Mat } from '../src/world/materials';
import { meshChunk } from '../src/world/mesher';
import { EditLog } from '../src/world/persistence';
import { TerrainField } from '../src/world/terrain';
import { fillChunk, generateAll, runChunkJob, runLodJob } from '../src/world/terrainJobs';

// A smaller world keeps the suite fast; the generator scales with size.
const cfg: WorldConfig = { ...defaultConfig(1337), chunksX: 8, chunksZ: 8 };
let gen: WorldGenerator;
let field: TerrainField;

beforeAll(() => {
  const t0 = performance.now();
  gen = new WorldGenerator(cfg);
  field = new TerrainField(cfg);
  generateAll(field, gen);
  console.log(`generated world in ${(performance.now() - t0).toFixed(0)} ms`);
});

/** Fresh field with only the chunks around a point generated (fast). */
function freshField(x: number, y: number, z: number, edits: TerrainEdit[] = []) {
  const f = new TerrainField(cfg);
  f.fallback = (a, b, c) => gen.densityAt(a, b, c);
  for (const c of f.chunks) {
    if (Math.abs(c.cx * 32 + 16 - x) < 48 && Math.abs(c.cy * 32 + 16 - y) < 48 && Math.abs(c.cz * 32 + 16 - z) < 48) fillChunk(gen, c, edits);
  }
  return f;
}

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

  it('surfaceAt agrees with the field', () => {
    const s = gen.spawn;
    const surf = gen.surfaceAt(s.x, s.z)!;
    const hit = field.raycast(s.x, surf.y + 5, s.z, 0, -1, 0, 20)!;
    expect(Math.abs(hit.y - surf.y)).toBeLessThan(0.05);
  });
});

describe('meshing', () => {
  it('produces surface triangles whose winding faces out of the solid', () => {
    let tris = 0, agree = 0, checked = 0;
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
        checked++;
      }
      let finite = true;
      for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) finite = false;
      expect(finite).toBe(true);
    }
    expect(tris).toBeGreaterThan(10000);
    expect(agree / checked).toBeGreaterThan(0.97);
  });

  it('worker chunk jobs produce the same mesh as main-thread meshing', () => {
    const c = field.chunks.find(ch => ch.cy === 2 && ch.cx === 3 && ch.cz === 4)!;
    const job = runChunkJob(gen, { kind: 'chunk', id: 1, cx: c.cx, cy: c.cy, cz: c.cz, edits: [], withMesh: true });
    const main = meshChunk(field, c.cx, c.cy, c.cz);
    expect(job.mesh?.triangleCount).toBe(main?.triangleCount);
    expect(Array.from(job.mesh!.positions.slice(0, 30))).toEqual(Array.from(main!.positions.slice(0, 30)));
  });

  it('far LOD jobs build coarse meshes with buried caves culled', () => {
    const full = runLodJob(gen, { kind: 'lod', id: 1, x0: 0, z0: 0, size: 128, edits: [] });
    expect(full.mesh).not.toBeNull();
    const p = full.mesh!.positions;
    let minY = Infinity;
    for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i]);
    // Coarse: far fewer triangles than the full-resolution chunks of that area.
    expect(full.mesh!.triangleCount).toBeLessThan(40000);
    expect(minY).toBeGreaterThan(20);
  });
});

describe('editing', () => {
  it('mining carves a tunnel, reports removed material and dirties chunks', () => {
    const x = 128, z = 128, y = gen.height(x, z) - 12;
    const f = freshField(x, y, z);
    const log = new EditLog(cfg);
    expect(f.sample(x, y, z)).toBeGreaterThan(0);
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const r = log.commit(f, 'sub', x + i, y, z, 1.6, 0, 99);
      for (const v of r.volumes.values()) total += v;
    }
    expect(f.sample(x + 4, y, z)).toBeLessThan(0);
    expect(total).toBeGreaterThan(20);
    expect(f.dirty.size).toBeGreaterThan(0);
  });

  it('never removes unbreakable bedrock', () => {
    const f = freshField(100, 2, 100);
    new EditLog(cfg).commit(f, 'sub', 100, 1.5, 100, 2, 0, 99);
    expect(f.density(100, 1, 100)).toBeGreaterThan(0);
  });

  it('add mode deposits material', () => {
    const p = gen.spawn;
    const f = freshField(p.x, p.y, p.z);
    new EditLog(cfg).commit(f, 'add', p.x, p.y + 5, p.z, 1.5, Mat.Stone, 99);
    expect(f.sample(p.x, p.y + 5, p.z)).toBeGreaterThan(0);
    expect(f.material(Math.round(p.x), Math.round(p.y + 5), Math.round(p.z))).toBe(Mat.Stone);
  });

  it('streamed chunks replay edits identically to live edits (incl. across chunk borders)', () => {
    const x = 96, z = 96, y = gen.height(x, z) - 3; // on a chunk corner
    const live = freshField(x, y, z);
    const log = new EditLog(cfg);
    for (let i = 0; i < 5; i++) log.commit(live, 'sub', x - 2 + i * 0.9, y - i * 0.3, z + i * 0.2, 1.35, 0, 0);
    log.commit(live, 'add', x + 1, y + 1, z, 1.1, Mat.Clay, 99);
    for (const c of live.chunks) {
      if (!c.resident) continue;
      const res = runChunkJob(gen, { kind: 'chunk', id: 0, cx: c.cx, cy: c.cy, cz: c.cz, edits: log.forChunk(c.cx, c.cy, c.cz), withMesh: false });
      for (let i = 0; i < 32 * 32 * 32; i += 7) {
        const d = res.density ? res.density[i] : res.uniformDensity;
        const m = res.mat ? res.mat[i] : res.uniformMat;
        const ld = c.density ? c.density[i] : c.uniformDensity;
        const lm = c.mat ? c.mat[i] : c.uniformMat;
        if (d !== ld || m !== lm) throw new Error(`mismatch in chunk ${c.cx},${c.cy},${c.cz} at ${i}: ${d}/${ld} ${m}/${lm}`);
      }
    }
  });

  it('raycast finds the ground below spawn', () => {
    const p = gen.spawn;
    const hit = field.raycast(p.x, p.y + 1, p.z, 0, -1, 0, 20);
    expect(hit).not.toBeNull();
    expect(hit!.ny).toBeGreaterThan(0.3);
    expect(hit!.material).not.toBe(Mat.Air);
  });
});
