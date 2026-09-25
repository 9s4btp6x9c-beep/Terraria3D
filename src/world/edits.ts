// Pointwise CSG edit rules shared by the live TerrainField and the terrain
// workers. Each edit only depends on a sample's previous value, so applying
// the same ordered edit list to any sampling of space gives identical results.

import { material } from './materials';

export const DENSITY_CLAMP = 8;

/** [mode(0=sub,1=add), x, y, z, radius, material, maxTier] */
export type TerrainEdit = [number, number, number, number, number, number, number];

/**
 * Apply one edit to a sample. Returns the new density, or NaN when the sample
 * is unchanged. `outMat[0]` receives the new material.
 */
export function editSample(old: number, mat: number, dist: number, e: TerrainEdit, outMat: [number]): number {
  const r = e[4];
  let nd: number;
  outMat[0] = mat;
  if (e[0] === 0) {
    if (old > 0) {
      const tier = material(mat).tier;
      if (tier < 0 || tier > e[6]) return NaN;
    }
    nd = Math.min(old, dist - r);
    if (nd >= old) return NaN;
  } else {
    nd = Math.max(old, r - dist);
    if (nd <= old) return NaN;
    if (old <= 0) outMat[0] = e[5];
  }
  return Math.max(-DENSITY_CLAMP, Math.min(DENSITY_CLAMP, nd));
}

export interface WorldDims { x: number; y: number; z: number }

/**
 * Inclusive integer world-space bounds an edit touches. World boundary samples
 * are never edited, which keeps the world closed.
 */
export function editBounds(e: TerrainEdit, size: WorldDims): [number, number, number, number, number, number] {
  const p = e[4] + 1;
  return [
    Math.max(1, Math.floor(e[1] - p)), Math.max(1, Math.floor(e[2] - p)), Math.max(1, Math.floor(e[3] - p)),
    Math.min(size.x - 2, Math.ceil(e[1] + p)), Math.min(size.y - 2, Math.ceil(e[2] + p)), Math.min(size.z - 2, Math.ceil(e[3] + p)),
  ];
}

export interface SampleGrid {
  dens: Float32Array;
  mat: Uint8Array;
  nx: number; ny: number; nz: number;
  /** World position of sample (0,0,0). */
  ox: number; oy: number; oz: number;
  stride: number;
}

/** Apply edits (in order) to every grid sample they reach. */
export function applyEditsToGrid(g: SampleGrid, edits: TerrainEdit[], size: WorldDims) {
  const out: [number] = [0];
  for (const e of edits) {
    const b = editBounds(e, size);
    const s = g.stride;
    const i0 = Math.max(0, Math.ceil((b[0] - g.ox) / s)), i1 = Math.min(g.nx - 1, Math.floor((b[3] - g.ox) / s));
    const j0 = Math.max(0, Math.ceil((b[1] - g.oy) / s)), j1 = Math.min(g.ny - 1, Math.floor((b[4] - g.oy) / s));
    const k0 = Math.max(0, Math.ceil((b[2] - g.oz) / s)), k1 = Math.min(g.nz - 1, Math.floor((b[5] - g.oz) / s));
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = g.ox + i * s, y = g.oy + j * s, z = g.oz + k * s;
          const dx = x - e[1], dy = y - e[2], dz = z - e[3];
          const idx = i + g.nx * (j + g.ny * k);
          const nd = editSample(g.dens[idx], g.mat[idx], Math.sqrt(dx * dx + dy * dy + dz * dz), e, out);
          if (Number.isNaN(nd)) continue;
          g.dens[idx] = nd;
          g.mat[idx] = out[0];
        }
  }
}
