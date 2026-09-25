// Surface Nets mesher: extracts a smooth polygonal surface from the density
// field for one chunk. One vertex per surface-crossing cell (placed at the
// average of its edge crossings), one quad per sign-changing edge. The output
// is organic, faceted low-poly geometry — the sampling grid is never visible.
//
// Output is non-indexed so each triangle can carry the materials of its three
// corners (for dithered material blending in the shader).

import { CHUNK } from './config';
import type { TerrainField } from './terrain';

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Per-vertex: materials of the triangle's 3 corners (same for all 3 verts). */
  mats: Float32Array;
  /** Per-vertex barycentric weights (1,0,0) / (0,1,0) / (0,0,1). */
  bary: Float32Array;
  triangleCount: number;
}

const P = CHUNK + 2; // padded samples per axis: -1 .. CHUNK
const C = CHUNK + 1; // cells per axis: -1 .. CHUNK-1

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// Scratch buffers reused across calls (meshing is single-threaded).
const dens = new Float32Array(P * P * P);
const mat = new Uint8Array(P * P * P);
const cellVert = new Int32Array(C * C * C);
let vpos = new Float32Array(3 * 4096);
let vnrm = new Float32Array(3 * 4096);
let vmat = new Uint8Array(4096);

export function meshChunk(field: TerrainField, cx: number, cy: number, cz: number): ChunkMesh | null {
  const ox = cx * CHUNK - 1, oy = cy * CHUNK - 1, oz = cz * CHUNK - 1;
  let anySolid = false, anyAir = false;
  for (let z = 0; z < P; z++)
    for (let y = 0; y < P; y++)
      for (let x = 0; x < P; x++) {
        const i = x + P * (y + P * z);
        const d = field.density(ox + x, oy + y, oz + z);
        dens[i] = d;
        mat[i] = field.material(ox + x, oy + y, oz + z);
        if (d > 0) anySolid = true; else anyAir = true;
      }
  if (!anySolid || !anyAir) return null;

  // ---- vertices: one per cell that the surface passes through
  let vcount = 0;
  const g = [0, 0, 0];
  for (let z = 0; z < C; z++)
    for (let y = 0; y < C; y++)
      for (let x = 0; x < C; x++) {
        const ci = x + C * (y + C * z);
        cellVert[ci] = -1;
        let mask = 0;
        const cd = [0, 0, 0, 0, 0, 0, 0, 0];
        for (let k = 0; k < 8; k++) {
          const c = CORNERS[k];
          const v = dens[(x + c[0]) + P * ((y + c[1]) + P * (z + c[2]))];
          cd[k] = v;
          if (v > 0) mask |= 1 << k;
        }
        if (mask === 0 || mask === 255) continue;

        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const da = cd[a], db = cd[b];
          if ((da > 0) === (db > 0)) continue;
          const t = da / (da - db);
          const ca = CORNERS[a], cb = CORNERS[b];
          sx += ca[0] + (cb[0] - ca[0]) * t;
          sy += ca[1] + (cb[1] - ca[1]) * t;
          sz += ca[2] + (cb[2] - ca[2]) * t;
          n++;
        }
        const fx = sx / n, fy = sy / n, fz = sz / n;
        // Trilinear gradient at the vertex -> smooth normal.
        g[0] = lerp2(cd[1] - cd[0], cd[3] - cd[2], cd[5] - cd[4], cd[7] - cd[6], fy, fz);
        g[1] = lerp2(cd[2] - cd[0], cd[3] - cd[1], cd[6] - cd[4], cd[7] - cd[5], fx, fz);
        g[2] = lerp2(cd[4] - cd[0], cd[5] - cd[1], cd[6] - cd[2], cd[7] - cd[3], fx, fy);
        const len = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;

        // Material: the solid corner closest to the surface.
        let best = 0, bestD = Infinity;
        for (let k = 0; k < 8; k++) {
          if (cd[k] > 0 && cd[k] < bestD) {
            bestD = cd[k];
            const c = CORNERS[k];
            best = mat[(x + c[0]) + P * ((y + c[1]) + P * (z + c[2]))];
          }
        }

        if (vcount * 3 + 3 > vpos.length) grow();
        vpos[vcount * 3] = ox + x + fx;
        vpos[vcount * 3 + 1] = oy + y + fy;
        vpos[vcount * 3 + 2] = oz + z + fz;
        vnrm[vcount * 3] = -g[0] / len;
        vnrm[vcount * 3 + 1] = -g[1] / len;
        vnrm[vcount * 3 + 2] = -g[2] / len;
        vmat[vcount] = best;
        cellVert[ci] = vcount++;
      }

  // ---- quads: one per sign-changing edge owned by this chunk
  const quads: number[] = [];
  const e = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0];
  for (let z = 1; z <= CHUNK; z++)
    for (let y = 1; y <= CHUNK; y++)
      for (let x = 1; x <= CHUNK; x++) {
        const d0 = dens[x + P * (y + P * z)];
        for (let axis = 0; axis < 3; axis++) {
          e[0] = x; e[1] = y; e[2] = z;
          e[axis] += 1;
          const d1 = dens[e[0] + P * (e[1] + P * e[2])];
          if ((d0 > 0) === (d1 > 0)) continue;
          const u = (axis + 1) % 3, v = (axis + 2) % 3;
          du[0] = du[1] = du[2] = 0; dv[0] = dv[1] = dv[2] = 0;
          du[u] = 1; dv[v] = 1;
          // Cells around the edge, in padded-cell coordinates (cell index = sample index).
          const c00 = cell(x - du[0] - dv[0], y - du[1] - dv[1], z - du[2] - dv[2]);
          const c10 = cell(x - dv[0], y - dv[1], z - dv[2]);
          const c11 = cell(x, y, z);
          const c01 = cell(x - du[0], y - du[1], z - du[2]);
          if (c00 < 0 || c10 < 0 || c11 < 0 || c01 < 0) continue;
          if (d0 > 0) quads.push(c00, c10, c11, c01);
          else quads.push(c00, c01, c11, c10);
        }
      }

  const quadCount = quads.length / 4;
  if (quadCount === 0) return null;
  const triCount = quadCount * 2;
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  const mats = new Float32Array(triCount * 9);
  const bary = new Float32Array(triCount * 9);
  let t = 0;
  const emit = (a: number, b: number, c: number) => {
    const o = t * 9;
    const ids = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const vi = ids[k];
      positions[o + k * 3] = vpos[vi * 3];
      positions[o + k * 3 + 1] = vpos[vi * 3 + 1];
      positions[o + k * 3 + 2] = vpos[vi * 3 + 2];
      normals[o + k * 3] = vnrm[vi * 3];
      normals[o + k * 3 + 1] = vnrm[vi * 3 + 1];
      normals[o + k * 3 + 2] = vnrm[vi * 3 + 2];
      mats[o + k * 3] = vmat[a];
      mats[o + k * 3 + 1] = vmat[b];
      mats[o + k * 3 + 2] = vmat[c];
      bary[o + k * 3 + k] = 1;
    }
    t++;
  };
  for (let q = 0; q < quads.length; q += 4) {
    const a = quads[q], b = quads[q + 1], c = quads[q + 2], d = quads[q + 3];
    // Split along the shorter diagonal for nicer facets.
    if (dist2(a, c) < dist2(b, d)) { emit(a, b, c); emit(a, c, d); }
    else { emit(a, b, d); emit(b, c, d); }
  }
  return { positions, normals, mats, bary, triangleCount: triCount };
}

function cell(x: number, y: number, z: number): number {
  // Padded sample coords x map to cell index x (cells start at padded 0 == world -1).
  if (x < 0 || y < 0 || z < 0 || x >= C || y >= C || z >= C) return -1;
  return cellVert[x + C * (y + C * z)];
}

function dist2(a: number, b: number) {
  const dx = vpos[a * 3] - vpos[b * 3], dy = vpos[a * 3 + 1] - vpos[b * 3 + 1], dz = vpos[a * 3 + 2] - vpos[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

function lerp2(a: number, b: number, c: number, d: number, s: number, t: number) {
  const ab = a + (b - a) * s, cd = c + (d - c) * s;
  return ab + (cd - ab) * t;
}

function grow() {
  const np = new Float32Array(vpos.length * 2); np.set(vpos); vpos = np;
  const nn = new Float32Array(vnrm.length * 2); nn.set(vnrm); vnrm = nn;
  const nm = new Uint8Array(vmat.length * 2); nm.set(vmat); vmat = nm;
}
