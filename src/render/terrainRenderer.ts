// Owns one THREE.Mesh per non-empty terrain chunk and rebuilds meshes for
// chunks the TerrainField marks dirty.

import * as THREE from 'three';
import { CHUNK } from '../world/config';
import { meshChunk } from '../world/mesher';
import type { TerrainField } from '../world/terrain';

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();

  constructor(private field: TerrainField, private material: THREE.Material) {
    this.group.name = 'terrain';
  }

  /** Mesh every chunk (used at load); yields periodically via the callback. */
  async buildAll(onProgress: (f: number) => void) {
    const n = this.field.chunks.length;
    for (let i = 0; i < n; i++) {
      this.rebuild(i);
      if (i % 12 === 11) {
        onProgress(i / n);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    this.field.dirty.clear();
    onProgress(1);
  }

  /** Rebuild dirty chunks, nearest to `focus` first, up to `budget` per call. */
  update(focus: THREE.Vector3, budget = 6) {
    if (this.field.dirty.size === 0) return;
    const list = [...this.field.dirty].map(i => {
      const c = this.field.chunks[i];
      const dx = c.cx * CHUNK + 16 - focus.x, dy = c.cy * CHUNK + 16 - focus.y, dz = c.cz * CHUNK + 16 - focus.z;
      return { i, d: dx * dx + dy * dy + dz * dz };
    }).sort((a, b) => a.d - b.d);
    for (let k = 0; k < Math.min(budget, list.length); k++) {
      this.rebuild(list[k].i);
      this.field.dirty.delete(list[k].i);
    }
  }

  private rebuild(index: number) {
    const c = this.field.chunks[index];
    const data = meshChunk(this.field, c.cx, c.cy, c.cz);
    const old = this.meshes.get(index);
    if (!data) {
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
        this.meshes.delete(index);
      }
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('mats', new THREE.BufferAttribute(data.mats, 3));
    geo.setAttribute('bary', new THREE.BufferAttribute(data.bary, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    if (old) {
      old.geometry.dispose();
      old.geometry = geo;
      return;
    }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = `chunk-${c.cx}-${c.cy}-${c.cz}`;
    this.meshes.set(index, mesh);
    this.group.add(mesh);
  }

  get triangleCount() {
    let n = 0;
    for (const m of this.meshes.values()) n += m.geometry.attributes.position.count / 3;
    return n;
  }
}
