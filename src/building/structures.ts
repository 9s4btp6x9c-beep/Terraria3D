// Modular building pieces. Pieces live on a 2 m horizontal building grid (a
// placement aid only — terrain is not gridded): cell pieces (foundations,
// floors, stairs, roofs) sit in a cell, edge pieces (walls, doorways, windows,
// fences, gables, beams) run along a cell edge and pillars stand on corners.
// Each piece is a small set of oriented boxes with an analytic SDF, so it
// plugs into the same distance-based collision and ray queries as terrain.
//
// Placement snaps to what is already built: walls stack exactly on walls and
// stand on floor tops, floors lie level with their neighbours or on top of
// walls (a second storey), roofs rest on wall tops and continue each other's
// slope. Foundations reach down into the ground so a base stays level on a
// hillside.

export const BUILD_CELL = 2;
export const WALL_H = 2.5;
export const Y_SNAP = 0.25;

export type PieceShape =
  | 'foundation' | 'floor' | 'wall' | 'doorway' | 'window' | 'halfwall' | 'fence'
  | 'pillar' | 'beam' | 'stairs' | 'roof' | 'roof26' | 'gable' | 'gable26';
export type PieceSlot = 'cell' | 'edge' | 'corner';

/** Surface textures pieces can be built from, and the item each costs. */
export type BuildTexture = 'planks' | 'bricks' | 'rootplanks' | 'saltbricks' | 'bonebricks';
export interface BuildMaterial { texture: BuildTexture; item: string; name: string }
export const BUILD_MATERIALS: BuildMaterial[] = [
  { texture: 'planks', item: 'wood', name: 'Wood' },
  { texture: 'bricks', item: 'stone', name: 'Stone' },
  { texture: 'rootplanks', item: 'rootwood', name: 'Petrified Root' },
  { texture: 'saltbricks', item: 'salt', name: 'Salt Brick' },
  { texture: 'bonebricks', item: 'fossil', name: 'Titan Bone' },
];
export function buildMaterial(texture: BuildTexture): BuildMaterial {
  return BUILD_MATERIALS.find(m => m.texture === texture) ?? BUILD_MATERIALS[0];
}

/** One box of a piece, in the piece's local space (base point origin, front +z). */
export interface Part {
  c: [number, number, number];
  h: [number, number, number];
  /** Rotation about local x (roof slabs). */
  tilt?: number;
  /** Ramp rising toward +z (stairs). */
  wedge?: boolean;
  /** Triangle: solid only below y = (x + hx) * slope, measured from the box bottom (gables). */
  slope?: number;
  /** Texture layer override (window glass). */
  layer?: 'glass';
}

export interface PieceDef {
  shape: PieceShape;
  name: string;
  category: 'structure' | 'roof';
  slot: PieceSlot;
  cost: number;
  hp: number;
  /** Height of the top surface above the base (what the next piece stacks on). */
  top: number;
  /** Rise over one cell for roofs. */
  rise?: number;
  description: string;
  parts(p: { ext?: number }): Part[];
}

const R2 = Math.SQRT2;
const r26 = Math.atan2(1, 2), l26 = Math.hypot(2, 1) / 2;

export const PIECES: Record<PieceShape, PieceDef> = {
  foundation: {
    shape: 'foundation', name: 'Foundation', category: 'structure', slot: 'cell', cost: 4, hp: 6, top: 0.5,
    description: 'A level platform that reaches down into the ground. Start every base with these.',
    parts: p => {
      const out: Part[] = [{ c: [0, 0.25, 0], h: [1, 0.25, 1] }];
      const e = p.ext ?? 0;
      if (e > 0.01) out.push({ c: [0, -e / 2, 0], h: [0.92, e / 2, 0.92] });
      return out;
    },
  },
  floor: {
    shape: 'floor', name: 'Floor', category: 'structure', slot: 'cell', cost: 2, hp: 3, top: 0.25,
    description: 'Floors and ceilings. Snaps level with its neighbours or onto wall tops.',
    parts: () => [{ c: [0, 0.125, 0], h: [1, 0.125, 1] }],
  },
  wall: {
    shape: 'wall', name: 'Wall', category: 'structure', slot: 'edge', cost: 3, hp: 4, top: WALL_H,
    description: 'A full wall. Walls stack exactly on top of each other.',
    parts: () => [{ c: [0, WALL_H / 2, 0], h: [1, WALL_H / 2, 0.1] }],
  },
  doorway: {
    shape: 'doorway', name: 'Doorway', category: 'structure', slot: 'edge', cost: 3, hp: 4, top: WALL_H,
    description: 'A wall with an opening. Doors snap into it.',
    parts: () => [
      { c: [-0.8, WALL_H / 2, 0], h: [0.2, WALL_H / 2, 0.12] },
      { c: [0.8, WALL_H / 2, 0], h: [0.2, WALL_H / 2, 0.12] },
      { c: [0, 2.35, 0], h: [0.6, 0.15, 0.12] },
    ],
  },
  window: {
    shape: 'window', name: 'Window', category: 'structure', slot: 'edge', cost: 3, hp: 4, top: WALL_H,
    description: 'A wall with a glazed window.',
    parts: () => [
      { c: [0, 0.5, 0], h: [1, 0.5, 0.1] },
      { c: [0, 2.05, 0], h: [1, 0.45, 0.1] },
      { c: [-0.75, 1.3, 0], h: [0.25, 0.3, 0.1] },
      { c: [0.75, 1.3, 0], h: [0.25, 0.3, 0.1] },
      { c: [0, 1.3, 0], h: [0.5, 0.3, 0.025], layer: 'glass' },
    ],
  },
  halfwall: {
    shape: 'halfwall', name: 'Half Wall', category: 'structure', slot: 'edge', cost: 2, hp: 3, top: 1.25,
    description: 'Waist-high wall for balconies and counters.',
    parts: () => [{ c: [0, 0.625, 0], h: [1, 0.625, 0.1] }],
  },
  fence: {
    shape: 'fence', name: 'Fence', category: 'structure', slot: 'edge', cost: 1, hp: 2, top: 1.1,
    description: 'Posts and rails.',
    parts: () => [
      { c: [-0.9, 0.55, 0], h: [0.08, 0.55, 0.08] },
      { c: [0.9, 0.55, 0], h: [0.08, 0.55, 0.08] },
      { c: [0, 0.88, 0], h: [1, 0.05, 0.04] },
      { c: [0, 0.48, 0], h: [1, 0.05, 0.04] },
    ],
  },
  pillar: {
    shape: 'pillar', name: 'Post', category: 'structure', slot: 'corner', cost: 1, hp: 3, top: WALL_H,
    description: 'A corner post.',
    parts: () => [{ c: [0, WALL_H / 2, 0], h: [0.18, WALL_H / 2, 0.18] }],
  },
  beam: {
    shape: 'beam', name: 'Beam', category: 'structure', slot: 'edge', cost: 1, hp: 3, top: 0.3,
    description: 'A horizontal beam. Floors and roofs rest on it.',
    parts: () => [{ c: [0, 0.15, 0], h: [1, 0.15, 0.15] }],
  },
  stairs: {
    shape: 'stairs', name: 'Stairs', category: 'structure', slot: 'cell', cost: 4, hp: 4, top: WALL_H,
    description: 'One storey of stairs, rising away from you.',
    parts: () => [{ c: [0, WALL_H / 2, 0], h: [1, WALL_H / 2, 1], wedge: true }],
  },
  roof: {
    shape: 'roof', name: 'Steep Roof', category: 'roof', slot: 'cell', cost: 3, hp: 3, top: 2, rise: 2,
    description: 'A 45° roof panel rising away from you. Rests on wall tops.',
    parts: () => [{ c: [0, 1, 0], h: [1, 0.1, R2 + 0.08], tilt: -Math.PI / 4 }],
  },
  roof26: {
    shape: 'roof26', name: 'Low Roof', category: 'roof', slot: 'cell', cost: 3, hp: 3, top: 1, rise: 1,
    description: 'A gentle 26° roof panel rising away from you.',
    parts: () => [{ c: [0, 0.5, 0], h: [1, 0.1, l26 + 0.08], tilt: -r26 }],
  },
  gable: {
    shape: 'gable', name: 'Steep Gable', category: 'roof', slot: 'edge', cost: 2, hp: 3, top: 2,
    description: 'Triangular wall that closes the end of a steep roof. [R] flips it.',
    parts: () => [{ c: [0, 1, 0], h: [1, 1, 0.1], slope: 1 }],
  },
  gable26: {
    shape: 'gable26', name: 'Low Gable', category: 'roof', slot: 'edge', cost: 2, hp: 3, top: 1,
    description: 'Triangular wall that closes the end of a low roof. [R] flips it.',
    parts: () => [{ c: [0, 0.5, 0], h: [1, 0.5, 0.1], slope: 0.5 }],
  },
};
export const SHAPES = Object.keys(PIECES) as PieceShape[];

export interface Piece {
  id: number;
  shape: PieceShape;
  texture: BuildTexture;
  /** Base point (bottom centre) in world space. */
  x: number; y: number; z: number;
  /** Quarter turns around Y. */
  rot: number;
  /** Foundations: how far the footing reaches below the base. */
  ext?: number;
  hp: number;
}

export interface PieceHit { piece: Piece; x: number; y: number; z: number; nx: number; ny: number; nz: number; distance: number }

/** Signed distance from a point to one part (point already in piece-local space). */
function partSDF(part: Part, lx: number, ly: number, lz: number): number {
  let x = lx - part.c[0], y = ly - part.c[1], z = lz - part.c[2];
  if (part.tilt) {
    const ct = Math.cos(-part.tilt), st = Math.sin(-part.tilt);
    const ty = y * ct - z * st, tz = y * st + z * ct;
    y = ty; z = tz;
  }
  const [hx, hy, hz] = part.h;
  const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  let d = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
  if (part.wedge) {
    // Ramp rising toward local +z: solid below the plane through the diagonal.
    const nY = 2 * hz, nZ = -2 * hy, len = Math.sqrt(nY * nY + nZ * nZ);
    d = Math.max(d, (y * nY + z * nZ) / len);
  }
  if (part.slope !== undefined) {
    // Solid below the line rising from the -x bottom corner.
    const s = part.slope;
    d = Math.max(d, ((y + hy) - (x + hx) * s) / Math.sqrt(1 + s * s));
  }
  return d;
}

/** Point in world space to a piece's local space. */
function toLocal(p: Piece, x: number, y: number, z: number): [number, number, number] {
  const lx = x - p.x, ly = y - p.y, lz = z - p.z;
  const a = -p.rot * Math.PI / 2;
  const c = Math.cos(a), s = Math.sin(a);
  return [lx * c + lz * s, ly, -lx * s + lz * c];
}

/** Signed distance from a world point to a piece. */
export function pieceSDF(p: Piece, x: number, y: number, z: number): number {
  const [lx, ly, lz] = toLocal(p, x, y, z);
  let d = Infinity;
  for (const part of PIECES[p.shape].parts(p)) d = Math.min(d, partSDF(part, lx, ly, lz));
  return d;
}

/** Sample points on a piece's surface in world space (box corners and bottom centres). */
export function pieceSamplePoints(p: Omit<Piece, 'id' | 'hp'>): [number, number, number][] {
  const out: [number, number, number][] = [];
  const a = p.rot * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
  const w = (x: number, y: number, z: number): [number, number, number] => [p.x + x * c + z * s, p.y + y, p.z - x * s + z * c];
  for (const part of PIECES[p.shape].parts(p)) {
    const ct = Math.cos(part.tilt ?? 0), st = Math.sin(part.tilt ?? 0);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      let x = sx * part.h[0], y = sy * part.h[1], z = sz * part.h[2];
      if (part.tilt) { const ty = y * ct - z * st, tz = y * st + z * ct; y = ty; z = tz; }
      out.push(w(part.c[0] + x, part.c[1] + y, part.c[2] + z));
    }
    out.push(w(part.c[0], part.c[1] - part.h[1], part.c[2]));
  }
  return out;
}

const GRID = 8;
export const REGION = 32;
const cellKey = (x: number, z: number) => Math.floor(x / GRID) * 65536 + Math.floor(z / GRID);
export const regionKey = (x: number, z: number) => Math.floor(x / REGION) * 4096 + Math.floor(z / REGION);

/** Where a new piece would go. */
export interface Placement { x: number; y: number; z: number; rot: number; ext?: number; snapped: boolean }

export interface PlaceOptions {
  /** Extra quarter turns chosen by the player ([R]). */
  turn?: number;
  /** Skip snapping to other pieces (grid and aim height only). */
  free?: boolean;
  /** Terrain surface height near (x, z), searching around `nearY`; null if none. */
  ground?: (x: number, z: number, nearY: number) => number | null;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.05;

export class Structures {
  readonly pieces = new Map<number, Piece>();
  private grid = new Map<number, Set<Piece>>();
  /** Render regions (32 m) touched since the renderer last looked. */
  readonly dirtyRegions = new Set<number>();
  private nextId = 1;
  version = 0;

  private index(p: Piece, add: boolean) {
    const k = cellKey(p.x, p.z);
    let set = this.grid.get(k);
    if (add) { if (!set) this.grid.set(k, set = new Set()); set.add(p); }
    else set?.delete(p);
    this.dirtyRegions.add(regionKey(p.x, p.z));
  }

  add(p: Omit<Piece, 'id' | 'hp'>): Piece {
    const piece: Piece = { ...p, id: this.nextId++, hp: PIECES[p.shape].hp };
    this.pieces.set(piece.id, piece);
    this.index(piece, true);
    this.version++;
    return piece;
  }

  remove(id: number) {
    const p = this.pieces.get(id);
    if (!p) return;
    this.pieces.delete(id);
    this.index(p, false);
    this.version++;
  }

  near(x: number, y: number, z: number, r: number): Piece[] {
    const out: Piece[] = [];
    const R = r + 3;
    for (let gx = Math.floor((x - R) / GRID); gx <= Math.floor((x + R) / GRID); gx++)
      for (let gz = Math.floor((z - R) / GRID); gz <= Math.floor((z + R) / GRID); gz++) {
        const set = this.grid.get(gx * 65536 + gz);
        if (!set) continue;
        for (const p of set)
          if (Math.abs(p.x - x) < R && Math.abs(p.y - y) < r + 4 + (p.ext ?? 0) && Math.abs(p.z - z) < R) out.push(p);
      }
    return out;
  }

  inRegion(key: number): Piece[] {
    const out: Piece[] = [];
    for (const p of this.pieces.values()) if (regionKey(p.x, p.z) === key) out.push(p);
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
   * Grid snap for `shape` given an aimed surface point + normal and the
   * player's yaw: which cell, edge or corner, the facing, and the aimed
   * height (0.25 m steps). `turn` adds quarter turns.
   */
  static snap(shape: PieceShape, px: number, py: number, pz: number, nx: number, ny: number, nz: number, yaw: number, turn = 0) {
    const slot = PIECES[shape].slot;
    let qx = px + nx * 0.05, qy = py + ny * 0.05, qz = pz + nz * 0.05;
    // Cell pieces aimed at the top of a wall go on the far side of it.
    if (slot === 'cell' && ny > 0.7) { qx -= Math.sin(yaw) * 0.3; qz -= Math.cos(yaw) * 0.3; }
    const ix = Math.floor(qx / BUILD_CELL), iz = Math.floor(qz / BUILD_CELL);
    const y = Math.floor(qy / Y_SNAP) * Y_SNAP;
    const cx = ix * BUILD_CELL + BUILD_CELL / 2, cz = iz * BUILD_CELL + BUILD_CELL / 2;
    const fx = qx - ix * BUILD_CELL, fz = qz - iz * BUILD_CELL;
    // Quarter turn whose local +z points where the player looks (camera
    // forward is (-sin yaw, -cos yaw)); stairs/roofs rise away from the player.
    const facing = ((Math.round((yaw + Math.PI) / (Math.PI / 2)) + turn) % 4 + 4) % 4;
    if (slot === 'edge') {
      const flip = (turn % 2 + 2) % 2 ? 2 : 0;
      const ex = Math.min(fx, BUILD_CELL - fx), ez = Math.min(fz, BUILD_CELL - fz);
      if (ex < ez) return { x: ix * BUILD_CELL + (fx < BUILD_CELL / 2 ? 0 : BUILD_CELL), y, z: cz, rot: 1 + flip };
      return { x: cx, y, z: iz * BUILD_CELL + (fz < BUILD_CELL / 2 ? 0 : BUILD_CELL), rot: flip };
    }
    if (slot === 'corner')
      return { x: ix * BUILD_CELL + Math.round(fx / BUILD_CELL) * BUILD_CELL, y, z: iz * BUILD_CELL + Math.round(fz / BUILD_CELL) * BUILD_CELL, rot: 0 };
    if (shape === 'stairs' || PIECES[shape].category === 'roof') return { x: cx, y, z: cz, rot: facing };
    return { x: cx, y, z: cz, rot: 0 };
  }

  /**
   * Full placement: the grid snap, then the height snapped to what is
   * already built nearby (unless `free`), and foundation footings.
   */
  place(shape: PieceShape, aimX: number, aimY: number, aimZ: number, nx: number, ny: number, nz: number, yaw: number, opts: PlaceOptions = {}): Placement {
    const base = Structures.snap(shape, aimX, aimY, aimZ, nx, ny, nz, yaw, opts.turn ?? 0);
    const def = PIECES[shape];
    let y = base.y, snapped = false;
    if (!opts.free) {
      const levels = this.levels(shape, base.x, base.z, base.rot, base.y);
      let best = Infinity;
      for (const l of levels) {
        if (this.occupied(shape, base.x, l, base.z, base.rot)) continue;
        const d = Math.abs(l - aimY);
        if (d < best && d < 2.6) { best = d; y = l; snapped = true; }
      }
    }
    const out: Placement = { x: base.x, y, z: base.z, rot: base.rot, snapped };
    if (shape === 'foundation' && opts.ground) {
      // Stand on the ground: top clear of the highest corner unless levelled
      // to a neighbour, footing reaching below the lowest one.
      const g = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9], [0, 0]]
        .map(([dx, dz]) => opts.ground!(base.x + dx, base.z + dz, aimY)).filter((v): v is number => v !== null);
      if (g.length) {
        const lo = Math.min(...g), hi = Math.max(...g);
        if (!snapped) out.y = Math.ceil((hi + 0.05 - def.top) / Y_SNAP) * Y_SNAP;
        out.ext = Math.max(0, Math.round((out.y - lo + 0.6) * 4) / 4);
      }
    }
    return out;
  }

  /** Heights (piece base) the new piece could snap to, from pieces near its slot. */
  levels(shape: PieceShape, x: number, z: number, rot: number, aimY: number): number[] {
    const def = PIECES[shape];
    const out: number[] = [];
    const topOf = (p: Piece) => p.y + PIECES[p.shape].top;
    const slotOf = (p: Piece) => PIECES[p.shape].slot;
    const along = (r: number) => (r % 2 === 0 ? 'x' : 'z');
    for (const p of this.near(x, aimY, z, 3.5)) {
      const ps = slotOf(p), pdef = PIECES[p.shape];
      const dx = p.x - x, dz = p.z - z;
      if (def.slot === 'edge' || def.slot === 'corner') {
        const sameSlot = near(dx, 0) && near(dz, 0) && (def.slot === 'corner' || ps !== 'edge' || along(p.rot) === along(rot));
        // Stack on the piece already in this slot (walls on walls, gables on walls).
        if (sameSlot && ps === def.slot && pdef.category === 'structure') out.push(topOf(p));
        // Stand on a floor or foundation beside this edge / around this corner.
        if (ps === 'cell' && (p.shape === 'floor' || p.shape === 'foundation')) {
          const touches = def.slot === 'corner'
            ? near(Math.abs(dx), 1) && near(Math.abs(dz), 1)
            : along(rot) === 'x' ? near(dx, 0) && near(Math.abs(dz), 1) : near(dz, 0) && near(Math.abs(dx), 1);
          if (touches) out.push(topOf(p));
        }
        // Beams sit on post tops at their ends; posts on beam-free corners stack on posts.
        if (shape === 'beam' && ps === 'corner') {
          const end = along(rot) === 'x' ? near(Math.abs(dx), 1) && near(dz, 0) : near(Math.abs(dz), 1) && near(dx, 0);
          if (end) out.push(topOf(p));
        }
        // Walls also continue level with the wall next to them.
        if (ps === 'edge' && pdef.category === 'structure' && def.category === 'structure' && !sameSlot && along(p.rot) === along(rot)) {
          const inLine = along(rot) === 'x' ? near(Math.abs(dx), 2) && near(dz, 0) : near(Math.abs(dz), 2) && near(dx, 0);
          if (inLine) out.push(p.y);
        }
      } else if (def.category === 'roof') {
        const f = rot % 4, fx = [0, 1, 0, -1][f], fz = [1, 0, -1, 0][f];
        // Low edge of the panel (its back) rests on a wall or beam top.
        if (ps === 'edge') {
          const bx = x - fx, bz = z - fz; // midpoint of the back edge
          if (near(p.x, bx) && near(p.z, bz)) out.push(topOf(p));
          else if (near(Math.abs(dx) + Math.abs(dz), 1)) out.push(topOf(p));
        }
        if (PIECES[p.shape].category === 'roof' && p.rot % 4 === f) {
          const rise = def.rise ?? 2;
          if (near(dx, -2 * fx) && near(dz, -2 * fz)) out.push(p.y + (pdef.rise ?? 2)); // continue up the slope
          else if (near(dx, 2 * fx) && near(dz, 2 * fz)) out.push(p.y - rise);
          else if (near(Math.abs(dx) + Math.abs(dz), 2)) out.push(p.y); // side by side
        }
      } else {
        // Floors, foundations, stairs.
        const adjacent = near(Math.abs(dx) + Math.abs(dz), 2) && (near(dx, 0) || near(dz, 0));
        const same = near(dx, 0) && near(dz, 0);
        if (ps === 'cell' && (p.shape === 'floor' || p.shape === 'foundation')) {
          if (adjacent) out.push(topOf(p) - def.top); // level with the neighbour
          if (same && shape !== p.shape) out.push(topOf(p)); // floor or stairs on a foundation
        }
        if (ps === 'edge' || ps === 'corner') {
          // Resting on the walls, beams or posts around this cell.
          const onEdge = ps === 'edge' && near(Math.abs(dx) + Math.abs(dz), 1);
          const onCorner = ps === 'corner' && near(Math.abs(dx), 1) && near(Math.abs(dz), 1);
          if ((onEdge || onCorner) && pdef.category === 'structure') out.push(shape === 'stairs' ? p.y : topOf(p));
        }
        if (p.shape === 'stairs' && adjacent) out.push(topOf(p) - (shape === 'stairs' ? 0 : def.top));
      }
    }
    return out;
  }

  /** Is this slot already taken by a piece of the same kind at the same height? */
  occupied(shape: PieceShape, x: number, y: number, z: number, rot: number): boolean {
    const slot = PIECES[shape].slot;
    for (const p of this.near(x, y, z, 1)) {
      const d = PIECES[p.shape];
      if (d.slot !== slot || Math.abs(p.x - x) > 0.01 || Math.abs(p.z - z) > 0.01 || Math.abs(p.y - y) > 0.01) continue;
      if (slot === 'edge' && p.rot % 2 !== rot % 2) continue;
      return true;
    }
    return false;
  }

  serialize() {
    return [...this.pieces.values()].map(p => ({ ...p }));
  }

  load(list: Piece[]) {
    this.pieces.clear();
    this.grid.clear();
    for (const p of list) {
      if (!PIECES[p.shape]) continue;
      const piece = { ...p };
      this.pieces.set(p.id, piece);
      this.index(piece, true);
      this.nextId = Math.max(this.nextId, p.id + 1);
    }
    this.version++;
  }
}
