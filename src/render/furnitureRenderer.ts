// Renders placed furniture (one mesh per object; counts are small), animates
// doors, registers light sources (torches, furnaces, forges) with the light
// pool and shows the placement ghost.

import * as THREE from 'three';
import { FURNITURE, type FurnitureSet, type Placed, lightPoint } from '../building/furniture';
import type { FurnitureId } from '../items/items';
import type { LightPool } from './atmosphere';
import { doorFrame, furnitureModel, lifeCrystalBase, lifeCrystalHeart } from './models';

interface Entry { f: Placed; group: THREE.Group; leaf?: THREE.Mesh; light?: number; angle: number; spin?: THREE.Mesh }

export class FurnitureRenderer {
  readonly group = new THREE.Group();
  private entries = new Map<number, Entry>();
  private version = -1;
  private ghost: THREE.Group;
  private ghostMat: THREE.MeshBasicMaterial;
  private frame = doorFrame();
  private crystalBase = lifeCrystalBase();
  private crystalHeart = lifeCrystalHeart();
  private time = 0;

  constructor(private set: FurnitureSet, private material: THREE.Material, private lights: LightPool) {
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.4, depthWrite: false });
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.group.add(this.ghost);
  }

  private build(f: Placed, mat: THREE.Material): { group: THREE.Group; leaf?: THREE.Mesh; spin?: THREE.Mesh } {
    const group = new THREE.Group();
    group.position.set(f.x, f.y, f.z);
    group.rotation.y = f.rot * Math.PI / 2;
    let leaf: THREE.Mesh | undefined, spin: THREE.Mesh | undefined;
    if (f.type === 'life_crystal') {
      group.add(new THREE.Mesh(this.crystalBase, mat));
      spin = new THREE.Mesh(this.crystalHeart, mat);
      group.add(spin);
    } else if (f.type === 'door') {
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
    return { group, leaf, spin };
  }

  private sync() {
    const seen = new Set<number>();
    for (const f of this.set.items.values()) {
      seen.add(f.uid);
      if (this.entries.has(f.uid)) continue;
      const { group, leaf, spin } = this.build(f, this.material);
      this.group.add(group);
      const def = FURNITURE[f.type];
      let light: number | undefined;
      const lp = lightPoint(f);
      if (def.light && lp) {
        light = this.lights.add({ x: lp[0], y: lp[1], z: lp[2], color: new THREE.Color(def.light.color), range: def.light.range, flicker: def.light.flicker });
      }
      this.entries.set(f.uid, { f, group, leaf, light, angle: f.open ? 1 : 0, spin });
    }
    for (const [uid, e] of this.entries) {
      if (seen.has(uid)) continue;
      this.group.remove(e.group);
      if (e.light) this.lights.remove(e.light);
      this.entries.delete(uid);
    }
  }

  update(dt: number, cam?: THREE.Vector3) {
    if (this.set.version !== this.version) {
      this.version = this.set.version;
      this.sync();
    }
    // Furniture is small: skip drawing it far away (cave crystals, cabins).
    if (cam) for (const e of this.entries.values()) e.group.visible = Math.hypot(e.f.x - cam.x, e.f.y - cam.y, e.f.z - cam.z) < 110;
    this.time += dt;
    // Door swing animation; life crystals turn slowly and bob.
    for (const e of this.entries.values()) {
      if (e.spin) {
        e.spin.rotation.y = this.time * 0.9 + e.f.uid;
        e.spin.position.y = Math.sin(this.time * 1.7 + e.f.uid) * 0.05;
      }
      if (!e.leaf) continue;
      const target = e.f.open ? 1 : 0;
      if (e.angle === target) continue;
      e.angle += Math.sign(target - e.angle) * Math.min(Math.abs(target - e.angle), dt * 5);
      const t = e.angle * e.angle * (3 - 2 * e.angle);
      e.leaf.rotation.y = -t * (e.f.swing ?? 1) * Math.PI / 2;
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
