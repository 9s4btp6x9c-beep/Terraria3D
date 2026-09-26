// Deterministic procedural world generation. Produces a continuous density
// field: a heightfield for broad landforms, 3D noise for overhangs and cliffs,
// carved tunnel/cavern systems, a guaranteed cave entrance near spawn and a
// few floating sky islands. Materials are chosen from depth, exposure, slope
// and ore noise.

import { SimplexNoise, mulberry32 } from '../core/noise';
import { type WorldConfig, worldSize } from './config';
import { Mat } from './materials';
import type { SampleGrid } from './edits';
import { DENSITY_CLAMP } from './edits';

interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number }
interface Island { x: number; y: number; z: number; r: number; depth: number }
/** Cabin room: min corner (x, z) on the 2 m build grid, floor base y, size in 2 m cells. */
/** A surface lake: a bowl carved below `level`, filled with water at creation. */
export interface Lake { x: number; z: number; r: number; depth: number; level: number }

export interface Cabin { x: number; y: number; z: number; cx: number; cz: number; seed: number }

export const CABIN_WALL = 2.5;

export const enum Biome { Forest = 0, Desert = 1, Snow = 2, Rift = 3, Rootwold = 4, Ossuary = 5, Amberwood = 6, Volcano = 7 }

/** In-world names, shown when the player crosses into a biome. */
export const BIOME_NAMES = ['Greenhollow', 'Sunscar Dunes', 'Frostmere', 'The Riftlands', 'The Rootwold', 'Ossuary Flats', 'Amberwood', 'The Cinder Peaks'];

/**
 * A volcano: an ash-and-basalt cone of radius `r` rising `height` above its
 * foot, with a crater (radius `rc`) holding a lava lake at `lavaLevel`, and a
 * lava tube running from the foot into a magma chamber under the crater.
 */
export interface Volcano { x: number; z: number; r: number; foot: number; height: number; rc: number; rim: number; floor: number; lavaLevel: number; chamber: { x: number; y: number; z: number; r: number } }

/** Weights of every non-forest biome at a column, each 0..1 with soft borders. */
export interface BiomeWeights { desert: number; snow: number; rift: number; root: number; ossuary: number; amber: number }

/**
 * A large terrain feature: a tapered capsule (radius ra at a, rb at b) that
 * adds solid rock of its own material. Chains of them make the Rootwold's
 * arching roots, the Ossuary's ribcages and Amberwood's resin nodules.
 */
export interface Feature { ax: number; ay: number; az: number; bx: number; by: number; bz: number; ra: number; rb: number; mat: number }
const FEATURE_CELL = 16;

/** The expensive per-column part of generation (heightfield, mountains, biomes). */
export interface GeneratorColumns { heights: Float32Array; mountainMask: Float32Array; biomes: Uint8Array }
/** Below this height the world becomes the Ember Depths. */
export const EMBER_Y = 21;
/** Mushroom caverns stay above the Ember Depths. */
const SHROOM_MIN_Y = EMBER_Y + 9;

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
  private biomeNoise: SimplexNoise;
  private blightNoise: SimplexNoise;
  private shroomNoise: SimplexNoise;
  private wildNoise: SimplexNoise;
  /** Large terrain features, bucketed on a 16 m grid of columns. */
  readonly features: Feature[] = [];
  private featureGrid: Feature[][] = [];
  private featureGw = 0;
  /** Per-column biome id (see Biome). */
  private biomes: Uint8Array;
  readonly entrance: Capsule[] = [];
  readonly islands: Island[] = [];
  /** Underground cabins: grid-aligned rooms carved out of the rock (x,z = min corner). */
  readonly cabins: Cabin[] = [];
  readonly lakes: Lake[] = [];
  readonly volcanoes: Volcano[] = [];
  /** Lava tube capsules (carved like the entrance tunnel) and their padded bounds. */
  readonly tubes: Capsule[] = [];
  private tubeBounds = [0, 0, 0, -1, -1, -1];
  /** Cave mouths and sinkholes (caves v2): carved capsules bucketed by column cell. */
  readonly mouths: { x: number; z: number; kind: 'mouth' | 'sinkhole' }[] = [];
  private carveGrid: Capsule[][] = [];
  /** Cave generation version (see WorldConfig.caves). */
  readonly caveVersion: number;
  /** AABB (min xyz, max xyz) around the entrance tunnel, padded. */
  private entranceBounds = [0, 0, 0, 0, 0, 0];
  spawn = { x: 0, y: 0, z: 0 };

  /**
   * `pre` lets terrain workers reuse the main thread's column data (see
   * `columns()`) instead of recomputing the heightfield themselves.
   */
  constructor(readonly cfg: WorldConfig, pre?: GeneratorColumns) {
    const s = cfg.seed;
    this.size = worldSize(cfg);
    this.caveVersion = cfg.caves ?? 1;
    this.hills = new SimplexNoise(s + 1);
    this.ridges = new SimplexNoise(s + 2);
    this.mask = new SimplexNoise(s + 3);
    this.warp = new SimplexNoise(s + 4);
    this.caveA = new SimplexNoise(s + 5);
    this.caveB = new SimplexNoise(s + 6);
    this.cavern = new SimplexNoise(s + 7);
    this.ore = new SimplexNoise(s + 8);
    this.detail = new SimplexNoise(s + 9);
    this.biomeNoise = new SimplexNoise(s + 10);
    this.blightNoise = new SimplexNoise(s + 11);
    this.shroomNoise = new SimplexNoise(s + 12);
    this.wildNoise = new SimplexNoise(s + 13);

    const w = this.size.x + 1, d = this.size.z + 1;
    if (pre && pre.heights.length === w * d) {
      this.heights = pre.heights; this.mountainMask = pre.mountainMask; this.biomes = pre.biomes;
    } else {
      this.heights = new Float32Array(w * d);
      this.mountainMask = new Float32Array(w * d);
      this.biomes = new Uint8Array(w * d);
      for (let z = 0; z < d; z++)
        for (let x = 0; x < w; x++) {
          const [h, m, b] = this.computeHeight(x, z);
          this.heights[x + z * w] = h;
          this.mountainMask[x + z * w] = m;
          this.biomes[x + z * w] = b;
        }
    }
    this.placeVolcanoes(!(pre && pre.heights.length === w * d));
    this.placeSpawnAndEntrance();
    this.placeLakes();
    this.placeIslands();
    this.placeCabins();
    this.placeFeatures();
    if (this.caveVersion >= 2) this.placeCaveMouths();
  }

  /** Per-column data, shareable with workers (see constructor). */
  columns(): GeneratorColumns {
    return { heights: this.heights, mountainMask: this.mountainMask, biomes: this.biomes };
  }

  // ---------------------------------------------------------------- landforms

  /**
   * Biome weights at a column. Two broad noise fields act as climate: `t`
   * (heat) splits scorched, temperate and frozen land, `u` (age) splits each
   * band further (dunes vs salt flats, root-choked vs autumn forest). The
   * Riftlands tear through everything on a noise field of their own. The
   * centre of the world (spawn) is always Greenhollow.
   */
  biomeWeights(x: number, z: number): BiomeWeights {
    const cx = this.size.x / 2, cz = this.size.z / 2;
    const fromCenter = smoothstep(70, 130, Math.hypot(x - cx, z - cz));
    const t = this.biomeNoise.fbm2(x / 260 + 5, z / 260 - 3, 2) + this.biomeNoise.noise2(x / 40, z / 40) * 0.04;
    const u = this.wildNoise.fbm2(x / 210 - 11, z / 210 + 7, 2) + this.wildNoise.noise2(x / 38, z / 38) * 0.04;
    const hot = smoothstep(0.18, 0.3, t) * fromCenter;
    const snow = smoothstep(-0.18, -0.3, t) * fromCenter;
    const flats = smoothstep(-0.02, -0.14, u);
    const desert = hot * (1 - flats), ossuary = hot * flats;
    const mild = fromCenter * (1 - hot) * (1 - snow);
    const root = mild * smoothstep(-0.12, -0.24, u);
    const amber = mild * smoothstep(0.14, 0.26, u);
    const bl = this.blightNoise.fbm2(x / 190 + 40, z / 190 - 20, 2) + this.blightNoise.noise2(x / 35, z / 35) * 0.05;
    const rift = smoothstep(0.26, 0.36, bl) * fromCenter * (1 - hot) * (1 - snow);
    const keep = 1 - rift;
    return { desert, snow, rift, root: root * keep, ossuary, amber: amber * keep };
  }

  private computeHeight(x: number, z: number): [number, number, number] {
    const { x: W, z: D } = this.size;
    const sea = this.cfg.seaLevel;
    const { desert, snow, rift, root, ossuary, amber } = this.biomeWeights(x, z);
    let h = 70 + this.hills.fbm2(x / 150, z / 150, 4) * 9 + this.hills.fbm2(x / 40 + 31, z / 40, 2) * 2.5;
    let m = smoothstep(0.05, 0.45, this.mask.fbm2(x / 230 + 17, z / 230 - 9, 3));
    m = Math.max(m * (1 - desert * 0.85) * (1 - ossuary) * (1 - root * 0.8) * (1 - amber * 0.65), snow * 0.55);
    const r = this.ridges.ridged2(x / 120, z / 120, 4);
    h += m * Math.pow(r, 2.2) * 62;
    // Desert dunes: long, soft ridges.
    const dune = 1 - Math.abs(this.hills.noise2(x / 34 + 9, z / 90));
    h += desert * (dune * dune * 7 - 1);
    h += snow * 5 - rift * 3 + rift * this.hills.noise2(x / 18, z / 18) * 2.5;
    // Rootwold: knotted mounds heaved up by the roots below.
    h += root * (2 + Math.abs(this.hills.noise2(x / 22 - 4, z / 22 + 8)) * 5);
    // Amberwood: soft, rolling rises.
    h += amber * (1.5 + this.hills.noise2(x / 60 + 2, z / 60) * 2);
    // Soft terracing gives cliff bands on hillsides (not on dunes or flats).
    const step = 7;
    const t = Math.floor(h / step) * step;
    const frac = (h - t) / step;
    const terr = 0.4 * (1 - desert) * (1 - ossuary);
    h = h * (1 - terr) + (t + smoothstep(0.35, 0.65, frac) * step) * terr;
    // Ossuary Flats: a dead, level salt pan with the faintest swell.
    h += (67.5 + this.hills.noise2(x / 70, z / 70) * 0.8 - h) * ossuary * 0.94;
    // Ocean ring around the island-shaped world.
    const nx = (x / W) * 2 - 1, nz = (z / D) * 2 - 1;
    const edge = smoothstep(0.72, 0.97, Math.max(Math.abs(nx), Math.abs(nz)) + this.mask.noise2(x / 60, z / 60) * 0.05);
    h = h * (1 - edge) + (sea - 14) * edge;
    const j = this.detail.noise2(x / 7, z / 7) * 0.12; // dithered borders
    const biome = desert + j > 0.5 ? Biome.Desert : snow + j > 0.5 ? Biome.Snow : rift + j > 0.5 ? Biome.Rift
      : ossuary + j > 0.5 ? Biome.Ossuary : root + j > 0.5 ? Biome.Rootwold : amber + j > 0.5 ? Biome.Amberwood : Biome.Forest;
    return [h, m * (1 - edge), biome];
  }

  biomeAt(x: number, z: number): Biome {
    const w = this.size.x + 1;
    const ix = Math.max(0, Math.min(this.size.x, Math.round(x))), iz = Math.max(0, Math.min(this.size.z, Math.round(z)));
    return this.biomes[ix + iz * w];
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
      // Prefer open, gentle meadows: penalise the steepest slope within ~12 m.
      let slope = 0;
      for (let k = 0; k < 8; k++) {
        const a2 = (k / 8) * Math.PI * 2;
        for (const r of [3, 7, 12]) slope = Math.max(slope, Math.abs(this.height(x + Math.cos(a2) * r, z + Math.sin(a2) * r) - h) / r);
      }
      const score = (h > this.cfg.seaLevel + 3 ? 0 : -100) - slope * 40 - d * 0.05 - Math.max(0, h - 85);
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

  /**
   * Raise a couple of volcanoes well away from spawn: cones with gullies,
   * a crater bowl for a lava lake and a lava tube leading to a magma chamber.
   * `shape` is false when the heightfield came precomputed (already shaped).
   */
  private placeVolcanoes(shape: boolean) {
    const rand = mulberry32(this.cfg.seed ^ 0xb01c);
    const W = this.size.x, D = this.size.z, cx = W / 2, cz = D / 2, half = Math.min(W, D) / 2;
    const want = Math.max(1, Math.round((W * D) / (512 * 512) * 0.9));
    const sea = this.cfg.seaLevel;
    for (let tries = 0; this.volcanoes.length < want && tries < 300; tries++) {
      const a = rand() * Math.PI * 2, dist = half * (0.44 + rand() * 0.18);
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      const r = 52 + rand() * 14;
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) / half > 0.64) continue;
      if (this.volcanoes.some(v => Math.hypot(v.x - x, v.z - z) < v.r + r + 40)) continue;
      const ring = Array.from({ length: 12 }, (_, k) => this.height(x + Math.cos(k * 0.52) * r * 0.8, z + Math.sin(k * 0.52) * r * 0.8));
      if (Math.min(...ring) < sea + 4) continue;
      const foot = Math.min(...ring.map((_, k) => this.height(x + Math.cos(k * 0.52) * r, z + Math.sin(k * 0.52) * r)));
      const height = 46 + rand() * 14, rc = 12 + rand() * 4;
      const rim = foot + height * Math.pow(1 - rc / r, 1.35);
      if (rim > this.size.y - 30) continue;
      const floor = rim - 11;
      const ta = rand() * Math.PI * 2;
      this.volcanoes.push({
        x, z, r, foot, height, rc, rim, floor, lavaLevel: floor + 6,
        chamber: { x: x + Math.cos(ta) * 5, y: floor - 11, z: z + Math.sin(ta) * 5, r: 6.5 },
      });
    }
    const w = W + 1;
    for (const v of this.volcanoes) {
      if (shape) {
        for (let zz = Math.max(0, Math.floor(v.z - v.r)); zz <= Math.min(D, Math.ceil(v.z + v.r)); zz++)
          for (let xx = Math.max(0, Math.floor(v.x - v.r)); xx <= Math.min(W, Math.ceil(v.x + v.r)); xx++) {
            const d = Math.hypot(xx - v.x, zz - v.z);
            if (d >= v.r) continue;
            const i = xx + zz * w;
            const t = 1 - d / v.r, ang = Math.atan2(zz - v.z, xx - v.x);
            let cone = v.foot + v.height * Math.pow(t, 1.35) + this.hills.noise2(ang * 4 + 50, d / 9) * 2.4 * t;
            if (d < v.rc) cone = v.floor + (v.rim - v.floor) * Math.pow(d / v.rc, 2.2);
            const wgt = d < v.rc * 1.2 ? 1 : smoothstep(v.r, v.r * 0.72, d);
            const old = this.heights[i];
            this.heights[i] = d < v.rc * 1.2 ? cone : old + (Math.max(old, cone) - old) * wgt;
            this.mountainMask[i] *= 1 - wgt;
            if (d < v.r * 0.92 + this.detail.noise2(xx / 7, zz / 7) * 3) this.biomes[i] = Biome.Volcano;
          }
      }
      // Lava tube: from the foot, winding up into the magma chamber.
      const a = Math.atan2(v.chamber.z - v.z, v.chamber.x - v.x) + Math.PI * 0.35;
      let px = v.x + Math.cos(a) * v.r * 0.78, pz = v.z + Math.sin(a) * v.r * 0.78;
      let py = this.height(px, pz) + 1;
      const n = 10;
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        const nx = px + (v.chamber.x - px) / (n - k + 1) + Math.sin(k * 1.7) * 1.5;
        const nz = pz + (v.chamber.z - pz) / (n - k + 1) + Math.cos(k * 1.3) * 1.5;
        const ny = py + (v.chamber.y - 2 - py) / (n - k + 1);
        this.tubes.push({ ax: px, ay: py, az: pz, bx: nx, by: ny, bz: nz, r: k < 2 ? 3.2 : 2.4 + f * 0.6 });
        px = nx; py = ny; pz = nz;
      }
      const c = v.chamber;
      this.tubes.push({ ax: c.x - 2, ay: c.y, az: c.z - 1, bx: c.x + 2, by: c.y + 0.5, bz: c.z + 1, r: c.r });
    }
    if (this.tubes.length) {
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const c of this.tubes) {
        b[0] = Math.min(b[0], c.ax - c.r, c.bx - c.r); b[3] = Math.max(b[3], c.ax + c.r, c.bx + c.r);
        b[1] = Math.min(b[1], c.ay - c.r, c.by - c.r); b[4] = Math.max(b[4], c.ay + c.r, c.by + c.r);
        b[2] = Math.min(b[2], c.az - c.r, c.bz - c.r); b[5] = Math.max(b[5], c.az + c.r, c.bz + c.r);
      }
      this.tubeBounds = [b[0] - 4, b[1] - 4, b[2] - 4, b[3] + 4, b[4] + 4, b[5] + 4];
    }
  }

  /** The volcano whose cone covers the column, with the distance to its centre. */
  volcanoAt(x: number, z: number): { v: Volcano; d: number } | null {
    for (const v of this.volcanoes) {
      const d = Math.hypot(x - v.x, z - v.z);
      if (d < v.r) return { v, d };
    }
    return null;
  }

  private placeIslands() {
    const rand = mulberry32(this.cfg.seed ^ 0x51a7);
    const top = this.size.y - 14;
    const want = Math.max(2, Math.round((this.size.x * this.size.z) / (256 * 256) * 2));
    const half = Math.min(this.size.x, this.size.z) / 2;
    for (let tries = 0; this.islands.length < want && tries < 400; tries++) {
      const a = rand() * Math.PI * 2;
      const d = half * (0.2 + rand() * 0.5);
      const x = this.size.x / 2 + Math.cos(a) * d, z = this.size.z / 2 + Math.sin(a) * d;
      const r = 11 + rand() * 8;
      // Keep islands apart and clear of mountain tops so they read as floating.
      if (this.islands.some(i => Math.hypot(i.x - x, i.z - z) < i.r + r + 30)) continue;
      let ground = this.height(x, z);
      for (let k = 0; k < 8; k++) ground = Math.max(ground, this.height(x + Math.cos(k) * r, z + Math.sin(k) * r));
      if (ground > 100) continue;
      this.islands.push({ x, z, y: top - rand() * 6, r, depth: 11 + rand() * 5 });
    }
  }

  private placeLakes() {
    const rand = mulberry32(this.cfg.seed ^ 0x1a4e);
    const want = Math.round((this.size.x * this.size.z) / (512 * 512) * 6);
    const m = 60, sea = this.cfg.seaLevel;
    for (let tries = 0; this.lakes.length < want && tries < 600; tries++) {
      const x = m + rand() * (this.size.x - 2 * m), z = m + rand() * (this.size.z - 2 * m);
      const b = this.biomeAt(x, z);
      if (b === Biome.Desert || b === Biome.Rift || b === Biome.Ossuary || b === Biome.Volcano) continue;
      const r = 7 + rand() * 7;
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < r + 30) continue;
      if (this.lakes.some(l => Math.hypot(l.x - x, l.z - z) < l.r + r + 24)) continue;
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < 16; a++) {
        const h = this.height(x + Math.cos(a / 16 * Math.PI * 2) * r * 1.15, z + Math.sin(a / 16 * Math.PI * 2) * r * 1.15);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (hi - lo > 4 || this.height(x, z) > lo + 3) continue;
      const level = Math.floor((lo - 0.8) * 4) / 4;
      if (level < sea + 3 || level > 100) continue;
      this.lakes.push({ x, z, r, depth: 2.5 + rand() * 2.5, level });
    }
  }

  /** Horizontal radius of a lake bowl at height y (flares out above the water). */
  lakeRadius(l: Lake, x: number, z: number, y: number) {
    const shore = l.r * (1 + this.detail.noise2(x / 9 + l.x, z / 9) * 0.12);
    if (y >= l.level) return shore * (1 + (y - l.level) * 0.35);
    const t = (l.level - y) / l.depth;
    return t >= 1 ? 0 : shore * Math.sqrt(1 - t * t);
  }

  /** The lake whose bowl contains the column, if any. */
  lakeAt(x: number, z: number): Lake | null {
    for (const l of this.lakes) if ((x - l.x) ** 2 + (z - l.z) ** 2 < (l.r * 1.2) ** 2) return l;
    return null;
  }

  /** Original sea-bed height for ocean columns (null inland). */
  oceanFloor(x: number, z: number): number | null {
    const h = this.height(x, z);
    return h < this.cfg.seaLevel - 0.5 ? h : null;
  }

  private placeCabins() {
    const rand = mulberry32(this.cfg.seed ^ 0xcab1);
    const want = Math.round((this.size.x * this.size.z) / (512 * 512) * 12);
    const m = 40;
    for (let tries = 0; this.cabins.length < want && tries < 600; tries++) {
      const x = Math.floor((m + rand() * (this.size.x - 2 * m)) / 2) * 2;
      const z = Math.floor((m + rand() * (this.size.z - 2 * m)) / 2) * 2;
      const h = this.height(x + 3, z + 2);
      if (h < this.cfg.seaLevel + 4) continue;
      const y = Math.floor((h - 14 - rand() * 30) / 0.25) * 0.25;
      if (y < 12) continue;
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 30) continue;
      if (this.mushroomStrength(x + 3, z + 2) > 0.05) continue;
      if (this.cabins.some(c => Math.abs(c.x - x) < 24 && Math.abs(c.z - z) < 24 && Math.abs(c.y - y) < 12)) continue;
      const big = rand() < 0.4;
      this.cabins.push({ x, y, z, cx: big ? 4 : 3, cz: big ? 3 : 2, seed: Math.floor(rand() * 1e9) });
    }
  }

  // ----------------------------------------------------------------- features

  private placeFeatures() {
    const rand = mulberry32(this.cfg.seed ^ 0xf3a7);
    const area = (this.size.x * this.size.z) / (512 * 512);
    const clearOf = (x: number, z: number, r: number) =>
      Math.hypot(x - this.spawn.x, z - this.spawn.z) > r + 40 && !this.lakes.some(l => Math.hypot(l.x - x, l.z - z) < l.r * 1.8 + r);
    const inBiome = (b: Biome, pts: [number, number][]) => pts.every(([x, z]) => this.biomeAt(x, z) === b && this.height(x, z) > this.cfg.seaLevel + 2);
    // Rootwold: colossal petrified roots arching out of the moss.
    let roots = 0;
    for (let tries = 0; roots < Math.round(area * 34) && tries < 3000; tries++) {
      const x = rand() * this.size.x, z = rand() * this.size.z;
      const yaw = rand() * Math.PI * 2, span = 20 + rand() * 26, lift = 9 + rand() * 15;
      const dx = Math.cos(yaw) * span / 2, dz = Math.sin(yaw) * span / 2;
      if (!inBiome(Biome.Rootwold, [[x, z], [x - dx, z - dz], [x + dx, z + dz]]) || !clearOf(x, z, span / 2)) continue;
      // Arches span open ground, not mountainsides.
      if (Math.abs(this.height(x - dx, z - dz) - this.height(x + dx, z + dz)) > 5 || this.height(x, z) > Math.max(this.height(x - dx, z - dz), this.height(x + dx, z + dz)) + 4) continue;
      if (this.features.some(f => f.mat === Mat.Rootwood && Math.hypot((f.ax + f.bx) / 2 - x, (f.az + f.bz) / 2 - z) < 14)) continue;
      const rEnd = 2.4 + rand() * 1.2, rMid = 1.3 + rand() * 0.7, wob = (rand() - 0.5) * 8;
      const path: [number, number, number][] = [];
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const s = i / n, px = x - dx + dx * 2 * s - Math.sin(yaw) * Math.sin(Math.PI * s) * wob, pz = z - dz + dz * 2 * s + Math.cos(yaw) * Math.sin(Math.PI * s) * wob;
        path.push([px, this.height(px, pz) - 2.5 + Math.sin(Math.PI * s) * lift, pz]);
      }
      this.chain(path, s => rMid + (rEnd - rMid) * (1 - Math.sin(Math.PI * s)), Mat.Rootwood);
      // Buttress roots splaying from each foot into the ground.
      for (const end of [0, n]) {
        const [fx, , fz] = path[end];
        for (let k = 0; k < 2; k++) {
          const a = yaw + (end ? 0 : Math.PI) + (rand() - 0.5) * 2.2, len = 6 + rand() * 7;
          const ex = fx + Math.cos(a) * len, ez = fz + Math.sin(a) * len;
          this.chain([[fx, this.height(fx, fz) + 0.5, fz], [(fx + ex) / 2, this.height((fx + ex) / 2, (fz + ez) / 2) - 0.2, (fz + ez) / 2], [ex, this.height(ex, ez) - 1.2, ez]],
            s => (rEnd * 0.7) * (1 - s * 0.6), Mat.Rootwood);
        }
      }
      roots++;
    }
    // Ossuary Flats: the half-sunk skeletons of long-dead titans.
    let bones = 0;
    for (let tries = 0; bones < Math.round(area * 5) && tries < 2000; tries++) {
      const x = rand() * this.size.x, z = rand() * this.size.z;
      const yaw = rand() * Math.PI * 2, len = 30 + rand() * 22;
      const fx = Math.cos(yaw), fz = Math.sin(yaw), sx = -fz, sz = fx;
      const tail: [number, number] = [x - fx * len / 2, z - fz * len / 2], head: [number, number] = [x + fx * len / 2, z + fz * len / 2];
      if (!inBiome(Biome.Ossuary, [[x, z], tail, head]) || !clearOf(x, z, len / 2 + 6)) continue;
      if (this.features.some(f => f.mat === Mat.Fossil && Math.hypot(f.ax - x, f.az - z) < len + 20)) continue;
      const ground = this.height(x, z);
      // Spine: a sagging chain of vertebrae, thicker at the shoulders.
      const spine: [number, number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const s = i / 10;
        spine.push([tail[0] + fx * len * s, ground + 0.4 + Math.sin(Math.PI * s) * 1.6 - (1 - s) * 1.2, tail[1] + fz * len * s]);
      }
      this.chain(spine, s => 0.8 + s * 1.2, Mat.Fossil);
      // Ribs: pairs curling up and inward, largest over the chest.
      const ribs = Math.floor(len * 0.55 / 4.2);
      for (let i = 0; i < ribs; i++) {
        const s = 0.25 + (i / Math.max(1, ribs - 1)) * 0.55;
        const bx = tail[0] + fx * len * s, bz = tail[1] + fz * len * s, by = ground + 0.4 + Math.sin(Math.PI * s) * 1.6;
        const R = (6 + len * 0.12) * (0.55 + Math.sin(Math.PI * (s - 0.1)) * 0.45);
        for (const side of [1, -1]) {
          const pts: [number, number, number][] = [];
          for (let k = 0; k <= 6; k++) {
            const phi = (k / 6) * 2.55;
            const out = Math.sin(phi) * R, up = (1 - Math.cos(phi)) * R * 0.95;
            pts.push([bx + sx * side * out, by + up, bz + sz * side * out]);
          }
          // (Never thinner than the 1 m sampling can resolve, or the rib breaks into floating pieces.)
          this.chain(pts, q => 1.05 - q * 0.15, Mat.Fossil);
        }
      }
      // Skull and a pair of sweeping tusks at the head end.
      const hx = head[0] + fx * 3, hz = head[1] + fz * 3, hy = this.height(hx, hz) + 1.5;
      this.features.push({ ax: hx - fx * 2, ay: hy, az: hz - fz * 2, bx: hx + fx * 3, by: hy - 0.8, bz: hz + fz * 3, ra: 4.2, rb: 2.6, mat: Mat.Fossil });
      for (const side of [1, -1]) {
        const pts: [number, number, number][] = [];
        for (let k = 0; k <= 5; k++) {
          const q = k / 5;
          pts.push([hx + fx * (2 + q * 11) + sx * side * (2.2 + Math.sin(q * 2.2) * 4), hy - 1 + Math.sin(q * 2.6) * 6, hz + fz * (2 + q * 11) + sz * side * (2.2 + Math.sin(q * 2.2) * 4)]);
        }
        this.chain(pts, q => 1.25 - q * 0.35, Mat.Fossil);
      }
      bones++;
    }
    // Amberwood: glowing resin nodules welling up through the leaf litter.
    let nodules = 0;
    for (let tries = 0; nodules < Math.round(area * 70) && tries < 4000; tries++) {
      const x = rand() * this.size.x, z = rand() * this.size.z;
      if (!inBiome(Biome.Amberwood, [[x, z]]) || !clearOf(x, z, 3)) continue;
      const r = 0.7 + rand() * 1.1, y = this.height(x, z) - r * 0.35;
      const lean = rand() * Math.PI * 2;
      this.features.push({ ax: x, ay: y, az: z, bx: x + Math.cos(lean) * r * 0.5, by: y + r * (0.8 + rand() * 0.9), bz: z + Math.sin(lean) * r * 0.5, ra: r, rb: r * 0.35, mat: Mat.Amber });
      nodules++;
    }
    // Bucket features by the columns they cover.
    const gw = Math.ceil(this.size.x / FEATURE_CELL) + 1, gd = Math.ceil(this.size.z / FEATURE_CELL) + 1;
    this.featureGw = gw;
    this.featureGrid = Array.from({ length: gw * gd }, () => []);
    for (const f of this.features) {
      const r = Math.max(f.ra, f.rb) + 1.5;
      const x0 = Math.max(0, Math.floor((Math.min(f.ax, f.bx) - r) / FEATURE_CELL)), x1 = Math.min(gw - 1, Math.floor((Math.max(f.ax, f.bx) + r) / FEATURE_CELL));
      const z0 = Math.max(0, Math.floor((Math.min(f.az, f.bz) - r) / FEATURE_CELL)), z1 = Math.min(gd - 1, Math.floor((Math.max(f.az, f.bz) + r) / FEATURE_CELL));
      for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) this.featureGrid[gx + gz * gw].push(f);
    }
  }

  /** Tapered capsules along a polyline; `radius(s)` gives the radius at s in 0..1. */
  private chain(pts: [number, number, number][], radius: (s: number) => number, mat: number) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
      this.features.push({ ax, ay, az, bx, by, bz, ra: radius(i / (pts.length - 1)), rb: radius((i + 1) / (pts.length - 1)), mat });
    }
  }

  private featureCell(x: number, z: number): Feature[] | null {
    if (!this.features.length) return null;
    const gx = Math.floor(x / FEATURE_CELL), gz = Math.floor(z / FEATURE_CELL);
    if (gx < 0 || gz < 0 || gx >= this.featureGw) return null;
    const list = this.featureGrid[gx + gz * this.featureGw];
    return list && list.length ? list : null;
  }

  /**
   * Signed density of the features at a point (positive inside) and the
   * material of the one that claims it, or null when none is near.
   */
  featureAt(x: number, y: number, z: number): { d: number; mat: number } | null {
    const list = this.featureCell(x, z);
    if (!list) return null;
    let best = -Infinity, mat = 0;
    for (const f of list) {
      const r = f.ra > f.rb ? f.ra : f.rb;
      if (y < Math.min(f.ay, f.by) - r - 1 || y > Math.max(f.ay, f.by) + r + 1) continue;
      const bax = f.bx - f.ax, bay = f.by - f.ay, baz = f.bz - f.az;
      const pax = x - f.ax, pay = y - f.ay, paz = z - f.az;
      const t = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1)));
      const ex = pax - bax * t, ey = pay - bay * t, ez = paz - baz * t;
      const d = f.ra + (f.rb - f.ra) * t - Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d > best) { best = d; mat = f.mat; }
    }
    if (best === -Infinity) return null;
    // Gnarled, weathered surfaces.
    if (best > -2) best += this.detail.noise3(x / 2.2, y / 2.2, z / 2.2) * (mat === Mat.Amber ? 0.12 : mat === Mat.Fossil ? 0.15 : 0.35);
    return { d: best, mat };
  }

  /** Highest point of any feature over the column box [x0,x1]x[z0,z1]. */
  featureTop(x0: number, z0: number, x1: number, z1: number): number {
    let top = -Infinity;
    for (let gz = Math.floor(z0 / FEATURE_CELL); gz <= Math.floor(z1 / FEATURE_CELL); gz++)
      for (let gx = Math.floor(x0 / FEATURE_CELL); gx <= Math.floor(x1 / FEATURE_CELL); gx++) {
        const list = this.featureCell(gx * FEATURE_CELL, gz * FEATURE_CELL);
        if (list) for (const f of list) top = Math.max(top, f.ay + f.ra, f.by + f.rb);
      }
    return top;
  }

  // ------------------------------------------------------------------ density

  /** Density at a point (positive = solid). Pure function of the seed. */
  densityAt(x: number, y: number, z: number): number {
    const { x: W, y: H, z: D } = this.size;
    if (x <= 0 || z <= 0 || y <= 0 || x >= W - 1 || z >= D - 1 || y >= H - 1) return -DENSITY_CLAMP;
    const h = this.height(x, z);
    let d = h - y;
    // Overhangs, spires and cliff breakup near the surface.
    let lake: Lake | null = null, lakeFlat = 0;
    for (const l of this.lakes) {
      const hd = Math.hypot(x - l.x, z - l.z);
      if (hd < l.r * 1.8 + 6) { lake = l; lakeFlat = smoothstep(l.r * 1.8 + 6, l.r * 1.2, hd); break; }
    }
    if (Math.abs(d) < 14) {
      const mi = Math.floor(x) + Math.floor(z) * (W + 1);
      // Keep d(y) monotone-ish (vertical warp slope < 1) so the noise makes
      // overhangs and spires but never loose floating rocks. Lake shores stay calm.
      const amp = (2.5 + this.mountainMask[mi] * 6) * (1 - lakeFlat * 0.85);
      d += this.warp.noise3(x / 22, y / 26, z / 22) * amp + this.warp.noise3(x / 7, y / 9, z / 7) * 0.5;
    }
    if (lake && y > lake.level - lake.depth - 1) {
      const hd = Math.hypot(x - lake.x, z - lake.z);
      d = Math.min(d, (hd - this.lakeRadius(lake, x, z, y)) * 0.8);
    }
    if (y < 4) d = Math.max(d, 4 - y); // bedrock floor stays solid
    // Blight chasms: narrow fissures plunging deep underground.
    if (y > 24 && this.biomeAt(x, z) === Biome.Rift) {
      const n = Math.abs(this.blightNoise.noise2(x / 46, z / 46));
      const width = 0.035 + this.detail.noise2(x / 20, z / 20) * 0.012;
      if (n < width + 0.06) d = Math.min(d, (n - width) * 55 + Math.max(0, 30 - y) * 0.3);
    }
    if (d > -2) {
      let cave = this.caves(x, y, z, h);
      // (Caves v2 are roomy enough to breach a lake bed and drain it: keep
      // them at least 8 m under every lake.)
      if (lake && this.caveVersion >= 2) {
        const hd = Math.hypot(x - lake.x, z - lake.z);
        if (hd < lake.r * 1.8 + 6) cave = Math.max(cave, (y - (lake.level - lake.depth - 8)) * 0.6);
      }
      d = Math.min(d, cave);
    }
    let tunnel = Infinity;
    const eb = this.entranceBounds;
    if (x > eb[0] && x < eb[3] && y > eb[1] && y < eb[4] && z > eb[2] && z < eb[5])
      for (const c of this.entrance) tunnel = Math.min(tunnel, capsuleDist(x, y, z, c) - c.r);
    if (this.carveGrid.length) {
      const list = this.carveGrid[Math.floor(x / FEATURE_CELL) + Math.floor(z / FEATURE_CELL) * this.featureGw];
      if (list) for (const c of list) tunnel = Math.min(tunnel, capsuleDist(x, y, z, c) - c.r);
    }
    if (tunnel < 3) d = Math.min(d, tunnel - this.detail.noise3(x / 5, y / 5, z / 5) * 0.8);
    const tb = this.tubeBounds;
    if (x > tb[0] && x < tb[3] && y > tb[1] && y < tb[4] && z > tb[2] && z < tb[5]) {
      let tube = Infinity;
      for (const c of this.tubes) tube = Math.min(tube, capsuleDist(x, y, z, c) - c.r);
      if (tube < 3) d = Math.min(d, tube - this.detail.noise3(x / 4, y / 4, z / 4) * 0.9);
    }
    for (const isl of this.islands) d = Math.max(d, this.islandDensity(x, y, z, isl));
    const feat = this.featureAt(x, y, z);
    if (feat) d = Math.max(d, feat.d);
    for (const c of this.cabins) {
      // Carve the room (slightly rounded box) so the cabin sits in open space.
      const w = c.cx * 2, dd = c.cz * 2;
      const qx = Math.abs(x - (c.x + w / 2)) - (w / 2 + 0.3), qy = Math.abs(y - (c.y + 1.45)) - 1.65, qz = Math.abs(z - (c.z + dd / 2)) - (dd / 2 + 0.3);
      if (qx > 2 || qy > 2 || qz > 2) continue;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      const box = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - 0.4;
      d = Math.min(d, box);
    }
    return Math.max(-DENSITY_CLAMP, Math.min(DENSITY_CLAMP, d));
  }

  /** 0..1: how strongly the glowing mushroom caverns claim this column. */
  mushroomStrength(x: number, z: number): number {
    return smoothstep(0.34, 0.52, this.shroomNoise.noise2(x / 95, z / 95));
  }

  /** Inside a mushroom cavern region (underground, in a strong zone). */
  mushroomAt(x: number, y: number, z: number): boolean {
    return y > SHROOM_MIN_Y - 3 && this.height(x, z) - y > 14 && this.mushroomStrength(x, z) > 0.5;
  }

  private caves(x: number, y: number, z: number, h: number): number {
    // A smooth floor under the deepest caverns (a hard cut here left a density
    // cliff that made the player bounce on the Ember Depths floor).
    if (y < 4) return DENSITY_CLAMP;
    const floor = 6 - y;
    const depth = h - y;
    // Spaghetti tunnels: intersection of two noise iso-surfaces.
    const a = this.caveA.noise3(x / 55, y / 30, z / 55);
    const b = this.caveB.noise3(x / 55, y / 30, z / 55);
    const t = Math.sqrt(a * a + b * b);
    // Tunnels only break the surface where the entrance mask allows it.
    const surfaceOpen = this.mask.noise2(x / 45 + 70, z / 45) > 0.45;
    const fade = surfaceOpen ? 1 : smoothstep(2, 10, depth);
    if (this.caveVersion >= 2) return Math.max(this.cavesV2(x, y, z, depth, t, fade), floor);
    let cave = (t - 0.075 * fade) * 36;
    // Large caverns at depth.
    if (depth > 18) {
      const c = this.cavern.noise3(x / 60, y / 38, z / 60) + this.cavern.noise3(x / 19, y / 19, z / 19) * 0.15;
      const k = smoothstep(18, 32, depth);
      cave = Math.min(cave, (0.5 - c * k) * 28);
    }
    // Mushroom zones: wide, flattened halls for the giant mushrooms.
    if (depth > 16 && y > SHROOM_MIN_Y - 4) {
      const mz = this.mushroomStrength(x, z);
      if (mz > 0) {
        const c2 = this.cavern.noise3(x / 34 + 50, y / 13, z / 34) + this.detail.noise3(x / 9, y / 9, z / 9) * 0.08;
        const k = smoothstep(16, 26, depth) * smoothstep(SHROOM_MIN_Y - 4, SHROOM_MIN_Y + 4, y);
        cave = Math.min(cave, (0.2 - c2 * mz * k) * 24);
      }
    }
    return Math.max(cave, floor);
  }

  /**
   * Caves v2: explorable cave systems. Tunnels swell and narrow (up to about
   * three times the old width), big caverns start closer to the surface, and
   * long, flat-floored halls open out lower down, with the tunnels threading
   * between them.
   */
  private cavesV2(x: number, y: number, z: number, depth: number, t: number, fade: number): number {
    const width = 0.08 + 0.07 * smoothstep(-0.3, 0.6, this.caveB.noise3(x / 90 + 40, y / 50, z / 90));
    let cave = (t - width * fade) * 30;
    // Caverns: large chambers from about 12 m down.
    if (depth > 10) {
      const c = this.cavern.noise3(x / 70, y / 34, z / 70) + this.cavern.noise3(x / 21, y / 21, z / 21) * 0.14;
      cave = Math.min(cave, (0.42 - c * smoothstep(10, 24, depth)) * 26);
    }
    // Halls: wide, low, flat-floored galleries deeper down (above the Ember Depths).
    if (depth > 22 && y > EMBER_Y + 4) {
      const hall = this.cavern.noise3(x / 120 + 300, y / 16, z / 120 - 200) + this.detail.noise3(x / 13, y / 9, z / 13) * 0.1;
      const k = smoothstep(22, 34, depth) * smoothstep(EMBER_Y + 4, EMBER_Y + 12, y);
      cave = Math.min(cave, (0.46 - hall * k) * 20);
    }
    // Mushroom zones: wide, flattened halls for the giant mushrooms.
    if (depth > 16 && y > SHROOM_MIN_Y - 4) {
      const mz = this.mushroomStrength(x, z);
      if (mz > 0) {
        const c2 = this.cavern.noise3(x / 34 + 50, y / 13, z / 34) + this.detail.noise3(x / 9, y / 9, z / 9) * 0.08;
        const k = smoothstep(16, 26, depth) * smoothstep(SHROOM_MIN_Y - 4, SHROOM_MIN_Y + 4, y);
        cave = Math.min(cave, (0.2 - c2 * mz * k) * 24);
      }
    }
    return cave;
  }

  /**
   * Caves v2: ways in from the surface. Cave mouths are wide, sloping,
   * winding tunnels that end in a chamber; sinkholes are open shafts that
   * drop into one. Kept clear of spawn, lakes, cabins and volcanoes.
   */
  private placeCaveMouths() {
    const rand = mulberry32(this.cfg.seed ^ 0xca7e);
    const area = (this.size.x * this.size.z) / (512 * 512);
    const all: Capsule[] = [];
    const want = Math.round(area * 26);
    for (let tries = 0; this.mouths.length < want && tries < 4000; tries++) {
      const x = 30 + rand() * (this.size.x - 60), z = 30 + rand() * (this.size.z - 60);
      const h = this.height(x, z);
      if (h < this.cfg.seaLevel + 4 || h > 150) continue;
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 45) continue;
      if (this.lakes.some(l => Math.hypot(l.x - x, l.z - z) < l.r * 1.8 + 12)) continue;
      if (this.volcanoAt(x, z)) continue;
      if (this.cabins.some(c => Math.hypot(c.x - x, c.z - z) < 24)) continue;
      if (this.mouths.some(m => Math.hypot(m.x - x, m.z - z) < 38)) continue;
      const sink = rand() < 0.3;
      const caps: Capsule[] = [];
      if (sink) {
        // A roughly round shaft, wandering a little as it drops.
        const r0 = 3.5 + rand() * 2.5, drop = 22 + rand() * 16;
        let px = x, py = h + 3, pz = z;
        const steps = 4;
        for (let i = 0; i < steps; i++) {
          const nx = px + (rand() - 0.5) * 3, nz = pz + (rand() - 0.5) * 3, ny = py - (drop + 3) / steps;
          caps.push({ ax: px, ay: py, az: pz, bx: nx, by: Math.max(EMBER_Y + 6, ny), bz: nz, r: r0 * (1 - i * 0.06) });
          px = nx; py = Math.max(EMBER_Y + 6, ny); pz = nz;
        }
        const a = rand() * Math.PI * 2, rc = 6 + rand() * 3;
        caps.push({ ax: px, ay: py, az: pz, bx: px + Math.cos(a) * 8, by: py - 1, bz: pz + Math.sin(a) * 8, r: rc });
      } else {
        // A cave mouth: a broad opening leading into a winding, sloping tunnel.
        let yaw = rand() * Math.PI * 2, pitch = -0.35 - rand() * 0.2;
        let px = x, py = h + 2, pz = z;
        const segs = 7 + Math.floor(rand() * 4);
        for (let i = 0; i < segs; i++) {
          const len = 5 + rand() * 3;
          const nx = px + Math.cos(yaw) * Math.cos(pitch) * len, nz = pz + Math.sin(yaw) * Math.cos(pitch) * len;
          const ny = Math.max(EMBER_Y + 8, py + Math.sin(pitch) * len);
          caps.push({ ax: px, ay: py, az: pz, bx: nx, by: ny, bz: nz, r: i < 2 ? 4.2 + rand() * 1.2 : 2.8 + rand() * 1.4 });
          px = nx; py = ny; pz = nz;
          yaw += (rand() - 0.5) * 0.8;
          pitch = Math.max(-0.75, Math.min(-0.15, pitch + (rand() - 0.5) * 0.4));
        }
        caps.push({ ax: px, ay: py, az: pz, bx: px + Math.cos(yaw) * 6, by: py + 1, bz: pz + Math.sin(yaw) * 6, r: 6 + rand() * 3 });
      }
      // Keep carved space off the world edges.
      if (caps.some(c => Math.min(c.ax, c.bx, c.az, c.bz) - c.r < 8 || Math.max(c.ax, c.bx) + c.r > this.size.x - 8 || Math.max(c.az, c.bz) + c.r > this.size.z - 8)) continue;
      this.mouths.push({ x, z, kind: sink ? 'sinkhole' : 'mouth' });
      all.push(...caps);
    }
    const gw = this.featureGw, gd = Math.ceil(this.size.z / FEATURE_CELL) + 1;
    this.carveGrid = Array.from({ length: gw * gd }, () => []);
    for (const c of all) {
      const r = c.r + 4;
      const x0 = Math.max(0, Math.floor((Math.min(c.ax, c.bx) - r) / FEATURE_CELL)), x1 = Math.min(gw - 1, Math.floor((Math.max(c.ax, c.bx) + r) / FEATURE_CELL));
      const z0 = Math.max(0, Math.floor((Math.min(c.az, c.bz) - r) / FEATURE_CELL)), z1 = Math.min(gd - 1, Math.floor((Math.max(c.az, c.bz) + r) / FEATURE_CELL));
      for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) this.carveGrid[gx + gz * gw].push(c);
    }
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

  materialFor(x: number, y: number, z: number, exposure: number, normalY: number): number {
    const h = this.height(x, z);
    const depth = h - y;
    if (y < 3 + this.detail.noise2(x / 5, z / 5) * 1.5) return Mat.Bedrock;
    const vol = this.volcanoAt(x, z);
    if (vol && y > EMBER_Y + 4 && depth > -12) { // (not the sky islands above)
      const { v, d: vd } = vol;
      const band = this.ore.noise3(x / 5 + 130, y / 5, z / 5);
      // The crater and the magma chamber glow; tube walls are streaked with obsidian.
      if (vd < v.rc * 1.25 && y > v.floor - 3) return band > 0.35 ? Mat.Obsidian : band < -0.2 ? Mat.Magmarock : Mat.Basalt;
      if (Math.hypot(x - v.chamber.x, y - v.chamber.y, z - v.chamber.z) < v.chamber.r + 2.5) return band > 0.4 ? Mat.Obsidian : band < 0 ? Mat.Magmarock : Mat.Basalt;
      if (depth < 1.8 && exposure < 1.5 && normalY > 0.6) return Mat.Ash;
      if (band > 0.62) return Mat.Magmarock;
      if (depth < 40) return Mat.Basalt;
    }
    const feat = this.featureAt(x, y, z);
    if (feat && feat.d > -0.9) {
      // Moss creeps over the tops of the Rootwold's roots.
      if (feat.mat === Mat.Rootwood && normalY > 0.62 && exposure < 1.2 && this.detail.noise2(x / 3, z / 3) > -0.3) return Mat.Moss;
      return feat.mat;
    }
    const biome = this.biomeAt(x, z);
    const sky = y > this.size.y - 40;
    const nearSurface = depth < 8 || sky;
    const lk = !sky ? this.lakeAt(x, z) : null;
    if (lk && y < lk.level + 1.2 && exposure < 2.5) return y > lk.level - 1.2 ? Mat.Sand : Mat.Clay;
    if (nearSurface && exposure < 1.5) {
      if (normalY < 0.55) {
        // Cliff faces: rock with bands of strata.
        const band = Math.sin(y * 0.7 + this.detail.noise2(x / 30, z / 30) * 3);
        if (biome === Biome.Desert && !sky) return band > 0.3 ? Mat.Sandstone : Mat.Sand;
        if (biome === Biome.Rift && !sky) return band > 0.85 ? Mat.Dirt : Mat.Riftstone;
        if (biome === Biome.Snow && !sky && band > 0.6) return Mat.Ice;
        if (biome === Biome.Ossuary && !sky) return band > 0.5 ? Mat.Salt : Mat.Sandstone;
        return band > 0.8 ? Mat.Dirt : band < -0.93 ? Mat.Clay : Mat.Stone;
      }
      if (y < this.cfg.seaLevel + 2.5 && !sky) return Mat.Sand;
      if (!sky) {
        if (biome === Biome.Desert) return Mat.Sand;
        if (biome === Biome.Snow) return Mat.Snow;
        if (biome === Biome.Rift) return Mat.Riftmoss;
        if (biome === Biome.Ossuary) return Mat.Salt;
        if (biome === Biome.Rootwold) return Mat.Moss;
        if (biome === Biome.Amberwood) return this.detail.noise2(x / 11, z / 11) > 0.3 ? Mat.Grass : Mat.Leaflitter;
      }
      if (y > 108 + this.detail.noise2(x / 20, z / 20) * 6 && !sky) return Mat.Snow;
      if (normalY < 0.75 && this.detail.noise2(x / 6, z / 6) > 0.35) return biome === Biome.Rift ? Mat.Riftstone : Mat.Stone;
      return Mat.Grass;
    }
    const dirtDepth = 3 + this.detail.noise2(x / 18, z / 18) * 2;
    if (nearSurface && exposure < dirtDepth) {
      if (y < this.cfg.seaLevel + 1.5 || biome === Biome.Desert) return Mat.Sand;
      if (biome === Biome.Snow) return exposure < 1.5 ? Mat.Snow : this.detail.noise3(x / 9, y / 9, z / 9) > 0.3 ? Mat.Ice : Mat.Dirt;
      if (biome === Biome.Ossuary) return exposure < 2 ? Mat.Salt : Mat.Sandstone;
      return Mat.Dirt;
    }
    // Sky islands: stone cores threaded with glowing aerite.
    if (sky) return this.ore.noise3(x / 4 + 200, y / 4, z / 4) > 0.4 ? Mat.Aerite : Mat.Stone;
    // Ember Depths: glowing emberstone with emberite veins near the bottom.
    const emberTop = EMBER_Y + this.detail.noise2(x / 30, z / 30) * 3;
    if (y < emberTop) return this.ore.noise3(x / 5 + 90, y / 5, z / 5) > 0.58 ? Mat.Emberite : Mat.Emberstone;
    if (depth > 4 && this.ore.noise3(x / 6, y / 6, z / 6) > 0.62) return y < 75 ? Mat.Copper : Mat.Stone;
    if (y < 48 && this.ore.noise3(x / 7 + 40, y / 7, z / 7) > 0.64) return Mat.Iron;
    if (y < 36 && this.ore.noise3(x / 5 - 40, y / 5, z / 5) > 0.7) return Mat.Lumite;
    // Glowing mushroom caverns: luminous floors over mud.
    if (depth > 14 && y > SHROOM_MIN_Y - 4 && this.mushroomStrength(x, z) > 0.5) {
      if (exposure < 1.2 && normalY > 0.35) return Mat.Mushgrass;
      return Mat.Mud;
    }
    if (depth > 5 && depth < 25 && this.detail.noise3(x / 25, y / 12, z / 25) > 0.55) return biome === Biome.Desert ? Mat.Sandstone : Mat.Clay;
    if (biome === Biome.Desert && depth < 30) return Mat.Sandstone;
    if (biome === Biome.Ossuary && depth < 26) return this.ore.noise3(x / 5 + 60, y / 5, z / 5) > 0.6 ? Mat.Fossil : Mat.Sandstone;
    // Rootwold: petrified taproots plunge through the rock.
    if (biome === Biome.Rootwold && y > 30 && Math.abs(this.detail.noise3(x / 9, y / 22, z / 9)) < 0.05) return Mat.Rootwood;
    // Amberwood: pockets of glowing resin in the shallow rock.
    if (biome === Biome.Amberwood && depth > 3 && y > 34 && this.ore.noise3(x / 4 - 70, y / 4, z / 4) > 0.64) return Mat.Amber;
    if (biome === Biome.Rift && y > 30) return Mat.Riftstone;
    if (biome === Biome.Snow && depth < 20 && this.detail.noise3(x / 12, y / 12, z / 12) > 0.45) return Mat.Ice;
    const deep = 30 + this.detail.noise2(x / 40, z / 40) * 5;
    return y < deep ? Mat.Deepstone : Mat.Stone;
  }

  // ------------------------------------------------------------------ filling

  /**
   * Sample density + material on a regular grid: sample (i,j,k) is at world
   * (ox + i*stride, oy + j*stride, oz + k*stride). Used for full-resolution
   * chunks (stride 1) and coarse far-distance LOD regions (stride 2..16).
   */
  sampleRegion(g: SampleGrid): boolean {
    const { nx, ny, nz, ox, oy, oz, stride: s, dens, mat } = g;
    // Fast path: the whole region is above every surface.
    let maxH = -Infinity;
    const x1 = ox + (nx - 1) * s, z1 = oz + (nz - 1) * s;
    for (let z = oz; z <= z1 + 3; z += 4)
      for (let x = ox; x <= x1 + 3; x += 4) maxH = Math.max(maxH, this.height(Math.min(x, x1), Math.min(z, z1)));
    const yTop = oy + (ny - 1) * s;
    const islandHere = this.islands.some(i => yTop > i.y - i.depth - 6 && oy < i.y + 8 &&
      i.x + i.r + 8 > ox && i.x - i.r - 8 < x1 && i.z + i.r + 8 > oz && i.z - i.r - 8 < z1);
    if (oy > maxH + 16 && !islandHere && oy > this.featureTop(ox, oz, x1, z1) + 2) {
      dens.fill(-DENSITY_CLAMP);
      mat.fill(Mat.Air);
      return false;
    }

    const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++)
          dens[idx(i, j, k)] = this.densityAt(ox + i * s, oy + j * s, oz + k * s);

    const dAt = (i: number, j: number, k: number) => {
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return this.densityAt(ox + i * s, oy + j * s, oz + k * s);
      return dens[idx(i, j, k)];
    };
    // Materials, top-down per column so we know how much solid lies above.
    const probe = Math.ceil(5 / s);
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        // Solid metres directly above the region's top sample.
        let above = 0;
        for (let q = 1; q <= probe; q++) {
          if (this.densityAt(ox + i * s, yTop + q * s, oz + k * s) <= 0) break;
          above += s;
        }
        for (let j = ny - 1; j >= 0; j--) {
          const id = idx(i, j, k);
          if (dens[id] <= 0) { above = -s; mat[id] = Mat.Air; }
          else {
            let nY = 1;
            if (above < 3) {
              const gx = dAt(i + 1, j, k) - dAt(i - 1, j, k);
              const gy = dAt(i, j + 1, k) - dAt(i, j - 1, k);
              const gz = dAt(i, j, k + 1) - dAt(i, j, k - 1);
              const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
              nY = -gy / len;
            }
            mat[id] = this.materialFor(ox + i * s, oy + j * s, oz + k * s, Math.max(0, above), nY);
          }
          above += s;
        }
      }
    return true;
  }

  /** Topmost surface point at (x,z) straight down, from the pure generator. */
  surfaceAt(x: number, z: number): { y: number; ny: number; mat: number } | null {
    let top = this.height(x, z) + 16;
    for (const i of this.islands) if ((x - i.x) ** 2 + (z - i.z) ** 2 < (i.r + 6) ** 2) top = Math.max(top, i.y + 8);
    top = Math.min(top, this.size.y - 2);
    if (this.densityAt(x, top, z) > 0) return null;
    for (let y = top - 0.8; y > 1; y -= 0.8) {
      const v = this.densityAt(x, y, z);
      if (v > 0) {
        let lo = y + 0.8, hi = y;
        for (let it = 0; it < 7; it++) {
          const mid = (lo + hi) / 2;
          if (this.densityAt(x, mid, z) > 0) hi = mid; else lo = mid;
        }
        const gy = this.densityAt(x, lo + 0.3, z) - this.densityAt(x, lo - 0.3, z);
        const gx = this.densityAt(x + 0.3, lo, z) - this.densityAt(x - 0.3, lo, z);
        const gz = this.densityAt(x, lo, z + 0.3) - this.densityAt(x, lo, z - 0.3);
        const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
        const nY = -gy / len;
        return { y: lo, ny: nY, mat: this.materialFor(x, lo - 0.5, z, 0, nY) };
      }
    }
    return null;
  }
}

function capsuleDist(x: number, y: number, z: number, c: Capsule): number {
  const bax = c.bx - c.ax, bay = c.by - c.ay, baz = c.bz - c.az;
  const pax = x - c.ax, pay = y - c.ay, paz = z - c.az;
  const t = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  const ex = pax - bax * t, ey = pay - bay * t, ez = paz - baz * t;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}
