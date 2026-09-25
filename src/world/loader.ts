// Fills a TerrainField using a pool of generation workers (falls back to the
// main thread when workers are unavailable). Chunks nearest the spawn point
// are generated first.

import type { WorldGenerator } from './generator';
import type { GenRequest, GenResult } from './genWorker';
import type { TerrainField } from './terrain';

export async function generateField(
  field: TerrainField,
  gen: WorldGenerator,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const s = gen.spawn;
  const order = field.chunks
    .map((c, index) => ({ c, index, d: (c.cx * 32 + 16 - s.x) ** 2 + (c.cy * 32 + 16 - s.y) ** 2 + (c.cz * 32 + 16 - s.z) ** 2 }))
    .sort((a, b) => a.d - b.d);

  const workerCount = typeof Worker !== 'undefined' ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 0;
  if (workerCount === 0) {
    for (let i = 0; i < order.length; i++) {
      gen.fillChunk(order[i].c);
      if (i % 8 === 0) { onProgress(i / order.length); await new Promise(r => setTimeout(r, 0)); }
    }
    onProgress(1);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let done = 0;
    const workers: Worker[] = [];
    const batches: GenRequest['chunks'][] = Array.from({ length: workerCount }, () => []);
    order.forEach((o, i) => batches[i % workerCount].push([o.index, o.c.cx, o.c.cy, o.c.cz]));
    for (let w = 0; w < workerCount; w++) {
      const worker = new Worker(new URL('./genWorker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);
      worker.onerror = e => { workers.forEach(x => x.terminate()); reject(e); };
      worker.onmessage = (e: MessageEvent<GenResult>) => {
        const r = e.data;
        const c = field.chunks[r.index];
        c.density = r.density;
        c.mat = r.mat;
        c.uniformDensity = r.uniformDensity;
        c.uniformMat = r.uniformMat;
        done++;
        onProgress(done / order.length);
        if (done === order.length) {
          workers.forEach(x => x.terminate());
          resolve();
        }
      };
      worker.postMessage({ cfg: field.cfg, chunks: batches[w] } satisfies GenRequest);
    }
  });
}
