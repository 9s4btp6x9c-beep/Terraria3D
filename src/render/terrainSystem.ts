// TerrainSystem: streaming + level of detail for the terrain.
//
// The world's XZ footprint is covered by a quadtree. Around the player the
// leaves are 32 m chunk columns meshed at full resolution from resident,
// editable data. Further out, leaves are 64/128/256 m regions meshed coarsely
// (2/4/8 m sampling) straight from the generator + edit log, with buried
// caves culled — one draw call per region. Coarse regions overlap their
// neighbours by one coarse cell so LOD seams never show cracks.
//
// Chunk data is kept resident only in a ring around the full-detail area and
// streamed in/out by a worker pool. While a new mesh is being built the old
// one (finer or coarser) stays visible, so nothing pops out.

import * as THREE from 'three';
import { CHUNK } from '../world/config';
import { type ChunkMesh, meshChunk } from '../world/mesher';
import type { EditLog } from '../world/persistence';
import type { TerrainField } from '../world/terrain';
import { type ChunkResult, type LodResult, storeChunk } from '../world/terrainJobs';
import type { TerrainWorkerPool } from '../world/workerPool';

/** A node of size S splits when the player is nearer than SPLIT[S] (m, to the node's rect). */
const BASE_SPLIT: Record<number, number> = { 64: 44, 128: 110, 256: 250, 512: 1e9, 1024: 1e9 };

interface LodNode {
  key: string;
  x0: number; z0: number; size: number;
  mesh: THREE.Mesh | null;
  state: 0 | 1 | 2; // none, pending, ready
  editsAt: number;
}

const enum S { None = 0, Pending = 1, Ready = 2 }

export function geometryFromMesh(m: ChunkMesh): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3, true));
  geo.setAttribute('mats', new THREE.BufferAttribute(m.mats, 3));
  geo.computeBoundingSphere();
  return geo;
}

export class TerrainSystem {
  readonly group = new THREE.Group();
  private chunkMesh: (THREE.Mesh | null)[];
  private dataState: Uint8Array;
  private meshState: Uint8Array;
  private nodes = new Map<string, LodNode>();
  private selected = new Set<string>();
  private lod0 = new Set<number>(); // column keys cx + cz * chunksX
  private required = new Set<number>();
  private focus = new THREE.Vector3(1e9, 0, 1e9);
  private visDirty = true;
  private rootSize: number;
  private readonly cols: number;
  private SPLIT: Record<number, number>;
  /** Called when all chunks of a column became resident (x0, z0 in metres). */
  onColumnResident: (x0: number, z0: number) => void = () => {};

  constructor(
    private field: TerrainField,
    private log: EditLog,
    private pool: TerrainWorkerPool,
    private material: THREE.Material,
    /** Scales the detail distances (lower = less geometry, for weak devices). */
    detail = 1,
  ) {
    this.group.name = 'terrain';
    this.SPLIT = Object.fromEntries(Object.entries(BASE_SPLIT).map(([k, v]) => [k, v * detail]));
    const n = field.chunks.length;
    this.chunkMesh = new Array(n).fill(null);
    this.dataState = new Uint8Array(n);
    this.meshState = new Uint8Array(n);
    this.cols = field.cfg.chunksX;
    this.rootSize = 32;
    while (this.rootSize < Math.max(field.sx, field.sz)) this.rootSize *= 2;
  }

  // ---------------------------------------------------------------- selection

  private nearest(x0: number, z0: number, size: number) {
    const dx = Math.max(x0 - this.focus.x, 0, this.focus.x - (x0 + size));
    const dz = Math.max(z0 - this.focus.z, 0, this.focus.z - (z0 + size));
    return Math.sqrt(dx * dx + dz * dz);
  }

  private inWorld(x0: number, z0: number) {
    return x0 < this.field.sx && z0 < this.field.sz;
  }

  private splits(x0: number, z0: number, size: number) {
    return size > CHUNK && this.nearest(x0, z0, size) < (this.SPLIT[size] ?? 0);
  }

  private select(x0: number, z0: number, size: number) {
    if (!this.inWorld(x0, z0)) return;
    if (this.splits(x0, z0, size)) {
      const h = size / 2;
      this.select(x0, z0, h); this.select(x0 + h, z0, h);
      this.select(x0, z0 + h, h); this.select(x0 + h, z0 + h, h);
      return;
    }
    if (size === CHUNK) this.lod0.add((x0 >> 5) + (z0 >> 5) * this.cols);
    else this.selected.add(`${x0},${z0},${size}`);
  }

  private reselect() {
    this.selected.clear();
    this.lod0.clear();
    this.select(0, 0, this.rootSize);
    // Resident ring: full-detail columns dilated by one column (mesh padding).
    this.required.clear();
    const cx = this.field.cfg.chunksX, cz = this.field.cfg.chunksZ;
    for (const k of this.lod0) {
      const x = k % cx, z = Math.floor(k / cx);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, nz = z + dz;
          if (nx >= 0 && nz >= 0 && nx < cx && nz < cz) this.required.add(nx + nz * cx);
        }
    }
    this.requestWork();
    this.unloadFar();
    this.visDirty = true;
  }

  // ------------------------------------------------------------------ requests

  private chunkIndicesOfColumn(col: number): number[] {
    const cfg = this.field.cfg;
    const x = col % cfg.chunksX, z = Math.floor(col / cfg.chunksX);
    const out: number[] = [];
    for (let y = 0; y < cfg.chunksY; y++) out.push(this.field.chunkIndex(x, y, z));
    return out;
  }

  private requestChunk(index: number, withMesh: boolean) {
    const c = this.field.chunks[index];
    const col = c.cx + c.cz * this.cols;
    if (withMesh) this.meshState[index] = S.Pending;
    if (this.dataState[index] !== S.Ready) this.dataState[index] = S.Pending;
    const editsAt = this.log.edits.length;
    this.pool.submit({
      job: { kind: 'chunk', cx: c.cx, cy: c.cy, cz: c.cz, edits: this.log.forChunk(c.cx, c.cy, c.cz), withMesh },
      priority: () => this.nearest(c.cx * CHUNK, c.cz * CHUNK, CHUNK) + (withMesh ? 0 : 40) + c.cy * 0.1,
      wanted: () => this.required.has(col) && (!withMesh || this.lod0.has(col)),
      done: r => this.onChunk(index, r as ChunkResult, editsAt, withMesh),
      dropped: () => {
        if (this.dataState[index] === S.Pending) this.dataState[index] = S.None;
        if (this.meshState[index] === S.Pending) this.meshState[index] = S.None;
      },
    });
  }

  private requestWork() {
    for (const col of this.required) {
      const withMesh = this.lod0.has(col);
      for (const i of this.chunkIndicesOfColumn(col)) {
        const needData = this.dataState[i] === S.None;
        const needMesh = withMesh && this.meshState[i] === S.None;
        if (needData || needMesh) this.requestChunk(i, needMesh);
      }
    }
    for (const key of this.selected) {
      let node = this.nodes.get(key);
      if (!node) {
        const [x0, z0, size] = key.split(',').map(Number);
        node = { key, x0, z0, size, mesh: null, state: S.None, editsAt: 0 };
        this.nodes.set(key, node);
      }
      const stale = node.state === S.Ready &&
        this.log.forRegion(node.x0, 0, node.z0, node.x0 + node.size, this.field.sy, node.z0 + node.size, node.editsAt).length > 0;
      if (node.state === S.None || stale) this.requestNode(node);
    }
  }

  private requestNode(node: LodNode) {
    const editsAt = this.log.edits.length;
    if (node.state !== S.Ready) node.state = S.Pending;
    const pad = (node.size / 32) * 2;
    this.pool.submit({
      job: {
        kind: 'lod', x0: node.x0, z0: node.z0, size: node.size,
        edits: this.log.forRegion(node.x0 - pad, 0, node.z0 - pad, node.x0 + node.size + pad, this.field.sy, node.z0 + node.size + pad),
      },
      priority: () => this.nearest(node.x0, node.z0, node.size) + 20,
      wanted: () => this.selected.has(node.key) || node.mesh !== null,
      done: r => this.onNode(node, r as LodResult, editsAt),
      dropped: () => { if (node.state === S.Pending) node.state = S.None; },
    });
  }

  // ------------------------------------------------------------------- results

  private makeMesh(m: ChunkMesh, shadows: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(geometryFromMesh(m), this.material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    return mesh;
  }

  private setChunkMesh(index: number, data: ChunkMesh | null) {
    const old = this.chunkMesh[index];
    if (old) { this.group.remove(old); old.geometry.dispose(); }
    this.chunkMesh[index] = data ? this.makeMesh(data, true) : null;
    this.meshState[index] = S.Ready;
    this.visDirty = true;
  }

  private onChunk(index: number, r: ChunkResult, editsAt: number, withMesh: boolean) {
    const c = this.field.chunks[index];
    const col = c.cx + c.cz * this.cols;
    if (!this.required.has(col)) {
      if (this.dataState[index] === S.Pending) this.dataState[index] = S.None;
      if (this.meshState[index] === S.Pending) this.meshState[index] = S.None;
      return;
    }
    const wasResident = c.resident;
    storeChunk(c, r);
    this.dataState[index] = S.Ready;
    // Replay edits made while the job was in flight.
    let changed = false;
    if (editsAt < this.log.edits.length) {
      for (const e of this.log.forChunk(c.cx, c.cy, c.cz, editsAt)) {
        if (this.field.applyEdit(e, index).dirtyChunks.size) changed = true;
      }
    }
    if (withMesh) {
      this.setChunkMesh(index, r.mesh);
      if (changed) this.field.dirty.add(index);
    }
    if (!wasResident && this.chunkIndicesOfColumn(col).every(i => this.field.chunks[i].resident)) {
      this.onColumnResident(c.cx * CHUNK, c.cz * CHUNK);
    }
  }

  private onNode(node: LodNode, r: LodResult, editsAt: number) {
    if (node.mesh) { this.group.remove(node.mesh); node.mesh.geometry.dispose(); }
    node.mesh = r.mesh ? this.makeMesh(r.mesh, node.size <= 64) : null;
    node.state = S.Ready;
    node.editsAt = editsAt;
    this.visDirty = true;
  }

  private unloadFar() {
    const cfg = this.field.cfg;
    for (let i = 0; i < this.field.chunks.length; i++) {
      const c = this.field.chunks[i];
      const col = c.cx + c.cz * cfg.chunksX;
      if (!this.lod0.has(col) && this.meshState[i] !== S.None) {
        // Keep meshes a little while (hysteresis) unless clearly far.
        if (this.nearest(c.cx * CHUNK, c.cz * CHUNK, CHUNK) > (this.SPLIT[64] + 48)) {
          const m = this.chunkMesh[i];
          if (m) { this.group.remove(m); m.geometry.dispose(); }
          this.chunkMesh[i] = null;
          this.meshState[i] = S.None;
        }
      }
      if (!this.required.has(col) && this.dataState[i] !== S.None &&
          this.nearest(c.cx * CHUNK, c.cz * CHUNK, CHUNK) > this.SPLIT[64] + 80) {
        c.unload();
        this.field.dirty.delete(i);
        this.dataState[i] = S.None;
      }
    }
    for (const [key, node] of this.nodes) {
      if (this.selected.has(key)) continue;
      if (this.nearest(node.x0, node.z0, node.size) > (this.SPLIT[node.size * 2] ?? 1e9) * 1.6 || this.nearest(node.x0, node.z0, node.size) < (this.SPLIT[node.size] ?? 0) * 0.5) {
        if (node.mesh) { this.group.remove(node.mesh); node.mesh.geometry.dispose(); }
        this.nodes.delete(key);
        this.visDirty = true;
      }
    }
  }

  // ---------------------------------------------------------------- visibility

  private columnReady(col: number) {
    return this.chunkIndicesOfColumn(col).every(i => this.meshState[i] === S.Ready && this.field.chunks[i].resident);
  }

  private nodeReady(x0: number, z0: number, size: number) {
    if (size === CHUNK) return this.columnReady((x0 >> 5) + (z0 >> 5) * this.cols);
    return this.nodes.get(`${x0},${z0},${size}`)?.state === S.Ready;
  }

  private isLeaf(x0: number, z0: number, size: number) {
    return size === CHUNK ? this.lod0.has((x0 >> 5) + (z0 >> 5) * this.cols) : this.selected.has(`${x0},${z0},${size}`);
  }

  /** Can this subtree be drawn from existing meshes at or below it? */
  private readyDeep(x0: number, z0: number, size: number): boolean {
    if (!this.inWorld(x0, z0)) return true;
    if (this.nodeReady(x0, z0, size)) return true;
    if (size === CHUNK) return false;
    const h = size / 2;
    return this.readyDeep(x0, z0, h) && this.readyDeep(x0 + h, z0, h) && this.readyDeep(x0, z0 + h, h) && this.readyDeep(x0 + h, z0 + h, h);
  }

  private canCover(x0: number, z0: number, size: number): boolean {
    if (!this.inWorld(x0, z0)) return true;
    if (this.isLeaf(x0, z0, size)) return this.readyDeep(x0, z0, size);
    if (size === CHUNK) return false;
    const h = size / 2;
    return (this.canCover(x0, z0, h) && this.canCover(x0 + h, z0, h) && this.canCover(x0, z0 + h, h) && this.canCover(x0 + h, z0 + h, h))
      || this.nodeReady(x0, z0, size);
  }

  private show(x0: number, z0: number, size: number) {
    if (size === CHUNK) {
      for (const i of this.chunkIndicesOfColumn((x0 >> 5) + (z0 >> 5) * this.cols)) {
        const m = this.chunkMesh[i];
        if (m) m.visible = true;
      }
    } else {
      const m = this.nodes.get(`${x0},${z0},${size}`)?.mesh;
      if (m) m.visible = true;
    }
  }

  /** Draw the best available meshes for a subtree that is a selected leaf. */
  private drawFine(x0: number, z0: number, size: number) {
    if (!this.inWorld(x0, z0)) return;
    if (this.nodeReady(x0, z0, size)) { this.show(x0, z0, size); return; }
    if (size === CHUNK) return;
    const h = size / 2;
    this.drawFine(x0, z0, h); this.drawFine(x0 + h, z0, h); this.drawFine(x0, z0 + h, h); this.drawFine(x0 + h, z0 + h, h);
  }

  private draw(x0: number, z0: number, size: number) {
    if (!this.inWorld(x0, z0)) return;
    if (this.isLeaf(x0, z0, size)) { this.drawFine(x0, z0, size); return; }
    const h = size / 2;
    const kids = [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]];
    if (kids.every(([x, z]) => this.canCover(x, z, h)) || !this.nodeReady(x0, z0, size)) {
      for (const [x, z] of kids) this.draw(x, z, h);
    } else {
      this.show(x0, z0, size); // children not ready yet: keep the coarse mesh
    }
  }

  private updateVisibility() {
    for (const m of this.group.children) m.visible = false;
    this.draw(0, 0, this.rootSize);
    this.visDirty = false;
  }

  // -------------------------------------------------------------------- update

  /** True once every visible area is covered by a mesh. */
  get complete() {
    return this.canCover(0, 0, this.rootSize);
  }

  /** Fraction of the current selection that is ready (for loading screens). */
  progress(): number {
    let total = 0, ready = 0;
    for (const col of this.required) for (const i of this.chunkIndicesOfColumn(col)) { total++; if (this.dataState[i] === S.Ready) ready++; }
    for (const col of this.lod0) for (const i of this.chunkIndicesOfColumn(col)) { total++; if (this.meshState[i] === S.Ready) ready++; }
    for (const k of this.selected) { total++; if (this.nodes.get(k)?.state === S.Ready) ready++; }
    return total ? ready / total : 1;
  }

  update(focus: THREE.Vector3, remeshBudget = 3) {
    const dx = focus.x - this.focus.x, dz = focus.z - this.focus.z;
    if (dx * dx + dz * dz > 16) {
      this.focus.set(focus.x, focus.y, focus.z);
      this.reselect();
    }
    this.pool.pump();
    this.remeshDirty(remeshBudget);
    if (this.visDirty) this.updateVisibility();
  }

  /** Force stale LOD regions (after edits) to be rebuilt on next selection. */
  refreshSelection() {
    this.requestWork();
  }

  /** Main-thread remesh of edited chunks, nearest first. */
  remeshDirty(budget: number) {
    if (this.field.dirty.size === 0) return;
    const list = [...this.field.dirty].map(i => {
      const c = this.field.chunks[i];
      return { i, d: this.nearest(c.cx * CHUNK, c.cz * CHUNK, CHUNK) + Math.abs(c.cy * CHUNK + 16 - this.focus.y) * 0.2 };
    }).sort((a, b) => a.d - b.d);
    for (let k = 0; k < list.length && k < budget; k++) {
      const i = list[k].i;
      this.field.dirty.delete(i);
      const c = this.field.chunks[i];
      if (!c.resident || !this.lod0.has(c.cx + c.cz * this.cols)) { this.meshState[i] = S.None; continue; }
      this.setChunkMesh(i, meshChunk(this.field, c.cx, c.cy, c.cz));
    }
  }

  get stats() {
    let tris = 0, meshes = 0;
    for (const m of this.group.children as THREE.Mesh[]) {
      if (!m.visible) continue;
      meshes++;
      tris += m.geometry.attributes.position.count / 3;
    }
    let resident = 0;
    for (const c of this.field.chunks) if (c.resident && c.density) resident++;
    return { tris, meshes, resident, nodes: this.nodes.size, pending: this.pool.pending };
  }

  /** Is terrain data at this point loaded (safe for physics)? */
  isLoaded(x: number, z: number) {
    const col = Math.floor(x / CHUNK) + Math.floor(z / CHUNK) * this.cols;
    return this.chunkIndicesOfColumn(col).every(i => this.field.chunks[i]?.resident);
  }

  dispose() {
    for (const m of this.group.children as THREE.Mesh[]) m.geometry.dispose();
    this.group.clear();
  }
}
