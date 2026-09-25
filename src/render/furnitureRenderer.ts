// Renders placed furniture (one mesh per object; counts are small), animates
// doors, registers light sources (torches, furnaces, forges) with the light
// pool and shows the placement ghost.

import * as THREE from 'three';
import { FURNITURE, type FurnitureSet, type Placed } from '../building/furniture';
import type { FurnitureId } from '../items/items';
import type { LightPool } from './atmosphere';
import { doorFrame, furnitureModel } from './models';

interface Entry { f: Placed; group: THREE.Group; leaf?: THREE.Mesh; light?: number; angle: number }

export class FurnitureRenderer {
  readonly group = new THREE.Group();
  private entries = new Map<number, Entry>();
  private version = -1;
  private ghost: THREE.Group;
  private ghostMat: THREE.MeshBasicMaterial;
  private frame = doorFrame();

  constructor(private set: FurnitureSet, private material: THREE.Material, private lights: LightPool) {
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.4, depthWrite: false });
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.group.add(this.ghost);
  }

  private build(f: Placed, mat: THREE.Material): { group: THREE.Group; leaf?: THREE.Mesh } {
    const group = new THREE.Group();
    group.position.set(f.x, f.y, f.z);
    group.rotation.y = f.rot * Math.PI / 2;
    let leaf: THREE.Mesh | undefined;
    if (f.type === 'door') {
      group.add(new THREE.Mesh(this.frame, mat));
      leaf = new THREE.Mesh(furnitureModel('door'), mat);
      leaf.position.x = -0.6;
      group.add(leaf);
    } else {
      const m = new THREE.Mesh(furnitureModel(f.type), mat);
      if (f.wall) {
        // Wall torch: lean out from the wall.
        group.rotation.set(0, 0, 0);
        m.rotation.set(f.wall[2] * 0.45, 0, -f.wall[0] * 0.45);
      }
      group.add(m);
    }
    group.traverse(o => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = f.type !== 'torch'; o.receiveShadow = true; }
    });
    return { group, leaf };
  }

  private sync() {
    const seen = new Set<number>();
    for (const f of this.set.items.values()) {
      seen.add(f.uid);
      if (this.entries.has(f.uid)) continue;
      const { group, leaf } = this.build(f, this.material);
      this.group.add(group);
      const def = FURNITURE[f.type];
      let light: number | undefined;
      if (def.light) {
        const [ox, oy, oz] = def.light.offset;
        const a = f.rot * Math.PI / 2;
        light = this.lights.add({
          x: f.x + ox * Math.cos(a) + oz * Math.sin(a) + (f.wall ? f.wall[0] * 0.25 : 0),
          y: f.y + oy,
          z: f.z - ox * Math.sin(a) + oz * Math.cos(a) + (f.wall ? f.wall[2] * 0.25 : 0),
          color: new THREE.Color(def.light.color), range: def.light.range, flicker: def.light.flicker,
        });
      }
      this.entries.set(f.uid, { f, group, leaf, light, angle: f.open ? 1 : 0 });
    }
    for (const [uid, e] of this.entries) {
      if (seen.has(uid)) continue;
      this.group.remove(e.group);
      if (e.light) this.lights.remove(e.light);
      this.entries.delete(uid);
    }
  }

  update(dt: number) {
    if (this.set.version !== this.version) {
      this.version = this.set.version;
      this.sync();
    }
    // Door swing animation.
    for (const e of this.entries.values()) {
      if (!e.leaf) continue;
      const target = e.f.open ? 1 : 0;
      if (e.angle === target) continue;
      e.angle += Math.sign(target - e.angle) * Math.min(Math.abs(target - e.angle), dt * 5);
      const t = e.angle * e.angle * (3 - 2 * e.angle);
      e.leaf.rotation.y = -t * Math.PI / 2;
    }
  }

  showGhost(type: FurnitureId | null, pos: { x: number; y: number; z: number; rot: number; wall?: [number, number, number] } | null, valid: boolean) {
    if (!type || !pos) { this.ghost.visible = false; return; }
    this.ghost.clear();
    const { group } = this.build({ uid: -1, type, ...pos, hp: 1 }, this.ghostMat);
    this.ghost.add(group);
    this.ghostMat.color.setHex(valid ? 0x66ff88 : 0xff5544);
    this.ghost.visible = true;
  }
}
