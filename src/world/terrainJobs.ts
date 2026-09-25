// Pure terrain jobs, run inside workers (or on the main thread as fallback):
//  - chunk: generate a full-resolution chunk + padding, replay the player's
//    edits, return the chunk's data and its mesh
//  - lod:   sample a large region coarsely (stride 2..16), replay edits,
//    return a single far-distance mesh with buried caves culled

import { CHUNK } from './config';
import { type SampleGrid, type TerrainEdit, applyEditsToGrid } from './edits';
import type { WorldGenerator } from './generator';
import { CHUNK_EMIT, type ChunkMesh, meshGrid } from './mesher';
import type { Chunk, TerrainField } from './terrain';

export interface ChunkJob { kind: 'chunk'; id: number; cx: number; cy: number; cz: number; edits: TerrainEdit[]; withMesh: boolean }
export interface LodJob { kind: 'lod'; id: number; x0: number; z0: number; size: number; edits: TerrainEdit[] }
export type TerrainJob = ChunkJob | LodJob;

export interface ChunkResult {
  kind: 'chunk'; id: number;
  density: Float32Array | null; mat: Uint8Array | null;
  uniformDensity: number; uniformMat: number;
  mesh: ChunkMesh | null;
}
export interface LodResult { kind: 'lod'; id: number; mesh: ChunkMesh | null }
export type TerrainResult = ChunkResult | LodResult;

/** Cells of the far LOD this far below the landform are never visible. */
const LOD_CULL_DEPTH = 16;
/** Coarse cells a LOD mesh overlaps its neighbours by (hides LOD seams). */
export const LOD_CELLS = 32;

export function runChunkJob(gen: WorldGenerator, job: ChunkJob): ChunkResult {
  const P = CHUNK + 2;
  const g: SampleGrid = {
    dens: new Float32Array(P * P * P), mat: new Uint8Array(P * P * P),
    nx: P, ny: P, nz: P, ox: job.cx * CHUNK - 1, oy: job.cy * CHUNK - 1, oz: job.cz * CHUNK - 1, stride: 1,
  };
  const any = gen.sampleRegion(g);
  if (job.edits.length) applyEditsToGrid(g, job.edits, gen.size);
  // Extract the chunk's own 32³ samples.
  const density = new Float32Array(CHUNK ** 3), mat = new Uint8Array(CHUNK ** 3);
  let uniform = true;
  for (let z = 0; z < CHUNK; z++)
    for (let y = 0; y < CHUNK; y++) {
      const src = 1 + P * ((y + 1) + P * (z + 1));
      const dst = CHUNK * (y + CHUNK * z);
      for (let x = 0; x < CHUNK; x++) {
        density[dst + x] = g.dens[src + x];
        mat[dst + x] = g.mat[src + x];
      }
    }
  const d0 = density[0], m0 = mat[0];
  for (let i = 1; i < density.length && uniform; i++) if (density[i] !== d0 || mat[i] !== m0) uniform = false;
  const mesh = job.withMesh && (any || job.edits.length) ? meshGrid(g, CHUNK_EMIT) : null;
  return uniform
    ? { kind: 'chunk', id: job.id, density: null, mat: null, uniformDensity: d0, uniformMat: m0, mesh }
    : { kind: 'chunk', id: job.id, density, mat, uniformDensity: 0, uniformMat: 0, mesh };
}

export function runLodJob(gen: WorldGenerator, job: LodJob): LodResult {
  const s = job.size / LOD_CELLS;
  const nx = LOD_CELLS + 4, nz = LOD_CELLS + 4;
  const ny = Math.ceil(gen.size.y / s) + 3;
  const g: SampleGrid = {
    dens: new Float32Array(nx * ny * nz), mat: new Uint8Array(nx * ny * nz),
    nx, ny, nz, ox: job.x0 - 2 * s, oy: -s, oz: job.z0 - 2 * s, stride: s,
  };
  gen.sampleRegion(g);
  if (job.edits.length) applyEditsToGrid(g, job.edits, gen.size);
  // Emit one extra coarse cell on every horizontal side so neighbouring LODs overlap.
  const mesh = meshGrid(g, { x0: 1, x1: LOD_CELLS + 2, y0: 1, y1: ny - 2, z0: 1, z1: LOD_CELLS + 2 },
    (x, y, z) => y < gen.height(x, z) - LOD_CULL_DEPTH);
  return { kind: 'lod', id: job.id, mesh };
}

/** Apply a chunk result to the field. */
export function storeChunk(chunk: Chunk, r: ChunkResult) {
  chunk.density = r.density;
  chunk.mat = r.mat;
  chunk.uniformDensity = r.uniformDensity;
  chunk.uniformMat = r.uniformMat;
  chunk.resident = true;
}

/** Synchronously generate every chunk (tests / tools). */
export function generateAll(field: TerrainField, gen: WorldGenerator, edits: TerrainEdit[] = []) {
  field.chunks.forEach((c, id) => {
    storeChunk(c, runChunkJob(gen, { kind: 'chunk', id, cx: c.cx, cy: c.cy, cz: c.cz, edits, withMesh: false }));
  });
}

/** Synchronously generate one chunk (tests / tools). */
export function fillChunk(gen: WorldGenerator, c: Chunk, edits: TerrainEdit[] = []) {
  storeChunk(c, runChunkJob(gen, { kind: 'chunk', id: 0, cx: c.cx, cy: c.cy, cz: c.cz, edits, withMesh: false }));
}
