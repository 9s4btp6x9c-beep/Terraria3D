// Priority job queue over a pool of terrain workers. Jobs are re-prioritised
// at dispatch time (nearest to the player first) and dropped if no longer
// wanted. Falls back to running jobs on the main thread under a time budget
// when workers are unavailable.

import type { WorldConfig } from './config';
import type { WorldGenerator } from './generator';
import { type ChunkJob, type LodJob, type TerrainJob, type TerrainResult, runChunkJob, runLodJob } from './terrainJobs';

type JobInput = Omit<ChunkJob, 'id'> | Omit<LodJob, 'id'>;

export interface QueuedJob {
  job: TerrainJob;
  /** Lower runs first; evaluated at dispatch time. */
  priority(): number;
  /** Return false to drop the job before it runs. */
  wanted(): boolean;
  done(result: TerrainResult): void;
  /** Called if the job is discarded because it is no longer wanted. */
  dropped?(): void;
}

export class TerrainWorkerPool {
  private queue: QueuedJob[] = [];
  private workers: { w: Worker; busy: QueuedJob | null }[] = [];
  private nextId = 1;
  private useWorkers: boolean;

  constructor(private cfg: WorldConfig, private gen: WorldGenerator, workerCount?: number) {
    const n = workerCount ?? Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency || 4) - 1));
    this.useWorkers = typeof Worker !== 'undefined' && n > 0;
    if (!this.useWorkers) return;
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
        const slot = { w, busy: null as QueuedJob | null };
        w.onmessage = (e: MessageEvent<TerrainResult>) => {
          const j = slot.busy;
          slot.busy = null;
          j?.done(e.data);
          this.pump();
        };
        w.onerror = () => this.disableWorkers();
        this.workers.push(slot);
      }
    } catch {
      this.disableWorkers();
    }
  }

  /** Workers failed (e.g. blocked by the host page): finish everything inline. */
  private disableWorkers() {
    if (!this.useWorkers) return;
    this.useWorkers = false;
    for (const s of this.workers) {
      if (s.busy) this.queue.push(s.busy);
      s.w.terminate();
    }
    this.workers = [];
  }

  get pending() { return this.queue.length + this.workers.filter(w => w.busy).length; }

  submit(q: Omit<QueuedJob, 'job'> & { job: JobInput }) {
    this.queue.push({ ...q, job: { ...q.job, id: this.nextId++ } as TerrainJob });
  }

  private take(): QueuedJob | null {
    let best = -1, bestP = Infinity;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (!q.wanted()) { this.queue.splice(i, 1); if (best > i) best--; q.dropped?.(); continue; }
      const p = q.priority();
      if (p < bestP) { bestP = p; best = i; }
    }
    if (best < 0) return null;
    return this.queue.splice(best, 1)[0];
  }

  /** Dispatch queued jobs to idle workers, or run some inline (budget in ms). */
  pump(budgetMs = 6) {
    if (this.useWorkers) {
      for (const slot of this.workers) {
        if (slot.busy) continue;
        const q = this.take();
        if (!q) return;
        slot.busy = q;
        slot.w.postMessage({ cfg: this.cfg, job: q.job });
      }
      return;
    }
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      const q = this.take();
      if (!q) return;
      q.done(q.job.kind === 'chunk' ? runChunkJob(this.gen, q.job) : runLodJob(this.gen, q.job));
    }
  }

  dispose() {
    for (const s of this.workers) s.w.terminate();
    this.workers = [];
    this.queue = [];
  }
}
