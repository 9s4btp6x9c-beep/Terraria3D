// Web Worker running terrain jobs (generation + meshing) off the main thread.
// Generation is a pure function of the seed, so every worker produces
// identical results.

import type { WorldConfig } from './config';
import { WorldGenerator } from './generator';
import { type TerrainJob, type TerrainResult, runChunkJob, runLodJob } from './terrainJobs';

let gen: WorldGenerator | null = null;

self.onmessage = (e: MessageEvent<{ cfg: WorldConfig; job: TerrainJob }>) => {
  const { cfg, job } = e.data;
  if (!gen || gen.cfg.seed !== cfg.seed || gen.size.x !== cfg.chunksX * 32) gen = new WorldGenerator(cfg);
  const res: TerrainResult = job.kind === 'chunk' ? runChunkJob(gen, job) : runLodJob(gen, job);
  const transfer: Transferable[] = [];
  if (res.kind === 'chunk') {
    if (res.density) transfer.push(res.density.buffer);
    if (res.mat) transfer.push(res.mat.buffer);
  }
  if (res.mesh) transfer.push(res.mesh.positions.buffer, res.mesh.normals.buffer, res.mesh.mats.buffer);
  (self as unknown as Worker).postMessage(res, transfer);
};
