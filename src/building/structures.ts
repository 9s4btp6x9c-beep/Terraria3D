// Modular building pieces. Pieces live on a 2 m horizontal building grid (a
// placement aid only — terrain is not gridded) with 0.25 m vertical snapping.
// Each piece is an oriented box or wedge with an analytic SDF, so it plugs into
// the same distance-based collision and ray queries as the terrain.

import type { PieceShape } from '../items/items';

export const BUILD_CELL = 2;
export const WALL_H = 2.5;
export const Y_SNAP = 0.25;

export interface PieceDef {
  shape: PieceShape;
  name: string;
  cost: number;
  hp: number;
  /** Half extents in local space (before tilt). */
  half: [number, number, number];
  /** Local offset of the box centre above the piece's base point. */
  lift: number;
  tilt: number;
  wedge?: boolean;
}

export const PIECES: Record<PieceShape, PieceDef> = {
  floor: { shape: 'floor', name: 'Floor', cost: 2, hp: 3, half: [1, 0.125, 1], lift: 0.125, tilt: 0 },
  wall: { shape: 'wall', name: 'Wall', cost: 3, hp: 4, half: [1, WALL_H / 2, 0.1], lift: WALL_H / 2, tilt: 0 },
  pillar: { shape: 'pillar', name: 'Pillar', cost: 1, hp: 3, half: [0.18, WALL_H / 2, 0.18], lift: WALL_H / 2, tilt: 0 },
  stairs: { shape: 'stairs', name: 'Stairs', cost: 4, hp: 4, half: [1, WALL_H / 2, 1], lift: WALL_H / 2, tilt: 0, wedge: true },
  roof: { shape: 'roof', name: 'Roof', cost: 3, hp: 3, half: [1, 0.1, Math.SQRT2], lift: 1, tilt: -Math.PI / 4 },
};
export const SHAPES: PieceShape[] = ['floor', 'wall', 'pillar', 'stairs', 'roof'];

export interface Piece {
  id: number;
  shape: PieceShape;
  texture: 'planks' | 'bricks';
  /** Base point (bottom centre) in world space. */
  x: number; y: number; z: number;
  /** Quarter turns around Y. */
  rot: number;
  hp: number;
}

export interface PieceHit { piece: Piece; x: number; y: number; z: number; nx: number; ny: number; nz: number; distance: number }

/** Signed distance from a world point to a piece. */
export function pieceSDF(p: Piece, x: number, y: number, z: number): number {
  const def = PIECES[p.shape];
  // To local space: translate, undo Y rotation, undo tilt about local X.
  let lx = x - p.x, ly = y - (p.y + def.lift), lz = z - p.z;
  const a = -p.rot * Math.PI / 2;
  const c = Math.cos(a), s = Math.sin(a);
  const rx = lx * c + lz * s, rz = -lx * s + lz * c;
  lx = rx; lz = rz;
  if (def.tilt) {
    const ct = Math.cos(-def.tilt), st = Math.sin(-def.tilt);
    const ty = ly * ct - lz * st, tz = ly * st + lz * ct;
    ly = ty; lz = tz;
  }
  const [hx, hy, hz] = def.half;
  const qx = Math.abs(lx) - hx, qy = Math.abs(ly) - hy, qz = Math.abs(lz) - hz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  let d = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
  if (def.wedge) {
    // Ramp rising toward local +z: solid below the plane through the diagonal.
    const nY = 2 * hz, nZ = -2 * hy, len = Math.sqrt(nY * nY + nZ * nZ);
    d = Math.max(d, (ly * nY + lz * nZ) / len);
  }
  return d;
}

export class Structures {
  readonly pieces = new Map<number, Piece>();
  private nextId = 1;
  version = 0;

  add(p: Omit<Piece, 'id' | 'hp'>): Piece {
    const piece: Piece = { ...p, id: this.nextId++, hp: PIECES[p.shape].hp };
    this.pieces.set(piece.id, piece);
    this.version++;
    return piece;
  }

  remove(id: number) {
    if (this.pieces.delete(id)) this.version++;
  }

  near(x: number, y: number, z: number, r: number): Piece[] {
    const out: Piece[] = [];
    for (const p of this.pieces.values())
      if (Math.abs(p.x - x) < r + 3 && Math.abs(p.y - y) < r + 4 && Math.abs(p.z - z) < r + 3) out.push(p);
    return out;
  }

  /** Min distance to any of the given pieces. */
  static distance(list: Piece[], x: number, y: number, z: number): number {
    let d = Infinity;
    for (const p of list) d = Math.min(d, pieceSDF(p, x, y, z));
    return d;
  }

  /** Sphere-trace a ray against pieces. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): PieceHit | null {
    const list = this.near(ox + dx * maxDist / 2, oy + dy * maxDist / 2, oz + dz * maxDist / 2, maxDist / 2 + 1);
    if (list.length === 0) return null;
    let t = 0;
    for (let i = 0; i < 96 && t < maxDist; i++) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      let best: Piece | null = null, d = Infinity;
      for (const p of list) {
        const pd = pieceSDF(p, x, y, z);
        if (pd < d) { d = pd; best = p; }
      }
      if (d < 0.01 && best) {
        const e = 0.01;
        const nx = pieceSDF(best, x + e, y, z) - pieceSDF(best, x - e, y, z);
        const ny = pieceSDF(best, x, y + e, z) - pieceSDF(best, x, y - e, z);
        const nz = pieceSDF(best, x, y, z + e) - pieceSDF(best, x, y, z - e);
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        return { piece: best, x, y, z, nx: nx / l, ny: ny / l, nz: nz / l, distance: t };
      }
      t += Math.max(d * 0.9, 0.005);
    }
    return null;
  }

  /**
   * Snap a placement for `shape` given an aimed surface point + normal and the
   * player's yaw. Returns the piece transform (not yet added).
   */
  static snap(shape: PieceShape, px: number, py: number, pz: number, nx: number, ny: number, nz: number, yaw: number) {
    const qx = px + nx * 0.05, qy = py + ny * 0.05, qz = pz + nz * 0.05;
    const ix = Math.floor(qx / BUILD_CELL), iz = Math.floor(qz / BUILD_CELL);
    const y = Math.floor(qy / Y_SNAP) * Y_SNAP;
    const cx = ix * BUILD_CELL + BUILD_CELL / 2, cz = iz * BUILD_CELL + BUILD_CELL / 2;
    const fx = qx - ix * BUILD_CELL, fz = qz - iz * BUILD_CELL;
    // Quarter turn whose local +z points where the player looks (camera
    // forward is (-sin yaw, -cos yaw)); stairs/roofs rise away from the player.
    const facing = ((Math.round((yaw + Math.PI) / (Math.PI / 2)) % 4) + 4) % 4;
    switch (shape) {
      case 'wall': {
        const ex = Math.min(fx, BUILD_CELL - fx), ez = Math.min(fz, BUILD_CELL - fz);
        if (ex < ez) return { x: ix * BUILD_CELL + (fx < BUILD_CELL / 2 ? 0 : BUILD_CELL), y, z: cz, rot: 1 };
        return { x: cx, y, z: iz * BUILD_CELL + (fz < BUILD_CELL / 2 ? 0 : BUILD_CELL), rot: 0 };
      }
      case 'pillar':
        return { x: ix * BUILD_CELL + Math.round(fx / BUILD_CELL) * BUILD_CELL, y, z: iz * BUILD_CELL + Math.round(fz / BUILD_CELL) * BUILD_CELL, rot: 0 };
      case 'stairs':
      case 'roof':
        return { x: cx, y, z: cz, rot: facing };
      default:
        return { x: cx, y, z: cz, rot: 0 };
    }
  }

  occupied(shape: PieceShape, x: number, y: number, z: number, rot: number): boolean {
    for (const p of this.pieces.values())
      if (p.shape === shape && Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01 && Math.abs(p.z - z) < 0.01 && (p.rot % 2 === rot % 2 || shape === 'pillar' || shape === 'floor')) return true;
    return false;
  }

  serialize() {
    return [...this.pieces.values()].map(p => ({ ...p }));
  }

  load(list: Piece[]) {
    this.pieces.clear();
    for (const p of list) {
      this.pieces.set(p.id, { ...p });
      this.nextId = Math.max(this.nextId, p.id + 1);
    }
    this.version++;
  }
}
