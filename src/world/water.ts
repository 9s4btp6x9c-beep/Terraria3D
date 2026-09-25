// Liquid water on a 1 m grid (the terrain itself stays a smooth field; only
// the water is cellular). Each cell holds a level in
// 0..1. Water falls, then spreads sideways and levels out; the ocean is an
// infinite source/sink below sea level, so tunnels dug from the coast flood.
//
// Only "awake" cells are simulated, with a per-tick budget, so lakes at rest
// cost nothing. Solidity (terrain + building pieces) is cached per cell and
// invalidated after edits.

export interface WaterWorld {
  sx: number; sy: number; sz: number;
  seaLevel: number;
  /** Is the cell (integer coords) blocked by terrain or building pieces? */
  solid(i: number, j: number, k: number): boolean;
  /** Original sea-bed height of an ocean column, or null inland. */
  oceanFloor(i: number, k: number): number | null;
  /** Close enough to the coast for sea pressure to flood instantly. */
  nearCoast?(i: number, k: number): boolean;
}

/** Below this a cell is dry. */
export const MIN_LEVEL = 0.01;
/** Water thinner than this stops spreading (it stays as a puddle). */
const SPREAD_MIN = 0.1;
const REGION = 16;

export class WaterSim {
  readonly cells = new Map<number, number>();
  private active = new Set<number>();
  private solidCache = new Map<number, boolean>();
  /** Cells below sea level filled by the sea's pressure (floods spread from them). */
  private pressure = new Set<number>();
  /** Render regions whose water changed (renderer rebuilds them). */
  readonly dirty = new Set<number>();
  private W: number; private D: number;

  constructor(private w: WaterWorld) {
    this.W = w.sx; this.D = w.sz;
  }

  key(i: number, j: number, k: number) { return i + this.W * (k + this.D * j); }
  unkey(key: number): [number, number, number] {
    const i = key % this.W, r = Math.floor(key / this.W);
    return [i, Math.floor(r / this.D), r % this.D];
  }
  regionKey(i: number, j: number, k: number) {
    return Math.floor(i / REGION) + 1024 * (Math.floor(k / REGION) + 1024 * Math.floor(j / REGION));
  }
  static regionBounds(rk: number): [number, number, number] {
    const rx = rk % 1024, r = Math.floor(rk / 1024);
    return [rx * REGION, Math.floor(r / 1024) * REGION, (r % 1024) * REGION];
  }
  static readonly REGION = REGION;

  inBounds(i: number, j: number, k: number) {
    return i >= 0 && k >= 0 && j >= 0 && i < this.W && k < this.D && j < this.w.sy;
  }

  solid(i: number, j: number, k: number): boolean {
    if (!this.inBounds(i, j, k)) return true;
    const key = this.key(i, j, k);
    let s = this.solidCache.get(key);
    if (s === undefined) {
      s = this.w.solid(i, j, k);
      if (this.solidCache.size > 400000) this.solidCache.clear();
      this.solidCache.set(key, s);
    }
    return s;
  }

  /** The open ocean below sea level: always full, never stored. */
  sea(i: number, j: number, k: number): boolean {
    if (j + 0.5 >= this.w.seaLevel || !this.inBounds(i, j, k)) return false;
    const floor = this.w.oceanFloor(i, k);
    return floor !== null && j + 0.5 > floor;
  }

  level(i: number, j: number, k: number): number {
    if (this.sea(i, j, k)) return 1;
    return this.cells.get(this.key(i, j, k)) ?? 0;
  }

  private write(i: number, j: number, k: number, v: number) {
    const key = this.key(i, j, k);
    const old = this.cells.get(key) ?? 0;
    if (v < MIN_LEVEL) v = 0;
    if (v < 0.99) this.pressure.delete(key);
    if (Math.abs(old - v) < 1e-4) return;
    if (v === 0) this.cells.delete(key); else this.cells.set(key, Math.min(1, v));
    this.dirty.add(this.regionKey(i, j, k));
    this.wakeCell(i, j, k);
  }

  private wakeCell(i: number, j: number, k: number) {
    for (const [di, dj, dk] of NEIGHBOURS) {
      const a = i + di, b = j + dj, c = k + dk;
      if (this.inBounds(a, b, c)) this.active.add(this.key(a, b, c));
    }
  }

  /** Wake every cell in a box (after digging or building nearby). */
  wake(x: number, y: number, z: number, r: number) {
    const i0 = Math.floor(x - r), i1 = Math.floor(x + r), j0 = Math.floor(y - r), j1 = Math.floor(y + r), k0 = Math.floor(z - r), k1 = Math.floor(z + r);
    for (let j = j0; j <= j1; j++)
      for (let k = k0; k <= k1; k++)
        for (let i = i0; i <= i1; i++) {
          if (!this.inBounds(i, j, k)) continue;
          const key = this.key(i, j, k);
          this.solidCache.delete(key);
          this.active.add(key);
        }
  }

  /** Forget cached solidity (terrain streamed in or changed a lot). */
  invalidate() { this.solidCache.clear(); }

  /** Add water at a point; overflow stacks upward. Returns the amount placed. */
  add(i: number, j: number, k: number, amount: number): number {
    let placed = 0;
    for (let jj = j; jj < this.w.sy && amount > 1e-3; jj++) {
      if (this.solid(i, jj, k) || this.sea(i, jj, k)) break;
      const l = this.level(i, jj, k);
      const put = Math.min(1 - l, amount);
      if (put > 0) { this.write(i, jj, k, l + put); amount -= put; placed += put; }
    }
    return placed;
  }

  /** Remove up to `amount` of water from a cell and its neighbours. */
  take(i: number, j: number, k: number, amount: number): number {
    if (this.sea(i, j, k)) return amount; // the ocean never runs dry
    let got = 0;
    for (const [di, dj, dk] of [[0, 0, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
      const a = i + di, b = j + dj, c = k + dk;
      const l = this.level(a, b, c);
      if (l <= 0 || this.sea(a, b, c)) continue;
      const t = Math.min(l, amount - got);
      this.write(a, b, c, l - t);
      got += t;
      if (got >= amount - 1e-3) break;
    }
    return got;
  }

  /**
   * Top of the water body at (x, y, z): the surface height if the point is
   * in water (walking up through full cells), else null.
   */
  surfaceAt(x: number, y: number, z: number): number | null {
    const i = Math.floor(x), k = Math.floor(z);
    let j = Math.floor(y);
    if (this.level(i, j, k) < MIN_LEVEL) {
      // Standing in the bottom of a shallow cell counts too.
      if (this.level(i, j - 1, k) > 0.9 || this.level(i, j, k) > 0) return this.level(i, j, k) > 0 ? j + this.level(i, j, k) : null;
      return null;
    }
    while (j < this.w.sy - 1 && this.level(i, j, k) > 0.98 && this.level(i, j + 1, k) >= MIN_LEVEL) j++;
    const top = j + this.level(i, j, k);
    return this.sea(i, Math.floor(y), k) ? Math.max(top, this.w.seaLevel) : top;
  }

  get awake() { return this.active.size; }

  /**
   * Advance the simulation, processing at most `budget` awake cells near
   * the focus (others keep sleeping in the queue until the player is near).
   */
  step(budget: number, fx: number, fz: number, radius: number) {
    const batch: number[] = [];
    for (const key of this.active) {
      const [i, , k] = this.unkey(key);
      if (Math.abs(i - fx) > radius || Math.abs(k - fz) > radius) continue;
      batch.push(key);
      this.active.delete(key);
      if (batch.length >= budget) break;
    }
    // Lower cells first so columns settle in one pass.
    batch.sort((a, b) => Math.floor(a / (this.W * this.D)) - Math.floor(b / (this.W * this.D)));
    for (const key of batch) this.update(key);
  }

  private update(key: number) {
    const [i, j, k] = this.unkey(key);
    if (this.solid(i, j, k) || this.sea(i, j, k)) {
      if (this.cells.has(key)) this.write(i, j, k, 0); // displaced by terrain
      return;
    }
    let l = this.cells.get(key) ?? 0;

    // Below sea level, cells joined to the open sea (directly or through
    // already-flooded cells) fill at once: communicating vessels.
    if (l < 1 && j + 0.5 < this.w.seaLevel) {
      for (const [di, dj, dk] of SIDES_AND_UP) {
        const a = i + di, b = j + dj, c = k + dk;
        if (this.sea(a, b, c) || (this.pressure.has(this.key(a, b, c)) && (this.w.nearCoast?.(i, k) ?? true))) {
          this.write(i, j, k, 1);
          this.pressure.add(key);
          return;
        }
      }
    }
    if (l <= 0) return;

    // Fall.
    if (!this.solid(i, j - 1, k)) {
      if (this.sea(i, j - 1, k)) { this.write(i, j, k, 0); return; }
      const lb = this.level(i, j - 1, k);
      const move = Math.min(l, 1 - lb);
      if (move > 1e-4) {
        this.write(i, j - 1, k, lb + move);
        l -= move;
        this.write(i, j, k, l);
        if (l <= 0) return;
      }
    }
    if (l < SPREAD_MIN) return;
    // Only spread sideways once the cell below is full or solid.
    if (!this.solid(i, j - 1, k) && this.level(i, j - 1, k) < 0.99) return;

    // Level out with the four side neighbours.
    let total = l, n = 1;
    const open: [number, number, number, number][] = [];
    for (const [di, , dk] of SIDES) {
      const a = i + di, c = k + dk;
      if (this.solid(a, j, c)) continue;
      if (this.sea(a, j, c)) continue; // the sea is always full
      const ln = this.level(a, j, c);
      if (ln >= l) continue;
      open.push([a, j, c, ln]);
      total += ln; n++;
    }
    if (!open.length) return;
    const avg = total / n;
    let left = l;
    for (const [a, b, c, ln] of open) {
      if (ln >= avg) continue;
      const give = Math.min(avg - ln, left - avg);
      if (give <= 1e-4) continue;
      this.write(a, b, c, ln + give);
      left -= give;
    }
    this.write(i, j, k, left);
  }

  serialize(): { k: number[]; l: number[] } {
    const k: number[] = [], l: number[] = [];
    for (const [key, v] of this.cells) { k.push(key); l.push(Math.round(v * 255)); }
    return { k, l };
  }

  load(d: { k: number[]; l: number[] }) {
    this.cells.clear();
    for (let n = 0; n < d.k.length; n++) {
      const v = d.l[n] / 255;
      if (v >= MIN_LEVEL) this.cells.set(d.k[n], v);
      const [i, j, k] = this.unkey(d.k[n]);
      this.dirty.add(this.regionKey(i, j, k));
    }
  }

  /** Set a cell directly (world generation). */
  fill(i: number, j: number, k: number, v: number, wake = false) {
    if (!this.inBounds(i, j, k) || v < MIN_LEVEL) return;
    this.cells.set(this.key(i, j, k), Math.min(1, v));
    this.dirty.add(this.regionKey(i, j, k));
    if (wake) this.active.add(this.key(i, j, k));
  }
}

const NEIGHBOURS = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const SIDES_AND_UP = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
