// Save/load. The generated world is a pure function of the seed, so a save
// only stores what the player changed: an ordered log of terrain CSG edits,
// placed building pieces, felled trees, the inventory and the player state.
// Loading regenerates the world and replays the edit log.

import type { Piece } from '../building/structures';
import type { Stack } from '../items/inventory';
import type { TerrainField } from './terrain';

/** [mode(0=sub,1=add), x, y, z, radius, material, maxTier] */
export type TerrainEdit = [number, number, number, number, number, number, number];

export interface SaveData {
  version: 1;
  seed: number;
  edits: TerrainEdit[];
  pieces: Piece[];
  treesRemoved: number[];
  inventory: (Stack | null)[];
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  savedAt: number;
}

const KEY = 'terraria3d.save.v1';

const r2 = (v: number) => Math.round(v * 100) / 100;

export class EditLog {
  readonly edits: TerrainEdit[] = [];

  /** Record and apply an edit. Values are rounded first so replay is exact. */
  commit(field: TerrainField, mode: 'sub' | 'add', x: number, y: number, z: number, r: number, mat: number, maxTier: number) {
    const e: TerrainEdit = [mode === 'sub' ? 0 : 1, r2(x), r2(y), r2(z), r2(r), mat, maxTier];
    this.edits.push(e);
    return EditLog.apply(field, e);
  }

  static apply(field: TerrainField, e: TerrainEdit) {
    return field.sphere(e[1], e[2], e[3], e[4], e[0] === 0 ? 'sub' : 'add', e[5], e[6]);
  }

  replay(field: TerrainField, edits: TerrainEdit[]) {
    for (const e of edits) {
      EditLog.apply(field, e);
      this.edits.push(e);
    }
  }
}

export function writeSave(data: SaveData, storage: Storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(data));
}

export function readSave(storage: Storage = localStorage): SaveData | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    return data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

export function clearSave(storage: Storage = localStorage) {
  storage.removeItem(KEY);
}
