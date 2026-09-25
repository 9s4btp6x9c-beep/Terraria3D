// Save/load. The generated world is a pure function of the seed, so a save
// only stores what the player changed: an ordered log of terrain CSG edits,
// placed building pieces, felled trees, the inventory and the player state.
// Edits are indexed by chunk; whenever a chunk streams in, the edits touching
// it are replayed in order on top of freshly generated data.

import type { Piece } from '../building/structures';
import type { Stack } from '../items/inventory';
import { CHUNK, type WorldConfig, worldSize } from './config';
import { type TerrainEdit, editBounds } from './edits';
import type { TerrainField } from './terrain';

export type { TerrainEdit } from './edits';

export interface SaveData {
  version: 1;
  seed: number;
  edits: TerrainEdit[];
  pieces: Piece[];
  treesRemoved: number[];
  inventory: (Stack | null)[];
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  savedAt: number;
  /** Optional extension blocks (added by later systems). */
  extra?: Record<string, unknown>;
}

const KEY = 'terraria3d.save.v2';

const r2 = (v: number) => Math.round(v * 100) / 100;

export class EditLog {
  readonly edits: TerrainEdit[] = [];
  private byChunk = new Map<number, number[]>();
  private size: { x: number; y: number; z: number };

  constructor(private cfg: WorldConfig) {
    this.size = worldSize(cfg);
  }

  private chunkKey(cx: number, cy: number, cz: number) {
    return cx + this.cfg.chunksX * (cy + this.cfg.chunksY * cz);
  }

  private index(e: TerrainEdit, i: number) {
    const b = editBounds(e, this.size);
    // One sample of slack: a chunk's padded grid reads its neighbours' samples.
    for (let cz = Math.max(0, (b[2] - 1) >> 5); cz <= Math.min(this.cfg.chunksZ - 1, (b[5] + 1) >> 5); cz++)
      for (let cy = Math.max(0, (b[1] - 1) >> 5); cy <= Math.min(this.cfg.chunksY - 1, (b[4] + 1) >> 5); cy++)
        for (let cx = Math.max(0, (b[0] - 1) >> 5); cx <= Math.min(this.cfg.chunksX - 1, (b[3] + 1) >> 5); cx++) {
          const k = this.chunkKey(cx, cy, cz);
          const list = this.byChunk.get(k);
          if (list) list.push(i); else this.byChunk.set(k, [i]);
        }
  }

  /** Record and apply an edit. Values are rounded first so replay is exact. */
  commit(field: TerrainField, mode: 'sub' | 'add', x: number, y: number, z: number, r: number, mat: number, maxTier: number) {
    const e: TerrainEdit = [mode === 'sub' ? 0 : 1, r2(x), r2(y), r2(z), r2(r), mat, maxTier];
    this.index(e, this.edits.length);
    this.edits.push(e);
    return field.applyEdit(e);
  }

  /** Load edits from a save without applying (chunks replay them when they stream in). */
  load(edits: TerrainEdit[]) {
    for (const e of edits) {
      this.index(e, this.edits.length);
      this.edits.push(e);
    }
  }

  /** Edits (in order) that may touch the world-space box, optionally only those at index >= from. */
  forRegion(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, from = 0): TerrainEdit[] {
    const ids = new Set<number>();
    for (let cz = Math.max(0, Math.floor(z0 / CHUNK)); cz <= Math.min(this.cfg.chunksZ - 1, Math.floor(z1 / CHUNK)); cz++)
      for (let cy = Math.max(0, Math.floor(y0 / CHUNK)); cy <= Math.min(this.cfg.chunksY - 1, Math.floor(y1 / CHUNK)); cy++)
        for (let cx = Math.max(0, Math.floor(x0 / CHUNK)); cx <= Math.min(this.cfg.chunksX - 1, Math.floor(x1 / CHUNK)); cx++) {
          const list = this.byChunk.get(this.chunkKey(cx, cy, cz));
          if (list) for (const i of list) if (i >= from) ids.add(i);
        }
    return [...ids].sort((a, b) => a - b).map(i => this.edits[i]);
  }

  /** Edits for a chunk's padded grid. */
  forChunk(cx: number, cy: number, cz: number, from = 0) {
    return this.forRegion(cx * CHUNK - 1, cy * CHUNK - 1, cz * CHUNK - 1, cx * CHUNK + CHUNK, cy * CHUNK + CHUNK, cz * CHUNK + CHUNK, from);
  }
}

export function writeSave(data: SaveData, storage: Storage | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave(storage: Storage | null = safeStorage()): SaveData | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    return data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

export function clearSave(storage: Storage | null = safeStorage()) {
  try { storage?.removeItem(KEY); } catch { /* storage unavailable */ }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
