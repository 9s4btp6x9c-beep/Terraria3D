// Furniture: placeable world objects (crafting stations, torches, doors,
// chests, chairs...). Each has an oriented box collider expressed as an SDF
// (so it plugs into the same physics as terrain), optional light, station
// role and interaction (doors open, chests store items, beds set spawn).

import type { Stack } from '../items/inventory';
import type { FurnitureId, StationId } from '../items/items';
import { BUILD_CELL, Y_SNAP } from './structures';

export interface FurnitureDef {
  id: FurnitureId;
  name: string;
  /** Full size (x, y, z) before rotation; z = depth, front faces +z. */
  size: [number, number, number];
  placement: 'floor' | 'surface' | 'wallslot';
  collide: boolean;
  station?: StationId;
  light?: { color: number; range: number; offset: [number, number, number]; flicker: number };
  hp: number;
  /** Counts as seating / table / light / door for housing checks. */
  housing?: 'chair' | 'table' | 'light' | 'door' | 'bed';
}

export const FURNITURE: Record<FurnitureId, FurnitureDef> = {
  workbench: { id: 'workbench', name: 'Workbench', size: [1.6, 0.9, 0.8], placement: 'floor', collide: true, station: 'workbench', hp: 3, housing: 'table' },
  furnace: { id: 'furnace', name: 'Furnace', size: [1.2, 1.55, 1.1], placement: 'floor', collide: true, station: 'furnace', hp: 4, light: { color: 0xff8a3a, range: 11, offset: [0, 0.45, 0.6], flicker: 1 } },
  anvil: { id: 'anvil', name: 'Iron Anvil', size: [1.0, 0.85, 0.55], placement: 'floor', collide: true, station: 'anvil', hp: 4 },
  forge: { id: 'forge', name: 'Lumite Forge', size: [1.6, 1.7, 1.2], placement: 'floor', collide: true, station: 'forge', hp: 5, light: { color: 0x46d0ff, range: 10, offset: [0, 1.3, 0], flicker: 0.4 } },
  chair: { id: 'chair', name: 'Wooden Chair', size: [0.6, 1.1, 0.6], placement: 'floor', collide: true, hp: 2, housing: 'chair' },
  table: { id: 'table', name: 'Wooden Table', size: [1.6, 0.85, 1.0], placement: 'floor', collide: true, hp: 2, housing: 'table' },
  door: { id: 'door', name: 'Wooden Door', size: [2, 2.5, 0.2], placement: 'wallslot', collide: true, hp: 3, housing: 'door' },
  torch: { id: 'torch', name: 'Torch', size: [0.2, 0.62, 0.2], placement: 'surface', collide: false, hp: 1, housing: 'light', light: { color: 0xffa048, range: 12, offset: [0, 0.62, 0], flicker: 1 } },
  chest: { id: 'chest', name: 'Chest', size: [1.0, 0.8, 0.7], placement: 'floor', collide: true, hp: 3 },
  bed: { id: 'bed', name: 'Bed', size: [1.2, 0.65, 2.2], placement: 'floor', collide: true, hp: 3, housing: 'bed' },
};

export const CHEST_SLOTS = 20;

export interface Placed {
  uid: number;
  type: FurnitureId;
  /** Base point (bottom centre) in world space. */
  x: number; y: number; z: number;
  /** Quarter turns around Y. */
  rot: number;
  /** Wall-mounted (torches): outward normal of the surface. */
  wall?: [number, number, number];
  open?: boolean;
  chest?: (Stack | null)[];
  hp: number;
}

export interface FurnitureHit { f: Placed; distance: number; x: number; y: number; z: number; nx: number; ny: number; nz: number }

export interface Box { c: [number, number, number]; h: [number, number, number] }

/** Local boxes (x across, y up, z depth) before rotation. */
function localBoxes(f: Placed): Box[] {
  const [sx, sy, sz] = FURNITURE[f.type].size;
  if (f.type === 'door') {
    // 2 m wall slot: side panels + lintel + a 1.2 m hinged leaf.
    const leaf: Box = f.open
      ? { c: [-0.55, 1.15, 0.6], h: [0.05, 1.15, 0.6] }
      : { c: [0, 1.15, 0], h: [0.6, 1.15, 0.05] };
    return [
      { c: [-0.8, 1.25, 0], h: [0.2, 1.25, 0.1] },
      { c: [0.8, 1.25, 0], h: [0.2, 1.25, 0.1] },
      { c: [0, 2.4, 0], h: [0.6, 0.1, 0.1] },
      leaf,
    ];
  }
  return [{ c: [0, sy / 2, 0], h: [sx / 2, sy / 2, sz / 2] }];
}

/** Collider boxes in world space (quarter-turn rotations keep them axis-aligned). */
export function boxes(f: Placed): Box[] {
  const a = f.rot * Math.PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
  return localBoxes(f).map(b => ({
    c: [f.x + b.c[0] * c + b.c[2] * s, f.y + b.c[1], f.z - b.c[0] * s + b.c[2] * c],
    h: f.rot % 2 === 0 ? b.h : [b.h[2], b.h[1], b.h[0]],
  }));
}

function boxSDF(b: Box, x: number, y: number, z: number) {
  const qx = Math.abs(x - b.c[0]) - b.h[0], qy = Math.abs(y - b.c[1]) - b.h[1], qz = Math.abs(z - b.c[2]) - b.h[2];
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}

export function furnitureSDF(f: Placed, x: number, y: number, z: number): number {
  let d = Infinity;
  for (const b of boxes(f)) d = Math.min(d, boxSDF(b, x, y, z));
  return d;
}

/** Whole-object bounds (for picking and overlap tests). */
export function bounds(f: Placed): Box {
  const [sx, sy, sz] = FURNITURE[f.type].size;
  const h: [number, number, number] = f.rot % 2 === 0 ? [sx / 2, sy / 2, sz / 2] : [sz / 2, sy / 2, sx / 2];
  return { c: [f.x, f.y + sy / 2, f.z], h };
}

export class FurnitureSet {
  readonly items = new Map<number, Placed>();
  private nextId = 1;
  version = 0;

  add(p: Omit<Placed, 'uid' | 'hp'>): Placed {
    const f: Placed = { ...p, uid: this.nextId++, hp: FURNITURE[p.type].hp };
    if (p.type === 'chest' && !f.chest) f.chest = new Array(CHEST_SLOTS).fill(null);
    this.items.set(f.uid, f);
    this.version++;
    return f;
  }

  remove(uid: number) {
    if (this.items.delete(uid)) this.version++;
  }

  changed() { this.version++; }

  near(x: number, y: number, z: number, r: number): Placed[] {
    const out: Placed[] = [];
    for (const f of this.items.values())
      if (Math.abs(f.x - x) < r + 2 && Math.abs(f.y - y) < r + 3 && Math.abs(f.z - z) < r + 2) out.push(f);
    return out;
  }

  colliders(x: number, y: number, z: number, r: number): Placed[] {
    return this.near(x, y, z, r).filter(f => FURNITURE[f.type].collide);
  }

  static distance(list: Placed[], x: number, y: number, z: number): number {
    let d = Infinity;
    for (const f of list) d = Math.min(d, furnitureSDF(f, x, y, z));
    return d;
  }

  stationsNear(x: number, y: number, z: number, r = 4.5): Set<StationId> {
    const s = new Set<StationId>();
    for (const f of this.near(x, y, z, r)) {
      const st = FURNITURE[f.type].station;
      if (st && Math.hypot(f.x - x, f.y - y, f.z - z) < r) s.add(st);
    }
    return s;
  }

  /** Ray vs furniture boxes (slab test). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): FurnitureHit | null {
    let best: FurnitureHit | null = null;
    for (const f of this.near(ox, oy, oz, maxDist + 2)) {
      const bb = bounds(f);
      const [cx, cy, cz] = bb.c;
      let [hx, hy, hz] = bb.h;
      // Small objects get a slightly larger pick box.
      hx = Math.max(hx, 0.18); hy = Math.max(hy, 0.18); hz = Math.max(hz, 0.18);
      let t0 = 0, t1 = maxDist, axis = -1, sign = 1;
      const o = [ox - cx, oy - cy, oz - cz], d = [dx, dy, dz], h = [hx, hy, hz];
      let ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(d[a]) < 1e-8) { if (Math.abs(o[a]) > h[a]) ok = false; continue; }
        let n = (-h[a] - o[a]) / d[a], m = (h[a] - o[a]) / d[a];
        let s = -1;
        if (n > m) { [n, m] = [m, n]; s = 1; }
        if (n > t0) { t0 = n; axis = a; sign = s; }
        t1 = Math.min(t1, m);
        if (t0 > t1) ok = false;
      }
      if (!ok || (best && t0 >= best.distance)) continue;
      const nrm = [0, 0, 0];
      if (axis >= 0) nrm[axis] = sign;
      best = { f, distance: t0, x: ox + dx * t0, y: oy + dy * t0, z: oz + dz * t0, nx: nrm[0], ny: nrm[1], nz: nrm[2] };
    }
    return best;
  }

  /**
   * Placement transform for a furniture type aimed at a surface point.
   * Floor items sit on the point facing the player; wall-slot items (doors)
   * snap to building-grid edges; surface items (torches) mount on walls.
   */
  static snap(type: FurnitureId, px: number, py: number, pz: number, nx: number, ny: number, nz: number, yaw: number) {
    const def = FURNITURE[type];
    // Face the player: local +z toward the camera.
    const facing = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
    if (def.placement === 'wallslot') {
      const qx = px + nx * 0.05, qy = py + ny * 0.05, qz = pz + nz * 0.05;
      const ix = Math.floor(qx / BUILD_CELL), iz = Math.floor(qz / BUILD_CELL);
      const fx = qx - ix * BUILD_CELL, fz = qz - iz * BUILD_CELL;
      const y = Math.floor(qy / Y_SNAP) * Y_SNAP;
      const ex = Math.min(fx, BUILD_CELL - fx), ez = Math.min(fz, BUILD_CELL - fz);
      if (ex < ez) return { x: ix * BUILD_CELL + (fx < BUILD_CELL / 2 ? 0 : BUILD_CELL), y, z: iz * BUILD_CELL + BUILD_CELL / 2, rot: 1, wall: undefined };
      return { x: ix * BUILD_CELL + BUILD_CELL / 2, y, z: iz * BUILD_CELL + (fz < BUILD_CELL / 2 ? 0 : BUILD_CELL), rot: 0, wall: undefined };
    }
    const snap = (v: number) => Math.round(v * 4) / 4;
    if (def.placement === 'surface' && ny < 0.6) {
      // Wall torch: mount slightly out from the wall, tilted outward.
      const l = Math.hypot(nx, nz) || 1;
      return { x: px + (nx / l) * 0.12, y: py - 0.35, z: pz + (nz / l) * 0.12, rot: facing, wall: [nx / l, 0, nz / l] as [number, number, number] };
    }
    return { x: snap(px), y: py - 0.02, z: snap(pz), rot: facing, wall: undefined };
  }

  serialize(): Placed[] {
    return [...this.items.values()].map(f => ({ ...f, chest: f.chest?.map(s => (s ? { ...s } : null)) }));
  }

  load(list: Placed[]) {
    this.items.clear();
    for (const f of list) {
      this.items.set(f.uid, { ...f });
      this.nextId = Math.max(this.nextId, f.uid + 1);
    }
    this.version++;
  }
}
