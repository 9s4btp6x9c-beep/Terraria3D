// TerrainField: the authoritative, editable representation of the world's
// solid matter near the player. A signed density per sample point (positive =
// solid, roughly metres to the surface) plus a material id, stored in 32³
// chunks that stream in and out around the player. Queries interpolate
// trilinearly so collision, raycasts and the rendered mesh agree on one
// smooth surface. Non-resident space falls back to the pure generator.

import { CHUNK, type WorldConfig, worldSize } from './config';
import { DENSITY_CLAMP, type TerrainEdit, editBounds, editSample } from './edits';
import { Mat } from './materials';

export { DENSITY_CLAMP } from './edits';
const CHUNK3 = CHUNK * CHUNK * CHUNK;

export class Chunk {
  /** Null while the chunk is uniform (all air or all one solid material). */
  density: Float32Array | null = null;
  mat: Uint8Array | null = null;
  uniformDensity = -DENSITY_CLAMP;
  uniformMat = Mat.Air as number;
  /** Data is loaded (generated + edits replayed). */
  resident = false;

  constructor(readonly cx: number, readonly cy: number, readonly cz: number) {}

  materialize() {
    if (this.density) return;
    this.density = new Float32Array(CHUNK3).fill(this.uniformDensity);
    this.mat = new Uint8Array(CHUNK3).fill(this.uniformMat);
  }

  /** Collapse to uniform storage when possible (saves memory). */
  compact() {
    const d = this.density, m = this.mat;
    if (!d || !m) return;
    const d0 = d[0], m0 = m[0];
    for (let i = 1; i < CHUNK3; i++) if (d[i] !== d0 || m[i] !== m0) return;
    this.uniformDensity = d0;
    this.uniformMat = m0;
    this.density = null;
    this.mat = null;
  }

  unload() {
    this.density = null;
    this.mat = null;
    this.resident = false;
  }
}

export interface RayHit {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  distance: number;
  material: number;
}

export interface EditResult {
  /** Removed (or added, negative) volume per material id, in cubic metres. */
  volumes: Map<number, number>;
  dirtyChunks: Set<number>;
}

export type DensityFallback = (x: number, y: number, z: number) => number;

export class TerrainField {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly chunks: Chunk[] = [];
  /** Chunk indices whose meshes are stale. */
  readonly dirty = new Set<number>();
  /** Density for space whose chunk is not resident (the pure generator). */
  fallback: DensityFallback = () => -DENSITY_CLAMP;

  constructor(readonly cfg: WorldConfig) {
    const s = worldSize(cfg);
    this.sx = s.x; this.sy = s.y; this.sz = s.z;
    for (let cz = 0; cz < cfg.chunksZ; cz++)
      for (let cy = 0; cy < cfg.chunksY; cy++)
        for (let cx = 0; cx < cfg.chunksX; cx++)
          this.chunks.push(new Chunk(cx, cy, cz));
  }

  get x() { return this.sx; }
  get y() { return this.sy; }
  get z() { return this.sz; }

  chunkIndex(cx: number, cy: number, cz: number): number {
    return cx + this.cfg.chunksX * (cy + this.cfg.chunksY * cz);
  }

  chunkAt(cx: number, cy: number, cz: number): Chunk | undefined {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.cfg.chunksX || cy >= this.cfg.chunksY || cz >= this.cfg.chunksZ) return undefined;
    return this.chunks[this.chunkIndex(cx, cy, cz)];
  }

  inBounds(ix: number, iy: number, iz: number) {
    return ix >= 0 && iy >= 0 && iz >= 0 && ix < this.sx && iy < this.sy && iz < this.sz;
  }

  isResident(x: number, y: number, z: number) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    if (!this.inBounds(ix, iy, iz)) return true;
    return this.chunks[this.chunkIndex(ix >> 5, iy >> 5, iz >> 5)].resident;
  }

  /** Density at an integer sample; outside the world is air. */
  density(ix: number, iy: number, iz: number): number {
    if (!this.inBounds(ix, iy, iz)) return -DENSITY_CLAMP;
    const c = this.chunks[this.chunkIndex(ix >> 5, iy >> 5, iz >> 5)];
    if (!c.resident) return this.fallback(ix, iy, iz);
    if (!c.density) return c.uniformDensity;
    return c.density[(ix & 31) + ((iy & 31) << 5) + ((iz & 31) << 10)];
  }

  material(ix: number, iy: number, iz: number): number {
    if (!this.inBounds(ix, iy, iz)) return Mat.Air;
    const c = this.chunks[this.chunkIndex(ix >> 5, iy >> 5, iz >> 5)];
    if (!c.resident) return Mat.Stone;
    if (!c.mat) return c.uniformMat;
    return c.mat[(ix & 31) + ((iy & 31) << 5) + ((iz & 31) << 10)];
  }

  set(ix: number, iy: number, iz: number, d: number, m: number) {
    if (!this.inBounds(ix, iy, iz)) return;
    const c = this.chunks[this.chunkIndex(ix >> 5, iy >> 5, iz >> 5)];
    if (!c.resident) return;
    c.materialize();
    const i = (ix & 31) + ((iy & 31) << 5) + ((iz & 31) << 10);
    c.density![i] = d;
    c.mat![i] = m;
  }

  /** Trilinear density at an arbitrary point (metres). */
  sample(x: number, y: number, z: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const d000 = this.density(x0, y0, z0), d100 = this.density(x0 + 1, y0, z0);
    const d010 = this.density(x0, y0 + 1, z0), d110 = this.density(x0 + 1, y0 + 1, z0);
    const d001 = this.density(x0, y0, z0 + 1), d101 = this.density(x0 + 1, y0, z0 + 1);
    const d011 = this.density(x0, y0 + 1, z0 + 1), d111 = this.density(x0 + 1, y0 + 1, z0 + 1);
    const a = d000 + (d100 - d000) * fx, b = d010 + (d110 - d010) * fx;
    const c = d001 + (d101 - d001) * fx, d = d011 + (d111 - d011) * fx;
    const e = a + (b - a) * fy, f = c + (d - c) * fy;
    return e + (f - e) * fz;
  }

  /** Gradient of the density (points into solid). */
  gradient(x: number, y: number, z: number, out: [number, number, number]) {
    const h = 0.25;
    out[0] = (this.sample(x + h, y, z) - this.sample(x - h, y, z)) / (2 * h);
    out[1] = (this.sample(x, y + h, z) - this.sample(x, y - h, z)) / (2 * h);
    out[2] = (this.sample(x, y, z + h) - this.sample(x, y, z - h)) / (2 * h);
    return out;
  }

  /** Material of the solid sample nearest to a point (for hits on the surface). */
  materialNear(x: number, y: number, z: number): number {
    let best = Mat.Air as number, bestD = Infinity;
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    for (let dz = -1; dz <= 2; dz++)
      for (let dy = -1; dy <= 2; dy++)
        for (let dx = -1; dx <= 2; dx++) {
          const ix = x0 + dx, iy = y0 + dy, iz = z0 + dz;
          if (this.density(ix, iy, iz) <= 0) continue;
          const dd = (ix - x) ** 2 + (iy - y) ** 2 + (iz - z) ** 2;
          if (dd < bestD) { bestD = dd; best = this.material(ix, iy, iz); }
        }
    return best;
  }

  /** March a ray through the field; returns the first surface crossing. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, step = 0.2): RayHit | null {
    let prevT = 0;
    if (this.sample(ox, oy, oz) > 0) return null; // started inside solid
    for (let t = step; t <= maxDist; t += step) {
      const v = this.sample(ox + dx * t, oy + dy * t, oz + dz * t);
      if (v > 0) {
        let lo = prevT, hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) * 0.5;
          if (this.sample(ox + dx * mid, oy + dy * mid, oz + dz * mid) > 0) hi = mid; else lo = mid;
        }
        const x = ox + dx * lo, y = oy + dy * lo, z = oz + dz * lo;
        const g: [number, number, number] = [0, 0, 0];
        this.gradient(x, y, z, g);
        const len = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;
        return { x, y, z, nx: -g[0] / len, ny: -g[1] / len, nz: -g[2] / len, distance: lo, material: this.materialNear(x, y, z) };
      }
      prevT = t;
    }
    return null;
  }

  /**
   * Approximate signed distance from a point to the surface (positive in air).
   * The stored density is not an exact distance, so normalise by the gradient.
   */
  distance(x: number, y: number, z: number, gradOut: [number, number, number]): number {
    const v = this.sample(x, y, z);
    this.gradient(x, y, z, gradOut);
    const len = Math.sqrt(gradOut[0] * gradOut[0] + gradOut[1] * gradOut[1] + gradOut[2] * gradOut[2]);
    if (len < 1e-4) return v > 0 ? -DENSITY_CLAMP : DENSITY_CLAMP;
    gradOut[0] /= len; gradOut[1] /= len; gradOut[2] /= len;
    return -v / Math.max(len, 0.5);
  }

  /**
   * Apply a CSG edit to resident chunks, optionally restricted to one chunk.
   * Reports volume removed/added per material and the chunks needing remesh.
   */
  applyEdit(e: TerrainEdit, onlyChunk = -1): EditResult {
    const volumes = new Map<number, number>();
    const dirtyChunks = new Set<number>();
    const b = editBounds(e, this);
    const out: [number] = [0];
    const sub = e[0] !== 1;
    for (let iz = b[2]; iz <= b[5]; iz++)
      for (let iy = b[1]; iy <= b[4]; iy++)
        for (let ix = b[0]; ix <= b[3]; ix++) {
          const ci = this.chunkIndex(ix >> 5, iy >> 5, iz >> 5);
          if (onlyChunk >= 0 && ci !== onlyChunk) continue;
          if (!this.chunks[ci].resident) continue;
          const dx = ix - e[1], dy = iy - e[2], dz = iz - e[3];
          const old = this.density(ix, iy, iz);
          const m = this.material(ix, iy, iz);
          const nd = editSample(old, m, dx, dy, dz, e, out);
          if (Number.isNaN(nd)) continue;
          const before = solidity(old), after = solidity(nd);
          if (before !== after) {
            const key = sub ? m : out[0];
            volumes.set(key, (volumes.get(key) ?? 0) + (before - after));
          }
          this.set(ix, iy, iz, nd, out[0]);
          this.markDirtyAround(ix, iy, iz, dirtyChunks);
        }
    for (const i of dirtyChunks) this.dirty.add(i);
    return { volumes, dirtyChunks };
  }

  /** A sample affects the mesh of its own chunk and of neighbours touching it. */
  private markDirtyAround(ix: number, iy: number, iz: number, out: Set<number>) {
    const cx = ix >> 5, cy = iy >> 5, cz = iz >> 5;
    const lx = ix & 31, ly = iy & 31, lz = iz & 31;
    const xs = lx <= 1 ? [cx, cx - 1] : lx >= 30 ? [cx, cx + 1] : [cx];
    const ys = ly <= 1 ? [cy, cy - 1] : ly >= 30 ? [cy, cy + 1] : [cy];
    const zs = lz <= 1 ? [cz, cz - 1] : lz >= 30 ? [cz, cz + 1] : [cz];
    for (const x of xs) for (const y of ys) for (const z of zs) {
      const c = this.chunkAt(x, y, z);
      if (c?.resident) out.add(this.chunkIndex(x, y, z));
    }
  }
}

/** How "full" a sample is, 0..1, used for volume accounting. */
function solidity(d: number) {
  return Math.max(0, Math.min(1, d + 0.5));
}
