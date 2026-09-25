// Deterministic procedural world generation. Produces a continuous density
// field: a heightfield for broad landforms, 3D noise for overhangs and cliffs,
// carved tunnel/cavern systems, a guaranteed cave entrance near spawn and a
// few floating sky islands. Materials are chosen from depth, exposure, slope
// and ore noise.

import { SimplexNoise, mulberry32 } from '../core/noise';
import { CHUNK, type WorldConfig, worldSize } from './config';
import { Mat } from './materials';
import { type Chunk, DENSITY_CLAMP, type TerrainField } from './terrain';

interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number }
interface Island { x: number; y: number; z: number; r: number; depth: number }

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class WorldGenerator {
  readonly size: { x: number; y: number; z: number };
  private hills: SimplexNoise;
  private ridges: SimplexNoise;
  private mask: SimplexNoise;
  private warp: SimplexNoise;
  private caveA: SimplexNoise;
  private caveB: SimplexNoise;
  private cavern: SimplexNoise;
  private ore: SimplexNoise;
  private detail: SimplexNoise;
  private heights: Float32Array;
  private mountainMask: Float32Array;
  readonly entrance: Capsule[] = [];
  readonly islands: Island[] = [];
  /** AABB (min xyz, max xyz) around the entrance tunnel, padded. */
  private entranceBounds = [0, 0, 0, 0, 0, 0];
  spawn = { x: 0, y: 0, z: 0 };

  constructor(readonly cfg: WorldConfig) {
    const s = cfg.seed;
    this.size = worldSize(cfg);
    this.hills = new SimplexNoise(s + 1);
    this.ridges = new SimplexNoise(s + 2);
    this.mask = new SimplexNoise(s + 3);
    this.warp = new SimplexNoise(s + 4);
    this.caveA = new SimplexNoise(s + 5);
    this.caveB = new SimplexNoise(s + 6);
    this.cavern = new SimplexNoise(s + 7);
    this.ore = new SimplexNoise(s + 8);
    this.detail = new SimplexNoise(s + 9);

    const w = this.size.x + 1, d = this.size.z + 1;
    this.heights = new Float32Array(w * d);
    this.mountainMask = new Float32Array(w * d);
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        const [h, m] = this.computeHeight(x, z);
        this.heights[x + z * w] = h;
        this.mountainMask[x + z * w] = m;
      }
    this.placeSpawnAndEntrance();
    this.placeIslands();
  }

  // ---------------------------------------------------------------- landforms

  private computeHeight(x: number, z: number): [number, number] {
    const { x: W, z: D } = this.size;
    const sea = this.cfg.seaLevel;
    let h = 70 + this.hills.fbm2(x / 150, z / 150, 4) * 9 + this.hills.fbm2(x / 40 + 31, z / 40, 2) * 2.5;
    const m = smoothstep(0.05, 0.45, this.mask.fbm2(x / 230 + 17, z / 230 - 9, 3));
    const r = this.ridges.ridged2(x / 120, z / 120, 4);
    h += m * Math.pow(r, 2.2) * 62;
    // Soft terracing gives cliff bands on hillsides.
    const step = 7;
    const t = Math.floor(h / step) * step;
    const frac = (h - t) / step;
    h = h * 0.6 + (t + smoothstep(0.35, 0.65, frac) * step) * 0.4;
    // Ocean ring around the island-shaped world.
    const nx = (x / W) * 2 - 1, nz = (z / D) * 2 - 1;
    const edge = smoothstep(0.72, 0.97, Math.max(Math.abs(nx), Math.abs(nz)) + this.mask.noise2(x / 60, z / 60) * 0.05);
    h = h * (1 - edge) + (sea - 14) * edge;
    return [h, m * (1 - edge)];
  }

  /** Heightfield value (bilinear) — the broad landform, ignoring caves/overhangs. */
  height(x: number, z: number): number {
    const w = this.size.x + 1;
    const cx = Math.max(0, Math.min(this.size.x - 1e-3, x)), cz = Math.max(0, Math.min(this.size.z - 1e-3, z));
    const x0 = Math.floor(cx), z0 = Math.floor(cz), fx = cx - x0, fz = cz - z0;
    const i = x0 + z0 * w;
    const a = this.heights[i] + (this.heights[i + 1] - this.heights[i]) * fx;
    const b = this.heights[i + w] + (this.heights[i + w + 1] - this.heights[i + w]) * fx;
    return a + (b - a) * fz;
  }

  private placeSpawnAndEntrance() {
    const rand = mulberry32(this.cfg.seed ^ 0xabcdef);
    const cx = this.size.x / 2, cz = this.size.z / 2;
    // Find dry, fairly flat land near the centre.
    let best = { x: cx, z: cz, score: -Infinity };
    for (let i = 0; i < 400; i++) {
      const a = rand() * Math.PI * 2, d = rand() * 50;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const h = this.height(x, z);
      const slope = Math.abs(this.height(x + 2, z) - this.height(x - 2, z)) + Math.abs(this.height(x, z + 2) - this.height(x, z - 2));
      const score = (h > this.cfg.seaLevel + 3 ? 0 : -100) - slope * 3 - d * 0.05 - Math.max(0, h - 90);
      if (score > best.score) best = { x, z, score };
    }
    this.spawn = { x: best.x, y: this.height(best.x, best.z) + 2, z: best.z };

    // A winding tunnel from the surface ~20m from spawn down into the caves.
    const dir = rand() * Math.PI * 2;
    let x = best.x + Math.cos(dir) * 20, z = best.z + Math.sin(dir) * 20;
    let y = this.height(x, z) + 2;
    let yaw = dir + (rand() - 0.5);
    let pitch = -0.45;
    for (let i = 0; i < 16; i++) {
      const len = 5 + rand() * 3;
      const nx = x + Math.cos(yaw) * Math.cos(pitch) * len;
      const ny = Math.max(30, y + Math.sin(pitch) * len);
      const nz = z + Math.sin(yaw) * Math.cos(pitch) * len;
      const r = i < 2 ? 3.2 : 2.4 + rand() * 1.2;
      this.entrance.push({ ax: x, ay: y, az: z, bx: nx, by: ny, bz: nz, r });
      x = nx; y = ny; z = nz;
      yaw += (rand() - 0.5) * 0.9;
      pitch = Math.max(-0.7, Math.min(-0.1, pitch + (rand() - 0.5) * 0.4));
    }
    // End in a chamber.
    this.entrance.push({ ax: x, ay: y, az: z, bx: x + 4, by: y + 1, bz: z + 3, r: 6 });
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const c of this.entrance) {
      b[0] = Math.min(b[0], c.ax - c.r, c.bx - c.r); b[3] = Math.max(b[3], c.ax + c.r, c.bx + c.r);
      b[1] = Math.min(b[1], c.ay - c.r, c.by - c.r); b[4] = Math.max(b[4], c.ay + c.r, c.by + c.r);
      b[2] = Math.min(b[2], c.az - c.r, c.bz - c.r); b[5] = Math.max(b[5], c.az + c.r, c.bz + c.r);
    }
    this.entranceBounds = [b[0] - 4, b[1] - 4, b[2] - 4, b[3] + 4, b[4] + 4, b[5] + 4];
  }

  private placeIslands() {
    const rand = mulberry32(this.cfg.seed ^ 0x51a7);
    const top = this.size.y - 14;
    for (let i = 0, tries = 0; i < 3 && tries < 200; tries++) {
      const a = (i / 3) * Math.PI * 2 + rand() * 1.5;
      const d = 50 + rand() * 40;
      const x = this.size.x / 2 + Math.cos(a) * d, z = this.size.z / 2 + Math.sin(a) * d;
      const r = 11 + rand() * 7;
      // Keep islands clear of mountain tops so they read as floating.
      let ground = 0;
      for (let k = 0; k < 8; k++) ground = Math.max(ground, this.height(x + Math.cos(k) * r, z + Math.sin(k) * r), this.height(x, z));
      if (ground > 100) continue;
      this.islands.push({ x, z, y: top - rand() * 6, r, depth: 11 + rand() * 5 });
      i++;
    }
  }

  // ------------------------------------------------------------------ density

  /** Density at a point (positive = solid). Pure function of the seed. */
  densityAt(x: number, y: number, z: number): number {
    const { x: W, y: H, z: D } = this.size;
    if (x <= 0 || z <= 0 || y <= 0 || x >= W - 1 || z >= D - 1 || y >= H - 1) return -DENSITY_CLAMP;
    const h = this.height(x, z);
    let d = h - y;
    // Overhangs, spires and cliff breakup near the surface.
    if (Math.abs(d) < 14) {
      const mi = Math.floor(x) + Math.floor(z) * (W + 1);
      const amp = 2.5 + this.mountainMask[mi] * 7;
      d += this.warp.noise3(x / 22, y / 16, z / 22) * amp + this.warp.noise3(x / 7, y / 7, z / 7) * 0.8;
    }
    if (y < 4) d = Math.max(d, 4 - y); // bedrock floor stays solid
    if (d > -2) d = Math.min(d, this.caves(x, y, z, h));
    let tunnel = Infinity;
    const eb = this.entranceBounds;
    if (x > eb[0] && x < eb[3] && y > eb[1] && y < eb[4] && z > eb[2] && z < eb[5])
      for (const c of this.entrance) tunnel = Math.min(tunnel, capsuleDist(x, y, z, c) - c.r);
    if (tunnel < 3) d = Math.min(d, tunnel - this.detail.noise3(x / 5, y / 5, z / 5) * 0.8);
    for (const isl of this.islands) d = Math.max(d, this.islandDensity(x, y, z, isl));
    return Math.max(-DENSITY_CLAMP, Math.min(DENSITY_CLAMP, d));
  }

  private caves(x: number, y: number, z: number, h: number): number {
    if (y < 6) return DENSITY_CLAMP;
    const depth = h - y;
    // Spaghetti tunnels: intersection of two noise iso-surfaces.
    const a = this.caveA.noise3(x / 55, y / 30, z / 55);
    const b = this.caveB.noise3(x / 55, y / 30, z / 55);
    const t = Math.sqrt(a * a + b * b);
    // Tunnels only break the surface where the entrance mask allows it.
    const surfaceOpen = this.mask.noise2(x / 45 + 70, z / 45) > 0.45;
    const fade = surfaceOpen ? 1 : smoothstep(2, 10, depth);
    let cave = (t - 0.075 * fade) * 36;
    // Large caverns at depth.
    if (depth > 18) {
      const c = this.cavern.noise3(x / 60, y / 38, z / 60) + this.cavern.noise3(x / 19, y / 19, z / 19) * 0.15;
      const k = smoothstep(18, 32, depth);
      cave = Math.min(cave, (0.5 - c * k) * 28);
    }
    return cave;
  }

  private islandDensity(x: number, y: number, z: number, isl: Island): number {
    const dx = x - isl.x, dz = z - isl.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > isl.r + 6 || y > isl.y + 6 || y < isl.y - isl.depth - 4) return -DENSITY_CLAMP;
    const topY = isl.y + this.hills.noise2(x / 9, z / 9) * 1.2;
    const bottom = isl.y - isl.depth;
    const k = Math.max(0, (y - bottom) / (topY - bottom));
    const radius = isl.r * Math.pow(k, 0.55) + this.warp.noise3(x / 6, y / 6, z / 6) * 1.5;
    return Math.min(topY - y, radius - dist);
  }

  // ---------------------------------------------------------------- materials

  private materialFor(x: number, y: number, z: number, exposure: number, normalY: number): number {
    const h = this.height(x, z);
    const depth = h - y;
    if (y < 3 + this.detail.noise2(x / 5, z / 5) * 1.5) return Mat.Bedrock;
    const nearSurface = depth < 8 || y > this.size.y - 40;
    if (nearSurface && exposure < 1.5) {
      if (normalY < 0.55) {
        // Cliff faces: stone with bands of dirt/clay strata.
        const band = Math.sin(y * 0.9 + this.detail.noise2(x / 30, z / 30) * 3);
        return band > 0.55 ? Mat.Dirt : band < -0.8 ? Mat.Clay : Mat.Stone;
      }
      if (y < this.cfg.seaLevel + 2.5 && y < this.size.y - 40) return Mat.Sand;
      if (y > 108 + this.detail.noise2(x / 20, z / 20) * 6 && y < this.size.y - 40) return Mat.Snow;
      if (normalY < 0.75 && this.detail.noise2(x / 6, z / 6) > 0.35) return Mat.Stone;
      return Mat.Grass;
    }
    const dirtDepth = 3 + this.detail.noise2(x / 18, z / 18) * 2;
    if (nearSurface && exposure < dirtDepth) {
      if (y < this.cfg.seaLevel + 1.5) return Mat.Sand;
      return Mat.Dirt;
    }
    if (depth > 4 && this.ore.noise3(x / 6, y / 6, z / 6) > 0.62) return y < 75 ? Mat.Copper : Mat.Stone;
    if (y < 48 && this.ore.noise3(x / 7 + 40, y / 7, z / 7) > 0.64) return Mat.Iron;
    if (y < 36 && this.ore.noise3(x / 5 - 40, y / 5, z / 5) > 0.7) return Mat.Lumite;
    if (depth > 5 && depth < 25 && this.detail.noise3(x / 25, y / 12, z / 25) > 0.55) return Mat.Clay;
    const deep = 30 + this.detail.noise2(x / 40, z / 40) * 5;
    return y < deep ? Mat.Deepstone : Mat.Stone;
  }

  // ------------------------------------------------------------------ filling

  fillChunk(chunk: Chunk) {
    const ox = chunk.cx * CHUNK, oy = chunk.cy * CHUNK, oz = chunk.cz * CHUNK;
    // Fast path: chunk entirely above everything.
    let maxH = -Infinity;
    for (let z = oz; z <= oz + CHUNK; z += 4)
      for (let x = ox; x <= ox + CHUNK; x += 4) maxH = Math.max(maxH, this.height(x, z));
    const islandHere = this.islands.some(i => oy + CHUNK > i.y - i.depth - 6 && oy < i.y + 6);
    if (oy > maxH + 16 && !islandHere) {
      chunk.uniformDensity = -DENSITY_CLAMP;
      chunk.uniformMat = Mat.Air;
      return;
    }

    chunk.materialize();
    const dens = chunk.density!, mats = chunk.mat!;
    for (let lz = 0; lz < CHUNK; lz++)
      for (let ly = 0; ly < CHUNK; ly++)
        for (let lx = 0; lx < CHUNK; lx++)
          dens[lx + (ly << 5) + (lz << 10)] = this.densityAt(ox + lx, oy + ly, oz + lz);

    // Materials, top-down per column so we know how far each sample is below air.
    const idx = (lx: number, ly: number, lz: number) => lx + (ly << 5) + (lz << 10);
    const dAt = (lx: number, ly: number, lz: number) => {
      if (lx < 0 || ly < 0 || lz < 0 || lx >= CHUNK || ly >= CHUNK || lz >= CHUNK) return this.densityAt(ox + lx, oy + ly, oz + lz);
      return dens[idx(lx, ly, lz)];
    };
    for (let lz = 0; lz < CHUNK; lz++)
      for (let lx = 0; lx < CHUNK; lx++) {
        let exposure = 0;
        for (let k = 4; k >= 1; k--) {
          if (this.densityAt(ox + lx, oy + CHUNK - 1 + k, oz + lz) <= 0) { exposure = k - 1; break; }
          exposure = 99;
        }
        if (exposure === 99) exposure = 5;
        for (let ly = CHUNK - 1; ly >= 0; ly--) {
          const i = idx(lx, ly, lz);
          const d = dens[i];
          if (d <= 0) { exposure = 0; mats[i] = Mat.Air; continue; }
          exposure += 1;
          let ny = 1;
          if (exposure < 3) {
            const gx = dAt(lx + 1, ly, lz) - dAt(lx - 1, ly, lz);
            const gy = dAt(lx, ly + 1, lz) - dAt(lx, ly - 1, lz);
            const gz = dAt(lx, ly, lz + 1) - dAt(lx, ly, lz - 1);
            const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
            ny = -gy / len;
          }
          mats[i] = this.materialFor(ox + lx, oy + ly, oz + lz, exposure - 1, ny);
        }
      }
    chunk.compact();
  }

  generate(field: TerrainField) {
    for (const c of field.chunks) this.fillChunk(c);
  }
}

function capsuleDist(x: number, y: number, z: number, c: Capsule): number {
  const bax = c.bx - c.ax, bay = c.by - c.ay, baz = c.bz - c.az;
  const pax = x - c.ax, pay = y - c.ay, paz = z - c.az;
  const t = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const ex = pax - bax * t, ey = pay - bay * t, ez = paz - baz * t;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}
