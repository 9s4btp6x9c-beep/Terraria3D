// Grappling hook visuals: a chain of small links from the player's hand to
// the hook head, plus the hook's claw model at the anchor.

import * as THREE from 'three';
import { item } from '../items/items';
import { itemModel, parts } from './models';

const LINKS = 40;

export class RopeRenderer {
  readonly group = new THREE.Group();
  private links: THREE.InstancedMesh;
  private head: THREE.Mesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private d = new THREE.Vector3();

  constructor(material: THREE.Material) {
    const link = parts.merge([parts.box(0.05, 0.22, 0.02, 'iron'), parts.box(0.02, 0.22, 0.05, 'metal')]);
    this.links = new THREE.InstancedMesh(link, material, LINKS);
    this.links.frustumCulled = false;
    this.head = new THREE.Mesh(itemModel(item('grappling_hook')), material);
    this.group.add(this.links, this.head);
    this.group.visible = false;
  }

  update(visible: boolean, hx: number, hy: number, hz: number, x: number, y: number, z: number) {
    this.group.visible = visible;
    if (!visible) return;
    this.d.set(x - hx, y - hy, z - hz);
    const len = this.d.length();
    this.d.normalize();
    this.q.setFromUnitVectors(this.up, this.d);
    const n = Math.min(LINKS, Math.max(1, Math.ceil(len / 0.22)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const sag = Math.sin(t * Math.PI) * Math.min(0.4, len * 0.02);
      this.m.compose(new THREE.Vector3(hx + (x - hx) * t, hy + (y - hy) * t - sag, hz + (z - hz) * t), this.q, new THREE.Vector3(1, len / n / 0.22, 1));
      this.links.setMatrixAt(i, this.m);
    }
    this.links.count = n;
    this.links.instanceMatrix.needsUpdate = true;
    this.head.position.set(x, y, z);
    this.head.quaternion.copy(this.q);
  }
}
