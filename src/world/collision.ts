// Unified distance queries for physics: terrain field + building pieces +
// tree trunks. Everything is expressed as "signed distance to nearest solid",
// so the player collides with organic terrain and modular pieces identically.

import { type Piece, Structures } from '../building/structures';
import type { TerrainField } from './terrain';
import type { Tree, Vegetation } from './vegetation';

export class WorldCollision {
  private pieces: Piece[] = [];
  private trees: Tree[] = [];
  private g: [number, number, number] = [0, 0, 0];

  constructor(private field: TerrainField, private structures: Structures, private veg: Vegetation | null) {}

  /** Cache nearby dynamic colliders once per frame around the player. */
  prepare(x: number, y: number, z: number, r = 6) {
    this.pieces = this.structures.near(x, y, z, r);
    this.trees = this.veg ? this.veg.treesNear(x, z, r) : [];
  }

  /** Distance from point to nearest solid; writes the outward normal. */
  distance(x: number, y: number, z: number, n: [number, number, number]): number {
    let d = this.field.distance(x, y, z, this.g);
    n[0] = -this.g[0]; n[1] = -this.g[1]; n[2] = -this.g[2];

    if (this.pieces.length) {
      const pd = Structures.distance(this.pieces, x, y, z);
      if (pd < d) {
        const e = 0.02;
        const nx = Structures.distance(this.pieces, x + e, y, z) - Structures.distance(this.pieces, x - e, y, z);
        const ny = Structures.distance(this.pieces, x, y + e, z) - Structures.distance(this.pieces, x, y - e, z);
        const nz = Structures.distance(this.pieces, x, y, z + e) - Structures.distance(this.pieces, x, y, z - e);
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        d = pd; n[0] = nx / l; n[1] = ny / l; n[2] = nz / l;
      }
    }
    for (const t of this.trees) {
      if (y < t.y - 1 || y > t.y + t.height * 0.75) continue;
      const dx = x - t.x, dz = z - t.z;
      const l = Math.sqrt(dx * dx + dz * dz);
      const td = l - t.radius;
      if (td < d && l > 1e-4) { d = td; n[0] = dx / l; n[1] = 0; n[2] = dz / l; }
    }
    return d;
  }
}
