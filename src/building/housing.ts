// Housing check (Terraria's "valid house" rule, in 3D): flood-fill air on a
// 0.5 m grid from a point inside a room. The room is valid if the fill is
// enclosed (never escapes the search box), has a reasonable volume, and
// contains a light source, a seat, a table surface and a door in its walls.

import type { TerrainField } from '../world/terrain';
import { FURNITURE, FurnitureSet, type Placed } from './furniture';
import { Structures } from './structures';

export interface HousingResult {
  ok: boolean;
  missing: string[];
  volume: number;
  /** Centre of the room's air (for NPC homes). */
  center: { x: number; y: number; z: number };
}

const CELL = 0.5;
const HALF_X = 12, HALF_Y = 6;
const MIN_VOLUME = 12, MAX_VOLUME = 700;

export function checkHousing(field: TerrainField, structures: Structures, furniture: FurnitureSet, x: number, y: number, z: number): HousingResult {
  const nx = (HALF_X * 2) / CELL, ny = (HALF_Y * 2) / CELL, nz = nx;
  const ox = x - HALF_X, oy = y - HALF_Y + 1, oz = z - HALF_X;
  const pieces = structures.near(x, y, z, HALF_X + 2);
  // Doors count as walls whether open or closed.
  const furn: Placed[] = furniture.near(x, y, z, HALF_X + 2);
  const solids = furn.filter(f => FURNITURE[f.type].collide).map(f => (f.type === 'door' ? { ...f, open: false } : f));
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const state = new Uint8Array(nx * ny * nz); // 0 unknown, 1 solid, 2 air visited
  const solid = (i: number, j: number, k: number) => {
    const px = ox + (i + 0.5) * CELL, py = oy + (j + 0.5) * CELL, pz = oz + (k + 0.5) * CELL;
    if (field.sample(px, py, pz) > -0.15) return true;
    if (pieces.length && Structures.distance(pieces, px, py, pz) < 0.3) return true;
    if (solids.length && FurnitureSet.distance(solids, px, py, pz) < 0.3) return true;
    return false;
  };
  const start = [Math.floor((x - ox) / CELL), Math.floor((y + 0.9 - oy) / CELL), Math.floor((z - oz) / CELL)];
  const empty = { ok: false, missing: ['Stand inside a room'], volume: 0, center: { x, y, z } };
  if (solid(start[0], start[1], start[2])) return empty;
  const queue = [idx(start[0], start[1], start[2])];
  state[queue[0]] = 2;
  let count = 0, sx = 0, sy = 0, sz = 0;
  let leaked = false;
  const maxCells = MAX_VOLUME / CELL ** 3;
  while (queue.length) {
    const c = queue.pop()!;
    const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
    count++;
    sx += i; sy += j; sz += k;
    if (count > maxCells) { leaked = true; break; }
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di, b = j + dj, e = k + dk;
      if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz) { leaked = true; break; }
      const n = idx(a, b, e);
      if (state[n]) continue;
      if (solid(a, b, e)) { state[n] = 1; continue; }
      state[n] = 2;
      queue.push(n);
    }
    if (leaked) break;
  }
  const volume = count * CELL ** 3;
  const center = { x: ox + (sx / count + 0.5) * CELL, y: oy + (sy / count + 0.5) * CELL, z: oz + (sz / count + 0.5) * CELL };
  if (leaked) return { ok: false, missing: ['Room is not enclosed (walls, floor and ceiling needed)'], volume, center };

  const inside = (f: Placed) => {
    const i = Math.floor((f.x - ox) / CELL), j = Math.floor((f.y + 0.3 - oy) / CELL), k = Math.floor((f.z - oz) / CELL);
    for (let dj = 0; dj <= 3; dj++)
      for (let di = -2; di <= 2; di++)
        for (let dk = -2; dk <= 2; dk++) {
          const a = i + di, b = j + dj, e = k + dk;
          if (a >= 0 && b >= 0 && e >= 0 && a < nx && b < ny && e < nz && state[idx(a, b, e)] === 2) return true;
        }
    return false;
  };
  const roles = new Set(furn.filter(inside).map(f => FURNITURE[f.type].housing ?? (FURNITURE[f.type].light ? 'light' : null)));
  // A door counts if it sits in the room's boundary.
  const hasDoor = furn.some(f => f.type === 'door' && inside({ ...f, x: f.x, y: f.y, z: f.z }));
  const missing: string[] = [];
  if (volume < MIN_VOLUME) missing.push('Room is too small');
  if (volume > MAX_VOLUME) missing.push('Room is too large');
  if (!hasDoor) missing.push('Needs a door');
  if (!roles.has('light')) missing.push('Needs a light source (torch)');
  if (!roles.has('chair')) missing.push('Needs a chair');
  if (!roles.has('table')) missing.push('Needs a table or workbench');
  return { ok: missing.length === 0, missing, volume, center };
}
