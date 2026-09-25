// Deterministic placement of trees, grass tufts and flowers. Pure data —
// rendering lives in render/vegetationRenderer.ts.
//
// Trees are placed once for the whole world from the pure generator (cheap
// surface probes). Grass tufts are dense, so they are generated lazily per
// 8 m cell from the live field near the player and regenerated after edits
// (mined grass never grows back as floating tufts).

import { SimplexNoise, hash3 } from '../core/noise';
import { Biome, type WorldGenerator } from './generator';
import { Mat } from './materials';
import type { SkyMap } from './skymap';
import type { TerrainField } from './terrain';

export type TreeKind = 'tall' | 'round' | 'pine' | 'cactus' | 'dead';

export interface Tree {
  id: number;
  x: number; y: number; z: number;
  kind: TreeKind;
  variant: number;
  height: number;
  radius: number;
  hp: number;
  alive: boolean;
}

export interface Tuft { x: number; y: number; z: number; rot: number; scale: number; flower: boolean }

export const TREE_VARIANTS = 4;
export const TREE_KINDS: TreeKind[] = ['tall', 'round', 'pine', 'cactus', 'dead'];
export const TUFT_CELL = 8;

export class Vegetation {
  readonly trees: Tree[] = [];
  private treeGrid = new Map<number, Tree[]>();
  private tuftCells = new Map<number, Tuft[]>();
  private forest: SimplexNoise;
  private seed: number;
  /** Bumped whenever tuft cells change (renderer rebuilds its instances). */
  tuftVersion = 0;

  constructor(private field: TerrainField, private gen: WorldGenerator, private sky: SkyMap) {
    this.seed = field.cfg.seed;
    this.forest = new SimplexNoise(this.seed + 21);
    const sea = field.cfg.seaLevel;
    const spawn = gen.spawn;
    const cell = 6;
    let id = 0;
    for (let gz = 0; gz < field.sz / cell; gz++)
      for (let gx = 0; gx < field.sx / cell; gx++) {
        const s = this.seed;
        const r1 = hash3(gx, gz, 1, s), r2 = hash3(gx, gz, 2, s), r3 = hash3(gx, gz, 3, s);
        const x = (gx + 0.15 + r1 * 0.7) * cell, z = (gz + 0.15 + r2 * 0.7) * cell;
        const biome = gen.biomeAt(x, z);
        let dens = this.forest.fbm2(x / 90, z / 90, 3) * 0.5 + 0.5;
        if (biome === Biome.Desert) dens = 0.28;
        if (biome === Biome.Snow) dens *= 0.8;
        if (r3 > dens * 1.05 - 0.2) continue;
        if (Math.hypot(x - spawn.x, z - spawn.z) < 5) continue;
        const h = gen.height(x, z);
        if (h < sea + 1.5) continue;
        const surf = gen.surfaceAt(x, z);
        const ground = { [Mat.Grass]: true, [Mat.Sand]: biome === Biome.Desert, [Mat.Snow]: biome === Biome.Snow, [Mat.Blightgrass]: true } as Record<number, boolean>;
        if (!surf || !ground[surf.mat] || surf.ny < 0.82 || surf.y < sea + 1.5) continue;
        const r4 = hash3(gx, gz, 4, s);
        const kind: TreeKind = biome === Biome.Desert ? 'cactus' : biome === Biome.Blight ? 'dead'
          : surf.y > 100 || biome === Biome.Snow ? 'pine' : dens > 0.62 ? 'tall' : r4 < 0.5 ? 'round' : 'tall';
        const height = { tall: 12 + r4 * 8, pine: 8 + r4 * 5, round: 6 + r4 * 3, cactus: 3 + r4 * 2.5, dead: 7 + r4 * 5 }[kind];
        const tree: Tree = {
          id: id++, x, y: surf.y - 0.3, z, kind, variant: Math.floor(hash3(gx, gz, 5, s) * TREE_VARIANTS),
          height, radius: kind === 'round' ? 0.45 : kind === 'cactus' ? 0.3 : 0.35, hp: kind === 'cactus' ? 3 : 5, alive: true,
        };
        this.trees.push(tree);
        const key = this.key(x, z, 8);
        (this.treeGrid.get(key) ?? this.treeGrid.set(key, []).get(key)!).push(tree);
      }
  }

  private key(x: number, z: number, cell: number) {
    return Math.floor(x / cell) * 65536 + Math.floor(z / cell);
  }

  treesNear(x: number, z: number, radius: number): Tree[] {
    const out: Tree[] = [];
    const c = 8;
    for (let gz = Math.floor((z - radius) / c); gz <= Math.floor((z + radius) / c); gz++)
      for (let gx = Math.floor((x - radius) / c); gx <= Math.floor((x + radius) / c); gx++) {
        const list = this.treeGrid.get(gx * 65536 + gz);
        if (list) for (const t of list) if (t.alive) out.push(t);
      }
    return out;
  }

  /** Trees near an edit whose base is no longer supported by ground. */
  unsupportedTrees(x: number, z: number, r: number): Tree[] {
    return this.treesNear(x, z, r + 1).filter(t => {
      for (const [ox, oz] of [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]])
        if (this.field.sample(t.x + ox, t.y - 0.1, t.z + oz) > 0 || this.field.sample(t.x + ox, t.y - 0.6, t.z + oz) > 0) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------- tufts

  private tuftKey(cx: number, cz: number) { return cx * 65536 + cz; }

  tuftsCached(cx: number, cz: number): Tuft[] | null {
    return this.tuftCells.get(this.tuftKey(cx, cz)) ?? null;
  }

  /** Tufts for a cell, generated on demand; null until the terrain there is loaded. */
  tufts(cx: number, cz: number): Tuft[] | null {
    const k = this.tuftKey(cx, cz);
    const cached = this.tuftCells.get(k);
    if (cached) return cached;
    const x0 = cx * TUFT_CELL, z0 = cz * TUFT_CELL;
    if (x0 < 0 || z0 < 0 || x0 >= this.field.sx || z0 >= this.field.sz) return [];
    for (let y = 0; y < this.field.sy; y += 32) if (!this.field.isResident(x0 + 4, y, z0 + 4)) return null;
    const out: Tuft[] = [];
    const step = 1.6;
    const sea = this.field.cfg.seaLevel;
    const s = this.seed;
    for (let j = 0; j < TUFT_CELL / step; j++)
      for (let i = 0; i < TUFT_CELL / step; i++) {
        const gx = cx * 5 + i, gz = cz * 5 + j;
        const r1 = hash3(gx, gz, 11, s), r2 = hash3(gx, gz, 12, s), r3 = hash3(gx, gz, 13, s);
        const x = x0 + (i + r1) * step, z = z0 + (j + r2) * step;
        if (this.forest.noise2(x / 14 + 9, z / 14) < -0.35) continue;
        const surf = this.surface(x, z);
        if (!surf || surf.material !== Mat.Grass || surf.ny < 0.7 || surf.y < sea + 1) continue;
        out.push({ x, y: surf.y - 0.05, z, rot: r3 * Math.PI * 2, scale: 0.7 + r3 * 0.6, flower: r3 > 0.94 });
      }
    this.tuftCells.set(k, out);
    this.tuftVersion++;
    return out;
  }

  private surface(x: number, z: number) {
    let top = this.sky.raw[Math.min(this.sky.w - 1, Math.floor(x)) + Math.min(this.sky.d - 1, Math.floor(z)) * this.sky.w] + 3;
    for (const i of this.gen.islands) if ((x - i.x) ** 2 + (z - i.z) ** 2 < (i.r + 6) ** 2) top = Math.max(top, i.y + 8);
    top = Math.min(top, this.field.sy - 2);
    return this.field.raycast(x, top, z, 0, -1, 0, top, 0.5);
  }

  /** Drop cached tuft cells overlapping an area (regenerated on next request). */
  invalidateTufts(x: number, z: number, r: number) {
    for (let cz = Math.floor((z - r) / TUFT_CELL); cz <= Math.floor((z + r) / TUFT_CELL); cz++)
      for (let cx = Math.floor((x - r) / TUFT_CELL); cx <= Math.floor((x + r) / TUFT_CELL); cx++) {
        if (this.tuftCells.delete(this.tuftKey(cx, cz))) this.tuftVersion++;
      }
  }

  /** Forget far cells to bound memory. */
  trimTufts(x: number, z: number, keepRadius: number) {
    for (const k of this.tuftCells.keys()) {
      const cx = Math.floor(k / 65536), cz = k % 65536;
      if (Math.hypot((cx + 0.5) * TUFT_CELL - x, (cz + 0.5) * TUFT_CELL - z) > keepRadius) this.tuftCells.delete(k);
    }
  }
}
