// Instanced low-poly trees, grass tufts and flowers.
// Trees: tall straight trunks with stacked, faceted canopy blobs on short
// branches (a few seeded variants per kind), textured through the shared
// world shader. Grass: spiky blade clusters coloured per vertex.

import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { TREE_KINDS, TREE_VARIANTS, type Tree, type TreeKind, type Vegetation } from '../world/vegetation';
import { mergeNonIndexed } from './sky';
import { layerOf } from './textures';

/** Tag a geometry with a single texture layer for the world shader. */
export function tagLayer(g: THREE.BufferGeometry, layer: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const mats = new Float32Array(n * 3).fill(layer);
  const bary = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) bary[i * 3] = 1;
  geo.setAttribute('mats', new THREE.BufferAttribute(mats, 3));
  geo.setAttribute('bary', new THREE.BufferAttribute(bary, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

function jitter(g: THREE.BufferGeometry, rand: () => number, amt: number) {
  const p = g.attributes.position;
  // Jitter shared positions consistently so the blob stays closed.
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = seen.get(k);
    if (!o) { o = [(rand() - 0.5) * amt, (rand() - 0.5) * amt, (rand() - 0.5) * amt]; seen.set(k, o); }
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
}

function blob(rand: () => number, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  jitter(g, rand, 0.28);
  g.scale(sx, sy, sz);
  g.rotateY(rand() * Math.PI);
  g.translate(x, y, z);
  g.computeVertexNormals();
  return tagLayer(g, layerOf('leaves'));
}

function trunk(r0: number, r1: number, h: number, x = 0, y = 0, z = 0, tiltX = 0, tiltZ = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 6, 1, true);
  g.translate(0, h / 2, 0);
  g.rotateX(tiltX);
  g.rotateZ(tiltZ);
  g.translate(x, y, z);
  return tagLayer(g, layerOf('bark'));
}

/** Build a tree of unit height (scaled per instance by tree.height). */
function buildTree(kind: TreeKind, variant: number): THREE.BufferGeometry {
  const rand = mulberry32(variant * 7919 + kind.length * 31);
  const parts: THREE.BufferGeometry[] = [];
  const H = 1;
  if (kind === 'tall') {
    parts.push(trunk(0.03, 0.018, H));
    parts.push(blob(rand, 0.17, 0.1, 0.17, 0, H * 0.97, 0));
    parts.push(blob(rand, 0.12, 0.07, 0.12, 0.06, H * 0.9, 0.04));
    const branches = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < branches; i++) {
      const y = H * (0.45 + (i / branches) * 0.4 + rand() * 0.05);
      const a = rand() * Math.PI * 2, len = 0.07 + rand() * 0.06;
      const bx = Math.cos(a) * len, bz = Math.sin(a) * len;
      parts.push(trunk(0.008, 0.005, len * 1.2, 0, y, 0, Math.sin(a) * 1.1, -Math.cos(a) * 1.1));
      parts.push(blob(rand, 0.075 + rand() * 0.04, 0.04, 0.075 + rand() * 0.04, bx, y + len * 0.5, bz));
    }
  } else if (kind === 'round') {
    parts.push(trunk(0.06, 0.04, H * 0.7));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rand();
      parts.push(blob(rand, 0.26 + rand() * 0.08, 0.2, 0.26, Math.cos(a) * 0.18, H * (0.72 + rand() * 0.12), Math.sin(a) * 0.18));
    }
    parts.push(blob(rand, 0.3, 0.24, 0.3, 0, H * 0.92, 0));
  } else {
    parts.push(trunk(0.05, 0.02, H));
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      const r = 0.34 * (1 - t) + 0.06;
      const g = new THREE.ConeGeometry(r, 0.3, 7, 1).toNonIndexed();
      jitter(g, rand, 0.03);
      g.translate(0, H * (0.3 + t * 0.2) + 0.15, 0);
      g.rotateY(rand());
      g.computeVertexNormals();
      parts.push(tagLayer(g, layerOf('leaves')));
    }
  }
  const merged = mergeNonIndexed(parts);
  merged.computeBoundingSphere();
  return merged;
}

function buildTuft(flower: boolean): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const dark = new THREE.Color(0x236a3c), light = new THREE.Color(0x6ccf6a);
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i;
    const r = 0.12 + (i % 2) * 0.1;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const h = 0.35 + (i % 3) * 0.18;
    const w = 0.07;
    const tx = cx * 1.4, tz = cz * 1.4;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, tx, h, tz);
    col.push(dark.r, dark.g, dark.b, dark.r, dark.g, dark.b, light.r, light.g, light.b);
  }
  if (flower) {
    const stem = new THREE.Color(0x3c8a3c), head = new THREE.Color(0xffc93a);
    pos.push(-0.02, 0, 0, 0.02, 0, 0, 0, 0.7, 0);
    col.push(stem.r, stem.g, stem.b, stem.r, stem.g, stem.b, stem.r, stem.g, stem.b);
    const hs = 0.11;
    const petals = [[hs, 0], [0, hs], [-hs, 0], [0, -hs]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = petals[i], [bx, bz] = petals[(i + 1) % 4];
      pos.push(0, 0.74, 0, ax, 0.68, az, bx, 0.68, bz);
      pos.push(0, 0.74, 0, bx, 0.68, bz, ax, 0.68, az);
      for (let k = 0; k < 6; k++) col.push(head.r, head.g, head.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Grass faces up for lighting so it matches the ground under it.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return tagLayer(g, layerOf('plain'));
}

export class VegetationRenderer {
  readonly group = new THREE.Group();
  private treeMeshes = new Map<string, THREE.InstancedMesh>();
  private treeSlot = new Map<number, { key: string; index: number }>();
  private grass: THREE.InstancedMesh;
  private flowers: THREE.InstancedMesh;
  private tuftSlot: { mesh: THREE.InstancedMesh; index: number }[] = [];

  constructor(private veg: Vegetation, treeMat: THREE.Material, grassMat: THREE.Material) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    // Trees grouped by (kind, variant).
    const groups = new Map<string, Tree[]>();
    for (const t of veg.trees) {
      const key = `${t.kind}-${t.variant}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
    }
    for (const kind of TREE_KINDS)
      for (let v = 0; v < TREE_VARIANTS; v++) {
        const key = `${kind}-${v}`;
        const list = groups.get(key);
        if (!list) continue;
        const mesh = new THREE.InstancedMesh(buildTree(kind, v), treeMat, list.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        list.forEach((t, i) => {
          q.setFromAxisAngle(up, (t.id * 2.39996) % (Math.PI * 2));
          s.setScalar(t.height);
          p.set(t.x, t.y, t.z);
          mesh.setMatrixAt(i, m.compose(p, q, s));
          this.treeSlot.set(t.id, { key, index: i });
        });
        mesh.computeBoundingSphere();
        this.treeMeshes.set(key, mesh);
        this.group.add(mesh);
      }

    const grassList = veg.tufts.filter(t => !t.flower), flowerList = veg.tufts.filter(t => t.flower);
    this.grass = new THREE.InstancedMesh(buildTuft(false), grassMat, Math.max(1, grassList.length));
    this.flowers = new THREE.InstancedMesh(buildTuft(true), grassMat, Math.max(1, flowerList.length));
    let gi = 0, fi = 0;
    veg.tufts.forEach(t => {
      const mesh = t.flower ? this.flowers : this.grass;
      const index = t.flower ? fi++ : gi++;
      q.setFromAxisAngle(up, t.rot);
      s.setScalar(t.scale);
      p.set(t.x, t.y, t.z);
      mesh.setMatrixAt(index, m.compose(p, q, s));
      this.tuftSlot.push({ mesh, index });
    });
    for (const mesh of [this.grass, this.flowers]) {
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  private hide(mesh: THREE.InstancedMesh, index: number) {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    mesh.setMatrixAt(index, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  removeTree(id: number) {
    const slot = this.treeSlot.get(id);
    if (slot) this.hide(this.treeMeshes.get(slot.key)!, slot.index);
  }

  removeTufts(indices: number[]) {
    for (const i of indices) this.hide(this.tuftSlot[i].mesh, this.tuftSlot[i].index);
  }

  /** Shake a tree when it is hit. */
  wobbleTree(id: number, t: number) {
    const slot = this.treeSlot.get(id);
    const tree = this.veg.trees[id];
    if (!slot || !tree.alive) return;
    const mesh = this.treeMeshes.get(slot.key)!;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 40) * 0.03 * Math.max(0, 1 - t * 3), (tree.id * 2.39996) % (Math.PI * 2), 0));
    mesh.setMatrixAt(slot.index, new THREE.Matrix4().compose(new THREE.Vector3(tree.x, tree.y, tree.z), q, new THREE.Vector3().setScalar(tree.height)));
    mesh.instanceMatrix.needsUpdate = true;
  }
}
