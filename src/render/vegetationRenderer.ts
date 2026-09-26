// Instanced low-poly trees, grass tufts and flowers.
// Trees: tall straight trunks with stacked, faceted canopy blobs on short
// branches (a few seeded variants per kind), textured through the shared
// world shader. Grass: spiky blade clusters coloured per vertex.

import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { TREE_KINDS, TREE_VARIANTS, TUFT_CELL, type Tree, type TreeKind, type Vegetation } from '../world/vegetation';
import { Mat } from '../world/materials';
import { mergeNonIndexed } from './sky';
import { layerOf } from './textures';

/** Tag a geometry with a single texture layer for the world shader. */
export function tagLayer(g: THREE.BufferGeometry, layer: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  geo.setAttribute('mats', new THREE.BufferAttribute(new Uint8Array(n * 3).fill(layer), 3));
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

function blob(rand: () => number, sx: number, sy: number, sz: number, x: number, y: number, z: number, detail = 1, layer: Parameters<typeof layerOf>[0] = 'leaves') {
  const g = new THREE.IcosahedronGeometry(1, detail);
  jitter(g, rand, 0.28);
  g.scale(sx, sy, sz);
  g.rotateY(rand() * Math.PI);
  g.translate(x, y, z);
  g.computeVertexNormals();
  return tagLayer(g, layerOf(layer));
}

function trunk(r0: number, r1: number, h: number, x = 0, y = 0, z = 0, tiltX = 0, tiltZ = 0, sides = 6, layer: Parameters<typeof layerOf>[0] = 'bark') {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, 1, true);
  g.translate(0, h / 2, 0);
  g.rotateX(tiltX);
  g.rotateZ(tiltZ);
  g.translate(x, y, z);
  return tagLayer(g, layerOf(layer));
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
  } else if (kind === 'amber') {
    // Amberwood: a broad, low crown in burnt orange with resin beads on the bark.
    parts.push(trunk(0.055, 0.035, H * 0.62, 0, 0, 0, 0, 0, 6, 'rootbark'));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rand();
      parts.push(trunk(0.02, 0.012, 0.22, 0, H * 0.5, 0, Math.sin(a) * 0.9, -Math.cos(a) * 0.9, 5, 'rootbark'));
      parts.push(blob(rand, 0.22 + rand() * 0.06, 0.13, 0.22, Math.cos(a) * 0.2, H * (0.7 + rand() * 0.06), Math.sin(a) * 0.2, 1, 'amberleaves'));
    }
    parts.push(blob(rand, 0.28, 0.17, 0.28, 0, H * 0.84, 0, 1, 'amberleaves'));
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2, y = 0.15 + rand() * 0.35;
      parts.push(tagLayer(new THREE.OctahedronGeometry(0.018, 0).scale(1, 1.6, 1).translate(Math.cos(a) * 0.045, y, Math.sin(a) * 0.045), layerOf('amber')));
    }
  } else if (kind === 'gnarl') {
    // Rootwold: a squat, twisting trunk on flared roots under heavy moss.
    let x = 0, z = 0;
    const lean = rand() * Math.PI * 2;
    for (let i = 0; i < 4; i++) {
      const y0 = i * 0.16, r0 = 0.07 - i * 0.012;
      const a = lean + i * 1.3;
      parts.push(trunk(r0, r0 - 0.012, 0.18, x, y0, z, Math.sin(a) * 0.25, -Math.cos(a) * 0.25, 6, 'rootbark'));
      x += Math.cos(a) * 0.04; z += Math.sin(a) * 0.04;
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rand() * 0.6;
      parts.push(trunk(0.03, 0.012, 0.16, Math.cos(a) * 0.02, 0.1, Math.sin(a) * 0.02, Math.sin(a) * 1.9, -Math.cos(a) * 1.9, 5, 'rootbark'));
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rand();
      parts.push(blob(rand, 0.2 + rand() * 0.07, 0.11, 0.2, x + Math.cos(a) * 0.17, H * (0.62 + rand() * 0.1), z + Math.sin(a) * 0.17, 1, 'mossleaves'));
    }
    parts.push(blob(rand, 0.24, 0.14, 0.24, x, H * 0.76, z, 1, 'mossleaves'));
    // Hanging moss strands.
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2, r = 0.18 + rand() * 0.1;
      parts.push(tagLayer(new THREE.ConeGeometry(0.02, 0.16 + rand() * 0.1, 4).rotateX(Math.PI).translate(x + Math.cos(a) * r, H * 0.52, z + Math.sin(a) * r), layerOf('mossleaves')));
    }
  } else if (kind === 'cactus') {
    const c = (g: THREE.BufferGeometry) => tagLayer(g, layerOf('cactus'));
    const col = (r: number, h: number, x: number, y: number, z: number) => {
      const g = new THREE.CylinderGeometry(r, r * 1.05, h, 7);
      g.translate(x, y + h / 2, z);
      return c(g);
    };
    parts.push(col(0.1, 0.9, 0, 0, 0));
    parts.push(c(new THREE.SphereGeometry(0.1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.9, 0)));
    const arms = 1 + (variant % 2);
    for (let i = 0; i < arms; i++) {
      const side = i === 0 ? 1 : -1, y = 0.35 + rand() * 0.2;
      parts.push(c(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 6).rotateZ(Math.PI / 2).translate(side * 0.14, y, 0)));
      parts.push(col(0.065, 0.28 + rand() * 0.1, side * 0.22, y - 0.03, 0));
      parts.push(c(new THREE.SphereGeometry(0.065, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(side * 0.22, y + 0.3, 0)));
    }
    // A bloom on top.
    parts.push(tagLayer(new THREE.OctahedronGeometry(0.05, 0).scale(1, 0.6, 1).translate(0.03, 0.99, 0), layerOf('red')));
  } else if (kind === 'mushroom') {
    return buildMushroom(rand, 7);
  } else if (kind === 'dead' || kind === 'bleached' || kind === 'charred') {
    // Riftlands: dead trees hung with crystal; Ossuary: bare, sun-bleached
    // snags; Cinder Peaks: burnt black stumps.
    const bleached = kind !== 'dead';
    const bark = (g: THREE.BufferGeometry) => tagLayer(g, kind === 'charred' ? Mat.Basalt : layerOf(kind === 'bleached' ? 'bone' : 'deadbark'));
    const t = new THREE.CylinderGeometry(0.02, 0.045, H, 5, 1, true);
    t.translate(0, H / 2, 0);
    parts.push(bark(t));
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2, y = H * (0.45 + rand() * 0.45), len = 0.12 + rand() * 0.18;
      const b = new THREE.CylinderGeometry(0.006, 0.014, len, 4, 1, true).translate(0, len / 2, 0);
      b.rotateZ(-0.9 - rand() * 0.4);
      b.rotateY(a);
      b.translate(0, y, 0);
      parts.push(bark(b));
      if (!bleached && rand() < 0.6) {
        const g = new THREE.IcosahedronGeometry(1, 0);
        jitter(g, rand, 0.3);
        g.scale(0.07, 0.05, 0.07);
        g.translate(Math.cos(a) * len * 0.8, y + len * 0.5, -Math.sin(a) * len * 0.8);
        g.computeVertexNormals();
        parts.push(tagLayer(g, layerOf('riftleaves')));
      }
    }
  } else {
    // Spruce: a straight trunk hidden inside tiers of drooping boughs that
    // narrow all the way up to a pointed tip.
    parts.push(trunk(0.05, 0.015, H * 0.92));
    const tiers = 6;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const r = 0.3 * (1 - t) + 0.075 + (rand() - 0.5) * 0.02;
      const h = 0.27 - t * 0.09;
      const g = new THREE.ConeGeometry(r, h, 8, 1).toNonIndexed();
      jitter(g, rand, 0.02);
      g.rotateY(rand() * Math.PI);
      g.translate(0, H * (0.16 + t * 0.66) + h / 2, 0);
      g.computeVertexNormals();
      parts.push(tagLayer(g, layerOf('leaves')));
    }
    const tip = new THREE.ConeGeometry(0.05, 0.16, 6, 1).toNonIndexed();
    tip.translate(0, H * 0.92, 0);
    tip.computeVertexNormals();
    parts.push(tagLayer(tip, layerOf('leaves')));
  }
  const merged = mergeNonIndexed(parts);
  merged.computeBoundingSphere();
  return merged;
}

/** Giant mushroom of unit height: a curved pale stem under a glowing cap. */
function buildMushroom(rand: () => number, sides: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stem = (g: THREE.BufferGeometry) => tagLayer(g, layerOf('mushstem'));
  const lean = (rand() - 0.5) * 0.12;
  // Stem: three stacked segments drifting sideways into a gentle curve, on a flared foot.
  parts.push(stem(new THREE.CylinderGeometry(0.05, 0.075, 0.1, sides).translate(0, 0.05, 0)));
  const segs: [number, number, number, number, number][] = [[0.05, 0.045, 0.1, 0.38, 0], [0.045, 0.04, 0.37, 0.65, 0.35], [0.04, 0.036, 0.64, 0.9, 0.75]];
  for (const [r0, r1, y0, y1, k] of segs) parts.push(stem(new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1, true).translate(lean * k, (y0 + y1) / 2, 0)));
  const topX = lean;
  // Cap: a flattened, faceted dome with a darker gill ring underneath.
  const capR = 0.3 + rand() * 0.06;
  const cap = new THREE.SphereGeometry(capR, sides + 3, 3, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  jitter(cap, rand, 0.03);
  cap.scale(1, 0.55, 1).translate(topX, 0.9, 0);
  cap.computeVertexNormals();
  parts.push(tagLayer(cap, layerOf('glowcap')));
  const gills = new THREE.CylinderGeometry(capR * 0.98, capR * 0.3, 0.05, sides + 3, 1).translate(topX, 0.88, 0);
  parts.push(tagLayer(gills, layerOf('glowcap')));
  // Bright spots on the cap.
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2, r = capR * (0.25 + rand() * 0.6);
    const h = Math.sqrt(Math.max(0, 1 - (r / capR) ** 2)) * capR * 0.55;
    parts.push(tagLayer(new THREE.OctahedronGeometry(0.018 + rand() * 0.015, 0).scale(1, 0.5, 1).translate(topX + Math.cos(a) * r, 0.9 + h, Math.sin(a) * r), layerOf('plain')));
  }
  const merged = mergeNonIndexed(parts);
  merged.computeBoundingSphere();
  return merged;
}

/** Cheap silhouette-preserving version for distant trees (~60 triangles). */
function buildFarTree(kind: TreeKind, variant: number): THREE.BufferGeometry {
  const rand = mulberry32(variant * 7919 + kind.length * 31);
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'tall') {
    parts.push(trunk(0.035, 0.02, 1, 0, 0, 0, 0, 0, 4));
    parts.push(blob(rand, 0.19, 0.12, 0.19, 0, 0.95, 0, 0));
    parts.push(blob(rand, 0.12, 0.06, 0.12, 0.05, 0.72, 0.03, 0));
  } else if (kind === 'round') {
    parts.push(trunk(0.07, 0.05, 0.7, 0, 0, 0, 0, 0, 4));
    parts.push(blob(rand, 0.38, 0.28, 0.38, 0, 0.85, 0, 0));
  } else if (kind === 'amber') {
    parts.push(trunk(0.06, 0.04, 0.65, 0, 0, 0, 0, 0, 4, 'rootbark'));
    parts.push(blob(rand, 0.4, 0.2, 0.4, 0, 0.78, 0, 0, 'amberleaves'));
  } else if (kind === 'gnarl') {
    parts.push(trunk(0.07, 0.035, 0.62, 0, 0, 0, 0, 0, 4, 'rootbark'));
    parts.push(blob(rand, 0.34, 0.18, 0.34, 0, 0.7, 0, 0, 'mossleaves'));
  } else if (kind === 'cactus' || kind === 'dead' || kind === 'bleached' || kind === 'charred') {
    return buildTree(kind, variant);
  } else if (kind === 'mushroom') {
    return buildMushroom(rand, 5);
  } else {
    parts.push(trunk(0.05, 0.02, 0.5, 0, 0, 0, 0, 0, 4));
    const g = new THREE.ConeGeometry(0.36, 0.84, 6, 1);
    g.translate(0, 0.58, 0);
    g.computeVertexNormals();
    parts.push(tagLayer(g, layerOf('leaves')));
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
    // A small buttercup: a leaning stem with two leaves, six rounded petals
    // cupped slightly upward around a raised amber centre.
    const stem = new THREE.Color(0x3c8a3c), leaf = new THREE.Color(0x4e9e46);
    const petalIn = new THREE.Color(0xffd23a), petalOut = new THREE.Color(0xfff08a), eye = new THREE.Color(0xc8761a);
    const tri = (a: number[], b: number[], c: number[], ca: THREE.Color, cb = ca, cc = ca) => {
      pos.push(...a, ...b, ...c);
      col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    };
    const top = [0.05, 0.62, 0];
    // Stem as two crossed slivers so it reads from any side.
    tri([-0.018, 0, 0], [0.018, 0, 0], top, stem);
    tri([0, 0, -0.018], [0, 0, 0.018], top, stem);
    for (const [a, y] of [[0.6, 0.2], [3.4, 0.3]] as const) {
      const lx = Math.cos(a), lz = Math.sin(a);
      tri([0, y, 0], [lx * 0.14 - lz * 0.04, y + 0.1, lz * 0.14 + lx * 0.04], [lx * 0.2, y + 0.05, lz * 0.2], leaf, stem, stem);
      tri([0, y, 0], [lx * 0.2, y + 0.05, lz * 0.2], [lx * 0.14 + lz * 0.04, y + 0.1, lz * 0.14 - lx * 0.04], leaf, stem, stem);
    }
    const [hx, hy, hz] = top;
    const petals = 6;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz * 0.045, pz = dx * 0.045;
      const r0 = 0.025, r1 = 0.1, r2 = 0.14;
      const base = [hx + dx * r0, hy, hz + dz * r0];
      const l = [hx + dx * r1 + px, hy + 0.03, hz + dz * r1 + pz], r = [hx + dx * r1 - px, hy + 0.03, hz + dz * r1 - pz];
      const tip = [hx + dx * r2, hy + 0.055, hz + dz * r2];
      tri(base, l, r, petalIn, petalOut, petalOut);
      tri(l, tip, r, petalOut);
    }
    // Raised centre: a low pyramid.
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + 0.4, a1 = ((i + 1) / 4) * Math.PI * 2 + 0.4;
      tri([hx + Math.cos(a0) * 0.04, hy + 0.01, hz + Math.sin(a0) * 0.04], [hx, hy + 0.05, hz], [hx + Math.cos(a1) * 0.04, hy + 0.01, hz + Math.sin(a1) * 0.04], eye);
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

const NEAR_TREES = 110;
const GRASS_RADIUS_MAX = 46;
const MAX_TUFTS = 14000;
/** Grass cell offsets within the radius, nearest first (fills in around the player first). */
const cellOffsets = (radius: number): [number, number][] => {
  const r = Math.ceil(radius / TUFT_CELL), out: [number, number][] = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dz * dz <= r * r) out.push([dx, dz]);
  return out.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
};

interface TreeSet { near: THREE.InstancedMesh; far: THREE.InstancedMesh; trees: Tree[] }

export class VegetationRenderer {
  readonly group = new THREE.Group();
  private sets = new Map<string, TreeSet>();
  private nearSlot = new Map<number, { set: TreeSet; index: number }>();
  private grass: THREE.InstancedMesh;
  private flowers: THREE.InstancedMesh;
  private lastBucket = new THREE.Vector3(1e9, 0, 1e9);
  private lastGrass = { cx: 1e9, cz: 1e9, version: -1, missing: false, retry: 0 };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  treesDirty = true;
  private offsets: [number, number][];

  constructor(private veg: Vegetation, treeMat: THREE.Material, grassMat: THREE.Material,
    private grassRadius = GRASS_RADIUS_MAX, private farTrees = 520) {
    this.offsets = cellOffsets(Math.min(grassRadius, GRASS_RADIUS_MAX));
    const groups = new Map<string, Tree[]>();
    for (const t of veg.trees) {
      const key = `${t.kind}-${t.variant}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
    }
    for (const kind of TREE_KINDS)
      for (let v = 0; v < TREE_VARIANTS; v++) {
        const key = `${kind}-${v}`;
        const trees = groups.get(key);
        if (!trees) continue;
        const near = new THREE.InstancedMesh(buildTree(kind, v), treeMat, trees.length);
        const far = new THREE.InstancedMesh(buildFarTree(kind, v), treeMat, trees.length);
        near.castShadow = true;
        near.receiveShadow = far.receiveShadow = true;
        near.count = far.count = 0;
        // Instances span the world; skip per-mesh culling (cheap vertex work).
        near.frustumCulled = far.frustumCulled = false;
        this.sets.set(key, { near, far, trees });
        this.group.add(near, far);
      }

    this.grass = new THREE.InstancedMesh(buildTuft(false), grassMat, MAX_TUFTS);
    this.flowers = new THREE.InstancedMesh(buildTuft(true), grassMat, 2000);
    for (const mesh of [this.grass, this.flowers]) {
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  private treeMatrix(t: Tree, wobble = 0) {
    this.q.setFromEuler(new THREE.Euler(wobble, (t.id * 2.39996) % (Math.PI * 2), 0));
    return this.m.compose(this.p.set(t.x, t.y, t.z), this.q, this.s.setScalar(t.height));
  }

  /** Assign trees to near/far instance sets by distance. */
  private bucket(focus: THREE.Vector3) {
    this.nearSlot.clear();
    for (const set of this.sets.values()) {
      let n = 0, f = 0;
      for (const t of set.trees) {
        if (!t.alive) continue;
        const d = Math.hypot(t.x - focus.x, t.z - focus.z);
        // Cavern mushrooms are buried: only draw the ones close by.
        if (t.kind === 'mushroom' && d > 70) continue;
        if (d < NEAR_TREES) {
          set.near.setMatrixAt(n, this.treeMatrix(t));
          this.nearSlot.set(t.id, { set, index: n });
          n++;
        } else if (d < this.farTrees) {
          set.far.setMatrixAt(f++, this.treeMatrix(t));
        }
      }
      set.near.count = n; set.far.count = f;
      set.near.visible = n > 0; set.far.visible = f > 0;
      set.near.instanceMatrix.needsUpdate = true;
      set.far.instanceMatrix.needsUpdate = true;
    }
  }

  private rebuildGrass(cx: number, cz: number) {
    let gi = 0, fi = 0, generated = 0;
    this.lastGrass.missing = false;
    for (const [dx, dz] of this.offsets) {
      // Generate at most a few new cells per frame; the rest fill in next frames.
      const before = this.veg.tuftVersion;
      const list = generated < 10 ? this.veg.tufts(cx + dx, cz + dz) : this.veg.tuftsCached(cx + dx, cz + dz);
      if (this.veg.tuftVersion !== before) generated++;
      // Missing = terrain not loaded yet, or over this frame's generation budget.
      if (!list) { this.lastGrass.missing = true; continue; }
      for (const t of list) {
        const mesh = t.flower ? this.flowers : this.grass;
        const index = t.flower ? fi : gi;
        if (index >= (t.flower ? 2000 : MAX_TUFTS)) continue;
        this.q.setFromAxisAngle(this.up, t.rot);
        mesh.setMatrixAt(index, this.m.compose(this.p.set(t.x, t.y, t.z), this.q, this.s.setScalar(t.scale)));
        if (t.flower) fi++; else gi++;
      }
    }
    this.grass.count = gi; this.flowers.count = fi;
    this.grass.instanceMatrix.needsUpdate = true;
    this.flowers.instanceMatrix.needsUpdate = true;
    return generated;
  }

  update(focus: THREE.Vector3, dt: number) {
    if (this.treesDirty || Math.hypot(focus.x - this.lastBucket.x, focus.z - this.lastBucket.z) > 12) {
      this.bucket(focus);
      this.lastBucket.copy(focus);
      this.treesDirty = false;
    }
    const cx = Math.floor(focus.x / TUFT_CELL), cz = Math.floor(focus.z / TUFT_CELL);
    const g = this.lastGrass;
    g.retry -= dt;
    if (cx !== g.cx || cz !== g.cz || this.veg.tuftVersion !== g.version || (g.missing && g.retry <= 0)) {
      this.rebuildGrass(cx, cz);
      g.cx = cx; g.cz = cz; g.version = this.veg.tuftVersion;
      g.retry = g.missing ? 0.05 : 0.5;
    }
    this.veg.trimTufts(focus.x, focus.z, this.grassRadius + 40);
  }

  get counts() {
    let near = 0, far = 0;
    for (const s of this.sets.values()) { near += s.near.count; far += s.far.count; }
    return { near, far, grass: this.grass.count };
  }

  removeTree() { this.treesDirty = true; }

  /** Shake a tree when it is hit. */
  wobbleTree(id: number, t: number) {
    const slot = this.nearSlot.get(id);
    const tree = this.veg.trees[id];
    if (!slot || !tree.alive) return;
    slot.set.near.setMatrixAt(slot.index, this.treeMatrix(tree, Math.sin(t * 40) * 0.03 * Math.max(0, 1 - t * 3)));
    slot.set.near.instanceMatrix.needsUpdate = true;
  }
}
