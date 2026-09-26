// SkyMap: per-column height of the topmost "ground" surface, blurred. Shaders
// compare a fragment's height against it to decide how much open sky it sees,
// which makes caves and overhangs dark without any per-vertex baking.
// Floating islands and thin overhead features (root arches, giant ribs) are
// skipped so the ground beneath them stays lit.

import type { TerrainField } from './terrain';

const BLUR = 3;
const ISLAND_MIN_Y = 118;

export class SkyMap {
  readonly w: number;
  readonly d: number;
  readonly raw: Float32Array;
  readonly blurred: Float32Array;
  private tmp: Float32Array;
  /** Incremented whenever `blurred` changes (renderer re-uploads). */
  version = 0;

  /**
   * `approxTop` seeds every column (e.g. the generator's landform height);
   * exact values are computed from the field as chunk columns stream in.
   */
  constructor(private field: TerrainField, approxTop: (x: number, z: number) => number,
    private overhead: (x: number, y: number, z: number) => boolean = () => false) {
    this.w = field.sx; this.d = field.sz;
    this.raw = new Float32Array(this.w * this.d);
    this.blurred = new Float32Array(this.w * this.d);
    this.tmp = new Float32Array(this.w * this.d);
    for (let z = 0; z < this.d; z++)
      for (let x = 0; x < this.w; x++) this.raw[x + z * this.w] = approxTop(x, z);
    this.reblur(0, 0, this.w - 1, this.d - 1);
  }

  private columnTop(x: number, z: number): number {
    const f = this.field;
    let y = f.sy - 1;
    while (y > 0) {
      if (f.density(x, y, z) > 0 && !this.overhead(x, y, z)) {
        // Solid run; if it is a floating island (high, with a big air gap below) skip it.
        let bottom = y;
        while (bottom > 0 && f.density(x, bottom - 1, z) > 0 && !this.overhead(x, bottom - 1, z)) bottom--;
        if (y >= ISLAND_MIN_Y && bottom > 1) {
          let gap = 0;
          while (gap < 8 && bottom - 1 - gap > 0 && f.density(x, bottom - 1 - gap, z) <= 0) gap++;
          if (gap >= 8) { y = bottom - 1; continue; }
        }
        // Surface height inside the cell, for smooth values.
        const a = f.density(x, y, z);
        let b = f.density(x, y + 1, z);
        if (b > 0) b = this.overhead(x, y + 1, z) ? -0.5 : 0;
        return y + Math.min(1, a / Math.max(1e-3, a - b));
      }
      y--;
    }
    return 0;
  }

  /** Recompute resident columns in [x0,x1]x[z0,z1] (inclusive) and re-blur around them. */
  update(x0: number, z0: number, x1: number, z1: number) {
    const w = this.w, d = this.d;
    x0 = Math.max(0, Math.floor(x0)); z0 = Math.max(0, Math.floor(z0));
    x1 = Math.min(w - 1, Math.ceil(x1)); z1 = Math.min(d - 1, Math.ceil(z1));
    const f = this.field;
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        let loaded = true;
        for (let y = 0; y < f.sy && loaded; y += 32) loaded = f.isResident(x, y, z);
        if (loaded) this.raw[x + z * w] = this.columnTop(x, z);
      }
    this.reblur(x0, z0, x1, z1);
  }

  private reblur(x0: number, z0: number, x1: number, z1: number) {
    const w = this.w, d = this.d;
    // Separable box blur over the affected region (+ blur radius).
    const bx0 = Math.max(0, x0 - BLUR), bx1 = Math.min(w - 1, x1 + BLUR);
    const bz0 = Math.max(0, z0 - BLUR), bz1 = Math.min(d - 1, z1 + BLUR);
    for (let z = Math.max(0, bz0 - BLUR); z <= Math.min(d - 1, bz1 + BLUR); z++)
      for (let x = bx0; x <= bx1; x++) {
        let s = 0, n = 0;
        for (let k = -BLUR; k <= BLUR; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= w) continue;
          s += this.raw[xx + z * w]; n++;
        }
        this.tmp[x + z * w] = s / n;
      }
    for (let z = bz0; z <= bz1; z++)
      for (let x = bx0; x <= bx1; x++) {
        let s = 0, n = 0;
        for (let k = -BLUR; k <= BLUR; k++) {
          const zz = z + k;
          if (zz < 0 || zz >= d) continue;
          s += this.tmp[x + zz * w]; n++;
        }
        // Blur only ever lowers a column's cover: it softens the edges of
        // overhangs, but a tall neighbour must not bury open ground at the
        // foot of a cliff or around a hole in the mountain (that went black).
        this.blurred[x + z * w] = Math.min(this.raw[x + z * w], s / n);
      }
    this.version++;
  }

  /** 0 = deep under cover, 1 = open sky. Same formula as the shader. */
  visibility(x: number, y: number, z: number): number {
    const ix = Math.max(0, Math.min(this.w - 1, Math.round(x))), iz = Math.max(0, Math.min(this.d - 1, Math.round(z)));
    const top = this.blurred[ix + iz * this.w];
    const t = Math.max(0, Math.min(1, (y - top + 6) / 5));
    return t * t * (3 - 2 * t);
  }
}
