// Web Worker: generates chunk density/material data in parallel.
// Generation is a pure function of (seed, chunk coords), so any worker can
// produce any chunk and results are identical to main-thread generation.

import type { WorldConfig } from './config';
import { WorldGenerator } from './generator';
import { Chunk } from './terrain';

export interface GenRequest { cfg: WorldConfig; chunks: [number, number, number, number][] }
export interface GenResult {
  index: number;
  density: Float32Array | null;
  mat: Uint8Array | null;
  uniformDensity: number;
  uniformMat: number;
}

let gen: WorldGenerator | null = null;

self.onmessage = (e: MessageEvent<GenRequest>) => {
  const { cfg, chunks } = e.data;
  if (!gen || gen.cfg.seed !== cfg.seed) gen = new WorldGenerator(cfg);
  for (const [index, cx, cy, cz] of chunks) {
    const c = new Chunk(cx, cy, cz);
    gen.fillChunk(c);
    const res: GenResult = { index, density: c.density, mat: c.mat, uniformDensity: c.uniformDensity, uniformMat: c.uniformMat };
    const transfer: Transferable[] = [];
    if (c.density) transfer.push(c.density.buffer);
    if (c.mat) transfer.push(c.mat.buffer);
    (self as unknown as Worker).postMessage(res, transfer);
  }
};
