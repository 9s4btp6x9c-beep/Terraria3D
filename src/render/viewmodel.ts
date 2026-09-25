// First-person held item: chunky low-poly pickaxe / axe / material block in
// the lower right, with a snappy swing animation and walk bob.

import * as THREE from 'three';
import { item } from '../items/items';

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.rotateZ(rz);
  g.translate(x, y, z);
  // Bake simple directional shading into vertex colours (flat, retro look).
  const n = g.attributes.normal, cols: number[] = [];
  const base = new THREE.Color(color);
  for (let i = 0; i < n.count; i++) {
    const shade = 0.62 + 0.38 * Math.max(0, n.getX(i) * -0.3 + n.getY(i) * 0.8 + n.getZ(i) * 0.5);
    cols.push(base.r * shade, base.g * shade, base.b * shade);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

function merge(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [], col: number[] = [];
  for (const g of geos) {
    pos.push(...(g.attributes.position.array as Float32Array));
    col.push(...(g.attributes.color.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function toolGeometry(id: string, head: number): THREE.BufferGeometry {
  const handle = box(0.05, 0.62, 0.05, 0x8a5a36, 0, 0, 0);
  if (id.endsWith('axe') && !id.endsWith('pickaxe')) {
    return merge([handle, box(0.2, 0.16, 0.035, head, 0.09, 0.24, 0), box(0.05, 0.2, 0.04, head, 0.2, 0.24, 0)]);
  }
  return merge([
    handle,
    box(0.2, 0.06, 0.05, head, -0.09, 0.3, 0, 0.35),
    box(0.2, 0.06, 0.05, head, 0.09, 0.3, 0, -0.35),
    box(0.06, 0.06, 0.06, head, 0, 0.3, 0),
  ]);
}

export class Viewmodel {
  readonly root = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private currentId: string | null = null;
  private swing = 0;
  private bob = 0;

  constructor(camera: THREE.Camera) {
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: true, fog: false });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.root.position.set(0.46, -0.4, -0.72);
    this.root.scale.setScalar(0.72);
    camera.add(this.root);
  }

  setItem(id: string | null) {
    if (id === this.currentId) return;
    this.currentId = id;
    this.mesh.geometry.dispose();
    if (!id) { this.mesh.geometry = new THREE.BufferGeometry(); return; }
    const def = item(id);
    const color = new THREE.Color(def.color).getHex();
    this.mesh.geometry = def.kind === 'tool' ? toolGeometry(id, color) : merge([box(0.22, 0.22, 0.22, color)]);
  }

  triggerSwing() { this.swing = 1; }

  update(dt: number, moving: number, brightness: number) {
    this.swing = Math.max(0, this.swing - dt * 5);
    this.bob += dt * moving * 9;
    const s = Math.sin((1 - this.swing) * Math.PI) * (this.swing > 0 ? 1 : 0);
    const isTool = this.currentId ? item(this.currentId).kind === 'tool' : false;
    this.mesh.rotation.set(-0.35 - s * 1.3, 0.25, isTool ? 0.35 : 0.2);
    this.mesh.position.set(Math.sin(this.bob) * 0.015 * moving, Math.abs(Math.cos(this.bob)) * 0.02 * moving - s * 0.08, -s * 0.12);
    this.material.color.setScalar(0.3 + brightness * 0.7);
  }
}
