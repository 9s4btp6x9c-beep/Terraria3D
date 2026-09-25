// Deterministic placement of trees, grass tufts and flowers on the generated
// surface. Pure data — rendering lives in render/vegetationRenderer.ts.

import { SimplexNoise, hash3 } from '../core/noise';
import type { WorldGenerator } from './generator';
import { Mat } from './materials';
import type { TerrainField } from './terrain';

export type TreeKind = 'tall' | 'round' | 'pine';

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

export interface Tuft { x: number; y: number; z: number; rot: number; scale: number; flower: boolean; alive: boolean }

export const TREE_VARIANTS = 4;
export const TREE_KINDS: TreeKind[] = ['tall', 'round', 'pine'];

export class Vegetation {
  readonly trees: Tree[] = [];
  readonly tufts: Tuft[] = [];
  private treeGrid = new Map<number, Tree[]>();
  private tuftGrid = new Map<number, number[]>();

  constructor(private field: TerrainField, gen: WorldGenerator) {
    const seed = field.cfg.seed;
    const forest = new SimplexNoise(seed + 21);
    const sea = field.cfg.seaLevel;
    const spawn = gen.spawn;

    // Trees on a jittered grid, density driven by a forest noise mask.
    const cell = 6;
    let id = 0;
    for (let gz = 0; gz < field.sz / cell; gz++)
      for (let gx = 0; gx < field.sx / cell; gx++) {
        const r1 = hash3(gx, gz, 1, seed), r2 = hash3(gx, gz, 2, seed), r3 = hash3(gx, gz, 3, seed);
        const x = (gx + 0.15 + r1 * 0.7) * cell, z = (gz + 0.15 + r2 * 0.7) * cell;
        const dens = forest.fbm2(x / 90, z / 90, 3) * 0.5 + 0.5;
        if (r3 > dens * 1.05 - 0.2) continue;
        if (Math.hypot(x - spawn.x, z - spawn.z) < 5) continue;
        const s = this.surface(x, z);
        if (!s || s.mat !== Mat.Grass || s.ny < 0.82 || s.y < sea + 1.5) continue;
        const r4 = hash3(gx, gz, 4, seed);
        const kind: TreeKind = s.y > 100 ? 'pine' : dens > 0.62 ? 'tall' : r4 < 0.5 ? 'round' : 'tall';
        const height = kind === 'tall' ? 12 + r4 * 8 : kind === 'pine' ? 8 + r4 * 5 : 6 + r4 * 3;
        const tree: Tree = { id: id++, x, y: s.y - 0.3, z, kind, variant: Math.floor(hash3(gx, gz, 5, seed) * TREE_VARIANTS), height, radius: kind === 'round' ? 0.45 : 0.35, hp: 5, alive: true };
        this.trees.push(tree);
        const key = this.key(x, z, 8);
        (this.treeGrid.get(key) ?? this.treeGrid.set(key, []).get(key)!).push(tree);
      }

    // Grass tufts + flowers.
    const tcell = 1.6;
    for (let gz = 0; gz < field.sz / tcell; gz++)
      for (let gx = 0; gx < field.sx / tcell; gx++) {
        const r1 = hash3(gx, gz, 11, seed), r2 = hash3(gx, gz, 12, seed), r3 = hash3(gx, gz, 13, seed);
        const x = (gx + r1) * tcell, z = (gz + r2) * tcell;
        if (forest.noise2(x / 14 + 9, z / 14) < -0.35) continue;
        const s = this.surface(x, z);
        if (!s || s.mat !== Mat.Grass || s.ny < 0.7 || s.y < sea + 1) continue;
        const idx = this.tufts.length;
        this.tufts.push({ x, y: s.y - 0.05, z, rot: r3 * Math.PI * 2, scale: 0.7 + r3 * 0.6, flower: r3 > 0.94, alive: true });
        const key = this.key(x, z, 4);
        (this.tuftGrid.get(key) ?? this.tuftGrid.set(key, []).get(key)!).push(idx);
      }
  }

  private key(x: number, z: number, cell: number) {
    return Math.floor(x / cell) * 65536 + Math.floor(z / cell);
  }

  /** Topmost surface hit straight down (includes sky islands). */
  private surface(x: number, z: number) {
    const hit = this.field.raycast(x, this.field.sy - 2, z, 0, -1, 0, this.field.sy, 0.8);
    if (!hit) return null;
    return { y: hit.y, ny: hit.ny, mat: hit.material };
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

  /** Remove tufts within a sphere (after mining). Returns indices changed. */
  clearTufts(x: number, y: number, z: number, r: number): number[] {
    const changed: number[] = [];
    const c = 4;
    for (let gz = Math.floor((z - r) / c); gz <= Math.floor((z + r) / c); gz++)
      for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++) {
        const list = this.tuftGrid.get(gx * 65536 + gz);
        if (!list) continue;
        for (const i of list) {
          const t = this.tufts[i];
          if (t.alive && (t.x - x) ** 2 + (t.y - y) ** 2 + (t.z - z) ** 2 < r * r) {
            t.alive = false;
            changed.push(i);
          }
        }
      }
    return changed;
  }
}
