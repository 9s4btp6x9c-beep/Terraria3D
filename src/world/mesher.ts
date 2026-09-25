// Surface Nets mesher: extracts a smooth polygonal surface from a sampled
// density grid. One vertex per surface-crossing cell (placed at the average of
// its edge crossings), one quad per sign-changing edge. Output is organic,
// faceted low-poly geometry — the sampling grid is never visible.
//
// The same mesher builds full-resolution chunks (stride 1) and coarse far LOD
// regions (stride 2..16). Output is non-indexed so each triangle carries the
// materials of its three corners (dithered material blending in the shader;
// the shader derives barycentrics from gl_VertexID). Attributes are compact:
// float positions, int8 normals, uint8 materials.

import { CHUNK } from './config';
import type { SampleGrid } from './edits';
import type { TerrainField } from './terrain';

export interface ChunkMesh {
  positions: Float32Array;
  /** int8 normalized (x127). */
  normals: Int8Array;
  /** Per-vertex: materials of the triangle's 3 corners (same for all 3 verts). */
  mats: Uint8Array;
  triangleCount: number;
}

/** Inclusive ranges of edge base indices (grid coords) this mesh owns. */
export interface EmitRange { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// Scratch buffers reused across calls (each thread has its own module copy).
let cellVert = new Int32Array(0);
let vpos = new Float32Array(3 * 4096);
let vnrm = new Float32Array(3 * 4096);
let vmat = new Uint8Array(4096);
let quads = new Int32Array(4 * 8192);

/**
 * Mesh a sample grid. `cull(x,y,z)` may reject cells by world position (used
 * to drop buried cave surfaces in distant LODs).
 */
export function meshGrid(g: SampleGrid, emit: EmitRange, cull?: (x: number, y: number, z: number) => boolean): ChunkMesh | null {
  const { dens, mat, nx, ny, nz, ox, oy, oz, stride: s } = g;
  let anySolid = false, anyAir = false;
  for (let i = 0; i < dens.length; i++) {
    if (dens[i] > 0) anySolid = true; else anyAir = true;
    if (anySolid && anyAir) break;
  }
  if (!anySolid || !anyAir) return null;

  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  if (cellVert.length < cx * cy * cz) cellVert = new Int32Array(cx * cy * cz);
  const cd = [0, 0, 0, 0, 0, 0, 0, 0];
  let vcount = 0;
  for (let z = 0; z < cz; z++)
    for (let y = 0; y < cy; y++)
      for (let x = 0; x < cx; x++) {
        const ci = x + cx * (y + cy * z);
        cellVert[ci] = -1;
        let mask = 0;
        for (let k = 0; k < 8; k++) {
          const c = CORNERS[k];
          const v = dens[(x + c[0]) + nx * ((y + c[1]) + ny * (z + c[2]))];
          cd[k] = v;
          if (v > 0) mask |= 1 << k;
        }
        if (mask === 0 || mask === 255) continue;
        if (cull && cull(ox + (x + 0.5) * s, oy + (y + 0.5) * s, oz + (z + 0.5) * s)) continue;

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
        const gx = lerp2(cd[1] - cd[0], cd[3] - cd[2], cd[5] - cd[4], cd[7] - cd[6], fy, fz);
        const gy = lerp2(cd[2] - cd[0], cd[3] - cd[1], cd[6] - cd[4], cd[7] - cd[5], fx, fz);
        const gz = lerp2(cd[4] - cd[0], cd[5] - cd[1], cd[6] - cd[2], cd[7] - cd[3], fx, fy);
        const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;

        // Material: the solid corner closest to the surface.
        let best = 0, bestD = Infinity;
        for (let k = 0; k < 8; k++) {
          if (cd[k] > 0 && cd[k] < bestD) {
            bestD = cd[k];
            const c = CORNERS[k];
            best = mat[(x + c[0]) + nx * ((y + c[1]) + ny * (z + c[2]))];
          }
        }

        if (vcount * 3 + 3 > vpos.length) growVerts();
        vpos[vcount * 3] = ox + (x + fx) * s;
        vpos[vcount * 3 + 1] = oy + (y + fy) * s;
        vpos[vcount * 3 + 2] = oz + (z + fz) * s;
        vnrm[vcount * 3] = -gx / len;
        vnrm[vcount * 3 + 1] = -gy / len;
        vnrm[vcount * 3 + 2] = -gz / len;
        vmat[vcount] = best;
        cellVert[ci] = vcount++;
      }

  const cell = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= cx || y >= cy || z >= cz ? -1 : cellVert[x + cx * (y + cy * z)];

  // Quads: one per sign-changing edge owned by this mesh.
  let qn = 0;
  const e = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0];
  for (let z = Math.max(1, emit.z0); z <= Math.min(nz - 2, emit.z1); z++)
    for (let y = Math.max(1, emit.y0); y <= Math.min(ny - 2, emit.y1); y++)
      for (let x = Math.max(1, emit.x0); x <= Math.min(nx - 2, emit.x1); x++) {
        const d0 = dens[x + nx * (y + ny * z)];
        for (let axis = 0; axis < 3; axis++) {
          e[0] = x; e[1] = y; e[2] = z;
          e[axis] += 1;
          const d1 = dens[e[0] + nx * (e[1] + ny * e[2])];
          if ((d0 > 0) === (d1 > 0)) continue;
          const u = (axis + 1) % 3, v = (axis + 2) % 3;
          du[0] = du[1] = du[2] = 0; dv[0] = dv[1] = dv[2] = 0;
          du[u] = 1; dv[v] = 1;
          const c00 = cell(x - du[0] - dv[0], y - du[1] - dv[1], z - du[2] - dv[2]);
          const c10 = cell(x - dv[0], y - dv[1], z - dv[2]);
          const c11 = cell(x, y, z);
          const c01 = cell(x - du[0], y - du[1], z - du[2]);
          if (c00 < 0 || c10 < 0 || c11 < 0 || c01 < 0) continue;
          if (qn + 4 > quads.length) { const nq = new Int32Array(quads.length * 2); nq.set(quads); quads = nq; }
          if (d0 > 0) { quads[qn++] = c00; quads[qn++] = c10; quads[qn++] = c11; quads[qn++] = c01; }
          else { quads[qn++] = c00; quads[qn++] = c01; quads[qn++] = c11; quads[qn++] = c10; }
        }
      }

  const quadCount = qn / 4;
  if (quadCount === 0) return null;
  const triCount = quadCount * 2;
  const positions = new Float32Array(triCount * 9);
  const normals = new Int8Array(triCount * 9);
  const mats = new Uint8Array(triCount * 9);
  let t = 0;
  const emitTri = (a: number, b: number, c: number) => {
    const o = t * 9;
    const ma = vmat[a], mb = vmat[b], mc = vmat[c];
    let k = 0;
    for (const vi of [a, b, c]) {
      const p = o + k * 3;
      positions[p] = vpos[vi * 3];
      positions[p + 1] = vpos[vi * 3 + 1];
      positions[p + 2] = vpos[vi * 3 + 2];
      normals[p] = Math.round(vnrm[vi * 3] * 127);
      normals[p + 1] = Math.round(vnrm[vi * 3 + 1] * 127);
      normals[p + 2] = Math.round(vnrm[vi * 3 + 2] * 127);
      mats[p] = ma; mats[p + 1] = mb; mats[p + 2] = mc;
      k++;
    }
    t++;
  };
  for (let q = 0; q < qn; q += 4) {
    const a = quads[q], b = quads[q + 1], c = quads[q + 2], d = quads[q + 3];
    // Split along the shorter diagonal for nicer facets.
    if (dist2(a, c) < dist2(b, d)) { emitTri(a, b, c); emitTri(a, c, d); }
    else { emitTri(a, b, d); emitTri(b, c, d); }
  }
  return { positions, normals, mats, triangleCount: triCount };
}

/** Padded 34³ grid around a chunk, read from the live field. */
export function chunkGridFromField(field: TerrainField, cx: number, cy: number, cz: number): SampleGrid {
  const P = CHUNK + 2;
  const g: SampleGrid = {
    dens: new Float32Array(P * P * P), mat: new Uint8Array(P * P * P),
    nx: P, ny: P, nz: P, ox: cx * CHUNK - 1, oy: cy * CHUNK - 1, oz: cz * CHUNK - 1, stride: 1,
  };
  let i = 0;
  for (let z = 0; z < P; z++)
    for (let y = 0; y < P; y++)
      for (let x = 0; x < P; x++, i++) {
        g.dens[i] = field.density(g.ox + x, g.oy + y, g.oz + z);
        g.mat[i] = field.material(g.ox + x, g.oy + y, g.oz + z);
      }
  return g;
}

/** Edge ownership for a padded chunk grid: base samples local 0..31. */
export const CHUNK_EMIT: EmitRange = { x0: 1, x1: CHUNK, y0: 1, y1: CHUNK, z0: 1, z1: CHUNK };

export function meshChunk(field: TerrainField, cx: number, cy: number, cz: number): ChunkMesh | null {
  return meshGrid(chunkGridFromField(field, cx, cy, cz), CHUNK_EMIT);
}

function dist2(a: number, b: number) {
  const dx = vpos[a * 3] - vpos[b * 3], dy = vpos[a * 3 + 1] - vpos[b * 3 + 1], dz = vpos[a * 3 + 2] - vpos[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

function lerp2(a: number, b: number, c: number, d: number, s: number, t: number) {
  const ab = a + (b - a) * s, cd = c + (d - c) * s;
  return ab + (cd - ab) * t;
}

function growVerts() {
  const np = new Float32Array(vpos.length * 2); np.set(vpos); vpos = np;
  const nn = new Float32Array(vnrm.length * 2); nn.set(vnrm); vnrm = nn;
  const nm = new Uint8Array(vmat.length * 2); nm.set(vmat); vmat = nm;
}
