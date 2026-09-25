// Procedural low-poly models for every item and furniture piece. Built from
// flat-shaded parts that sample the shared pixel-art texture array (via the
// `mats` layer attribute) and an optional per-part tint (vertex colour), so
// tools, furniture, pickups and icons all match the world's look.
//
// Conventions: metres; tools/weapons have the grip at the origin pointing +y;
// furniture sits on y = 0, centred in x/z, with its front facing +z.

import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import type { FurnitureId, ItemDef, MetalLayer, ModelSpec } from '../items/items';
import { Mat } from '../world/materials';
import { mergeNonIndexed } from './sky';
import { type ExtraLayer, layerOf } from './textures';

type Layer = ExtraLayer | number;

/** Terrain-material layers usable by name in models (e.g. dirt blocks). */
const TERRAIN_LAYERS: Record<string, Mat> = {
  dirt: Mat.Dirt, stone: Mat.Stone, sand: Mat.Sand, clay: Mat.Clay, snow: Mat.Snow, grass: Mat.Grass, deepstone: Mat.Deepstone,
};

function layerIndex(l: Layer | string): number {
  if (typeof l === 'number') return l;
  if (l in TERRAIN_LAYERS) return TERRAIN_LAYERS[l];
  return layerOf(l as ExtraLayer);
}

/** Tag a geometry with a texture layer + tint, flat-shaded, uv-less. */
export function part(g: THREE.BufferGeometry, layer: Layer | string, tint = 0xffffff): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  geo.setAttribute('mats', new THREE.BufferAttribute(new Uint8Array(n * 3).fill(layerIndex(layer)), 3));
  const c = new THREE.Color(tint);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

interface Xf { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number }
function place(g: THREE.BufferGeometry, t: Xf) {
  if (t.rx) g.rotateX(t.rx);
  if (t.ry) g.rotateY(t.ry);
  if (t.rz) g.rotateZ(t.rz);
  g.translate(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  return g;
}

const box = (w: number, h: number, d: number, layer: Layer | string, t: Xf = {}, tint?: number) =>
  part(place(new THREE.BoxGeometry(w, h, d), t), layer, tint);
const cyl = (rt: number, rb: number, h: number, sides: number, layer: Layer | string, t: Xf = {}, tint?: number) =>
  part(place(new THREE.CylinderGeometry(rt, rb, h, sides), t), layer, tint);
const ico = (r: number, layer: Layer | string, t: Xf & { sx?: number; sy?: number; sz?: number; detail?: number; jitter?: number; seed?: number } = {}, tint?: number) => {
  const g = new THREE.IcosahedronGeometry(r, t.detail ?? 0);
  if (t.jitter) {
    const rand = mulberry32(t.seed ?? 7);
    const p = g.attributes.position;
    const seen = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let f = seen.get(k);
      if (f === undefined) { f = 1 + (rand() - 0.5) * t.jitter; seen.set(k, f); }
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
    }
  }
  g.scale(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  return part(place(g, t), layer, tint);
};
const octa = (r: number, layer: Layer | string, t: Xf & { sx?: number; sy?: number; sz?: number } = {}, tint?: number) => {
  const g = new THREE.OctahedronGeometry(r, 0);
  g.scale(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  return part(place(g, t), layer, tint);
};
const cone = (r: number, h: number, sides: number, layer: Layer | string, t: Xf = {}, tint?: number) =>
  part(place(new THREE.ConeGeometry(r, h, sides), t), layer, tint);

/** Box whose top face is scaled (tapered prism). */
function taper(w: number, h: number, d: number, topScaleX: number, topScaleZ: number, layer: Layer | string, t: Xf = {}, tint?: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * topScaleX, p.getY(i), p.getZ(i) * topScaleZ);
  return part(place(g, t), layer, tint);
}

function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeNonIndexed(parts);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ------------------------------------------------------------------- tools

function pickaxe(head: MetalLayer) {
  const parts = [box(0.055, 0.78, 0.055, 'planks', { y: 0.32 }, 0xd8b890), box(0.07, 0.12, 0.07, 'cloth', { y: 0.02 }, 0x6a4a3a)];
  // Curved pick: segments following an arc, tapering to points.
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs * 2 - 1; // -1..1
    const x = t * 0.3, y = 0.7 - Math.abs(t) ** 1.8 * 0.13;
    const thick = 0.085 * (1 - Math.abs(t) * 0.6);
    parts.push(box(0.12, thick, thick, head, { x, y, rz: -t * 0.5 }));
  }
  parts.push(box(0.1, 0.12, 0.1, head, { y: 0.7 }));
  return merge(parts);
}

function axe(head: MetalLayer) {
  const parts = [box(0.055, 0.75, 0.055, 'planks', { y: 0.31 }, 0xd8b890), box(0.07, 0.12, 0.07, 'cloth', { y: 0.02 }, 0x6a4a3a)];
  // Blade: tapered wedge flaring outwards.
  const g = new THREE.BoxGeometry(0.26, 0.2, 0.04);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    if (x > 0) p.setY(i, p.getY(i) * 1.7);
    if (x > 0) p.setZ(i, p.getZ(i) * 0.3);
  }
  parts.push(part(place(g, { x: 0.13, y: 0.62 }), head));
  parts.push(box(0.09, 0.14, 0.09, head, { y: 0.62 }));
  parts.push(box(0.08, 0.06, 0.05, head, { x: -0.07, y: 0.62 }));
  return merge(parts);
}

function sword(head: MetalLayer) {
  const wooden = head === 'planks';
  const blade = new THREE.CylinderGeometry(0.045, 0.06, 0.78, 4);
  blade.rotateY(Math.PI / 4);
  blade.scale(1, 1, 0.35);
  const parts = [
    part(place(blade, { y: 0.52 }), head, wooden ? 0xe0c090 : 0xffffff),
    cone(0.06, 0.12, 4, head, { y: 0.97, ry: Math.PI / 4 }, wooden ? 0xe0c090 : 0xffffff),
    box(0.3, 0.05, 0.07, wooden ? 'planks' : 'gold', { y: 0.12 }),
    box(0.05, 0.2, 0.05, 'cloth', { y: 0.0 }, 0x4a3a50),
    octa(0.05, wooden ? 'planks' : 'gold', { y: -0.12 }),
  ];
  return merge(parts);
}

function bow(head: MetalLayer) {
  const parts: THREE.BufferGeometry[] = [];
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const a0 = -0.9 + (i / segs) * 1.8, a1 = -0.9 + ((i + 1) / segs) * 1.8;
    const r = 0.5;
    const x0 = Math.cos(a0) * r - r, y0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r - r, y1 = Math.sin(a1) * r;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const thick = 0.05 * (1 - Math.abs((i + 0.5) / segs - 0.5) * 0.8);
    parts.push(box(thick, len + 0.01, thick, head === 'planks' ? 'planks' : head, { x: (x0 + x1) / 2 + 0.2, y: (y0 + y1) / 2 + 0.3, rz: Math.atan2(x1 - x0, y1 - y0) * -1 }, 0xd8b890));
  }
  parts.push(box(0.008, 0.78, 0.008, 'plain', { x: -0.11, y: 0.3 }, 0xf4ecd8));
  parts.push(box(0.07, 0.14, 0.07, 'cloth', { x: 0.2, y: 0.3 }, 0x6a4a3a));
  return merge(parts);
}

function staff(head: MetalLayer) {
  return merge([
    cyl(0.03, 0.035, 1.1, 6, 'planks', { y: 0.35 }, 0xb08860),
    box(0.1, 0.05, 0.1, 'gold', { y: 0.9 }),
    octa(0.12, head, { y: 1.05, sy: 1.6 }),
    octa(0.05, head, { x: 0.08, y: 0.95, sy: 1.5, rz: -0.5 }),
    octa(0.05, head, { x: -0.08, y: 0.97, sy: 1.5, rz: 0.5 }),
  ]);
}

function hook(head: MetalLayer) {
  const parts = [cyl(0.03, 0.03, 0.3, 6, head, { y: 0.15 })];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(box(0.03, 0.18, 0.03, head, { x: Math.cos(a) * 0.07, y: 0.33, z: Math.sin(a) * 0.07, rz: Math.cos(a) * 0.6, rx: -Math.sin(a) * 0.6 }));
  }
  for (let i = 0; i < 4; i++) parts.push(box(0.05, 0.07, 0.02, 'metal', { y: -0.05 - i * 0.08, ry: i * Math.PI / 2 }));
  return merge(parts);
}

// ---------------------------------------------------------------- materials

function ore(layer: string) {
  return merge([
    ico(0.14, 'stone', { detail: 0, jitter: 0.5, seed: 3, sy: 0.8 }),
    ico(0.05, layer, { x: 0.08, y: 0.06, z: 0.06, jitter: 0.4, seed: 5 }),
    ico(0.045, layer, { x: -0.07, y: 0.05, z: 0.08, jitter: 0.4, seed: 6 }),
    ico(0.04, layer, { x: 0.02, y: 0.1, z: -0.07, jitter: 0.4, seed: 8 }),
  ]);
}

function bar(layer: string) {
  return merge([taper(0.3, 0.1, 0.14, 0.8, 0.72, layer, { y: 0.05 })]);
}

function crystal(layer: string) {
  return merge([
    octa(0.07, layer, { y: 0.16, sy: 2.4 }),
    octa(0.05, layer, { x: 0.07, y: 0.1, sy: 2.2, rz: -0.5 }),
    octa(0.045, layer, { x: -0.06, y: 0.09, z: 0.03, sy: 2.2, rz: 0.6 }),
    ico(0.07, 'stone', { y: 0.02, sy: 0.5, jitter: 0.4, seed: 2 }),
  ]);
}

function block(layer: string) {
  return merge([box(0.26, 0.26, 0.26, layer, { y: 0.13 })]);
}

function log() {
  return merge([
    cyl(0.1, 0.1, 0.42, 7, 'bark', { y: 0.1, rz: Math.PI / 2 }),
    cyl(0.085, 0.085, 0.43, 7, 'planks', { y: 0.1, rz: Math.PI / 2 }, 0xe8c898),
  ]);
}

function gel() {
  return merge([ico(0.13, 'gel', { y: 0.08, sy: 0.65, detail: 1, jitter: 0.12, seed: 4 }), ico(0.03, 'plain', { x: 0.05, y: 0.13, z: 0.05 }, 0xe0fff0)]);
}

function arrow() {
  return merge([
    box(0.02, 0.6, 0.02, 'planks', { y: 0.3 }, 0xe0c090),
    cone(0.035, 0.09, 4, 'stone', { y: 0.64 }),
    box(0.005, 0.12, 0.06, 'cloth', { y: 0.05 }, 0xf0f0f0),
    box(0.06, 0.12, 0.005, 'cloth', { y: 0.05 }, 0xf0f0f0),
  ]);
}

function bomb() {
  return merge([
    ico(0.14, 'metal', { y: 0.14, detail: 1 }, 0x6a6878),
    cyl(0.04, 0.04, 0.05, 6, 'metal', { y: 0.28 }),
    box(0.015, 0.1, 0.015, 'cloth', { y: 0.34, rz: 0.3 }, 0xd0c090),
    octa(0.025, 'flame', { x: 0.02, y: 0.4 }),
  ]);
}

function bottle(liquid: string | null) {
  const parts = [
    cyl(0.08, 0.09, 0.16, 7, 'glass', { y: 0.08 }),
    cyl(0.03, 0.05, 0.08, 7, 'glass', { y: 0.2 }),
    cyl(0.035, 0.035, 0.04, 7, 'planks', { y: 0.25 }, 0xc09060),
  ];
  if (liquid) parts.push(cyl(0.075, 0.085, 0.11, 7, liquid, { y: 0.065 }));
  return merge(parts);
}

function mushroom() {
  return merge([
    cyl(0.035, 0.045, 0.14, 6, 'plain', { y: 0.07 }, 0xf0e8d8),
    part(place(new THREE.SphereGeometry(0.11, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), { y: 0.12 }), 'red'),
    ico(0.02, 'plain', { x: 0.05, y: 0.19, z: 0.03 }, 0xffffff),
    ico(0.018, 'plain', { x: -0.04, y: 0.2, z: -0.03 }, 0xffffff),
  ]);
}

function coin() {
  return merge([cyl(0.09, 0.09, 0.025, 10, 'gold', { y: 0.09, rx: Math.PI / 2 })]);
}

function wing() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) parts.push(taper(0.1, 0.02, 0.28 - i * 0.06, 0.2, 1, 'fur', { x: 0.08 * i - 0.08, y: 0.06, z: 0.02 * i, rz: -0.5 + i * 0.3, rx: 0.2 }, 0xb0a0b8));
  parts.push(box(0.26, 0.02, 0.02, 'fur', { y: 0.12 }));
  return merge(parts);
}

// ------------------------------------------------------------ armour, trinkets

function armor(slot: 'head' | 'body' | 'legs', layer: MetalLayer) {
  if (slot === 'head') {
    return merge([
      part(place(new THREE.SphereGeometry(0.17, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), { y: 0.1 }), layer),
      cyl(0.18, 0.18, 0.08, 8, layer, { y: 0.07 }),
      box(0.04, 0.16, 0.05, layer, { y: 0.18, z: 0.15 }),
      box(0.24, 0.035, 0.05, 'metal', { y: 0.06, z: 0.15 }),
    ]);
  }
  if (slot === 'body') {
    return merge([
      taper(0.36, 0.34, 0.2, 1.12, 1, layer, { y: 0.17 }),
      box(0.14, 0.08, 0.2, layer, { x: 0.22, y: 0.32 }),
      box(0.14, 0.08, 0.2, layer, { x: -0.22, y: 0.32 }),
      box(0.3, 0.04, 0.21, 'metal', { y: 0.06 }),
    ]);
  }
  return merge([
    taper(0.12, 0.34, 0.14, 1.2, 1, layer, { x: 0.08, y: 0.17 }),
    taper(0.12, 0.34, 0.14, 1.2, 1, layer, { x: -0.08, y: 0.17 }),
    box(0.3, 0.06, 0.16, 'metal', { y: 0.35 }),
  ]);
}

function boots(layer: string) {
  const one = (x: number) => [box(0.1, 0.18, 0.12, layer, { x, y: 0.09 }), box(0.1, 0.06, 0.2, layer, { x, y: 0.03, z: 0.04 }), box(0.11, 0.03, 0.13, 'gold', { x, y: 0.16 })];
  return merge([...one(0.07), ...one(-0.07), octa(0.04, 'plain', { x: 0.13, y: 0.14, z: -0.02, sy: 2, rz: 0.8 }, 0xffffff)]);
}

function jar(layer: string) {
  return merge([
    cyl(0.1, 0.09, 0.2, 8, layer, { y: 0.1 }),
    cyl(0.06, 0.1, 0.05, 8, layer, { y: 0.225 }),
    cyl(0.065, 0.065, 0.05, 8, 'planks', { y: 0.27 }, 0xc09060),
    ico(0.05, 'plain', { y: 0.1, sy: 1.6 }, 0xe8f8ff),
  ]);
}

function charm(layer: string) {
  return merge([
    box(0.012, 0.16, 0.012, 'cloth', { y: 0.22 }, 0x6a4a3a),
    octa(0.07, layer, { y: 0.1, sy: 1.5 }),
    box(0.04, 0.2, 0.012, layer, { x: 0.05, y: 0.08, rz: -0.4 }),
  ]);
}

function band(layer: string) {
  const t = new THREE.TorusGeometry(0.09, 0.025, 5, 10);
  return merge([part(place(t, { y: 0.09 }), layer), octa(0.035, 'lumiteMetal', { y: 0.18 })]);
}

// ---------------------------------------------------------------- furniture

function legs(w: number, d: number, h: number, t = 0.08, inset = 0.06) {
  const out: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    out.push(box(t, h, t, 'planks', { x: sx * (w / 2 - inset), y: h / 2, z: sz * (d / 2 - inset) }, 0xd8b890));
  return out;
}

function furniture(id: FurnitureId): THREE.BufferGeometry {
  switch (id) {
    case 'workbench':
      return merge([
        box(1.6, 0.12, 0.8, 'planks', { y: 0.84 }),
        ...legs(1.6, 0.8, 0.78, 0.1),
        box(1.4, 0.06, 0.6, 'planks', { y: 0.25 }, 0xc8a070),
        // Saw and hammer lying on top.
        box(0.42, 0.012, 0.12, 'iron', { x: -0.35, y: 0.906, z: 0.1, ry: 0.3 }),
        box(0.14, 0.04, 0.05, 'planks', { x: -0.62, y: 0.92, z: 0.18, ry: 0.3 }, 0x8a5a3a),
        box(0.035, 0.035, 0.3, 'planks', { x: 0.35, y: 0.92, z: 0.0, ry: -0.5 }, 0xd8b890),
        box(0.13, 0.07, 0.07, 'metal', { x: 0.43, y: 0.935, z: -0.13, ry: -0.5 }),
      ]);
    case 'furnace': {
      const parts = [
        taper(1.2, 1.05, 1.1, 0.85, 0.85, 'bricks', { y: 0.525 }, 0xd8d0d0),
        taper(1.03, 0.28, 0.95, 0.6, 0.6, 'bricks', { y: 1.19 }, 0xc8c0c0),
        cyl(0.16, 0.19, 0.4, 6, 'bricks', { y: 1.45 }, 0x9a9090),
        // Mouth: dark recess with glowing coals and flames.
        box(0.6, 0.45, 0.2, 'metal', { y: 0.42, z: 0.47 }, 0x301818),
        box(0.66, 0.06, 0.24, 'metal', { y: 0.68, z: 0.5 }),
        box(0.52, 0.1, 0.1, 'flame', { y: 0.24, z: 0.5 }, 0xff9050),
        octa(0.11, 'flame', { x: -0.12, y: 0.4, z: 0.5, sy: 1.8 }),
        octa(0.13, 'flame', { x: 0.08, y: 0.42, z: 0.48, sy: 1.9 }),
        octa(0.08, 'flame', { x: 0.2, y: 0.36, z: 0.52, sy: 1.6 }),
      ];
      return merge(parts);
    }
    case 'anvil':
      return merge([
        cyl(0.22, 0.26, 0.42, 7, 'bark', { y: 0.21 }),
        cyl(0.2, 0.2, 0.43, 7, 'planks', { y: 0.215 }, 0xe0c098),
        taper(0.3, 0.16, 0.24, 1.6, 1.2, 'metal', { y: 0.5 }),
        box(0.62, 0.14, 0.3, 'metal', { y: 0.65 }),
        cone(0.1, 0.34, 5, 'metal', { x: 0.45, y: 0.66, rz: -Math.PI / 2 }),
        box(0.12, 0.1, 0.26, 'metal', { x: -0.34, y: 0.64 }),
        box(0.6, 0.02, 0.28, 'iron', { y: 0.73 }),
      ]);
    case 'forge': {
      const parts = [
        taper(1.6, 0.8, 1.2, 0.9, 0.9, 'bricks', { y: 0.4 }, 0xb8b8d0),
        box(1.3, 0.14, 1.0, 'iron', { y: 0.86 }),
        box(0.9, 0.1, 0.7, 'metal', { y: 0.97 }, 0x404058),
      ];
      const rand = mulberry32(11);
      for (let i = 0; i < 7; i++) {
        const a = rand() * Math.PI * 2, r = rand() * 0.25;
        parts.push(octa(0.08 + rand() * 0.06, 'lumiteMetal', { x: Math.cos(a) * r, y: 1.2 + rand() * 0.2, z: Math.sin(a) * r, sy: 3, rz: (rand() - 0.5) * 0.6, rx: (rand() - 0.5) * 0.6 }));
      }
      for (const sx of [-1, 1]) parts.push(box(0.1, 0.9, 0.1, 'iron', { x: sx * 0.72, y: 0.45, z: 0.55 }));
      return merge(parts);
    }
    case 'chair':
      return merge([
        box(0.56, 0.07, 0.56, 'planks', { y: 0.5 }),
        ...legs(0.56, 0.56, 0.5, 0.07, 0.05),
        box(0.07, 0.6, 0.07, 'planks', { x: -0.23, y: 0.82, z: -0.24 }, 0xd8b890),
        box(0.07, 0.6, 0.07, 'planks', { x: 0.23, y: 0.82, z: -0.24 }, 0xd8b890),
        box(0.5, 0.1, 0.05, 'planks', { y: 1.05, z: -0.24 }),
        box(0.5, 0.08, 0.05, 'planks', { y: 0.8, z: -0.24 }),
      ]);
    case 'table':
      return merge([
        box(1.6, 0.1, 1.0, 'planks', { y: 0.8 }),
        box(1.44, 0.12, 0.84, 'planks', { y: 0.7 }, 0xc8a070),
        ...legs(1.6, 1.0, 0.75, 0.1, 0.12),
      ]);
    case 'door':
      // The leaf only, hinge on local x = 0 (the renderer pivots it there).
      return merge([
        box(1.2, 2.28, 0.1, 'planks', { x: 0.6, y: 1.14 }),
        box(1.2, 0.1, 0.12, 'metal', { x: 0.6, y: 1.85 }),
        box(1.2, 0.1, 0.12, 'metal', { x: 0.6, y: 0.42 }),
        box(0.06, 0.16, 0.16, 'gold', { x: 1.02, y: 1.08 }),
        box(0.14, 0.24, 0.06, 'metal', { x: 0.6, y: 1.5, z: 0.06 }, 0x2a2830),
      ]);
    case 'torch':
      return merge([
        box(0.06, 0.46, 0.06, 'planks', { y: 0.23 }, 0x9a6a40),
        box(0.1, 0.1, 0.1, 'cloth', { y: 0.46 }, 0x4a3a30),
        octa(0.075, 'flame', { y: 0.57, sy: 1.7 }),
        octa(0.04, 'flame', { y: 0.6, sy: 1.6 }, 0xfff0c0),
      ]);
    case 'chest':
      return merge([
        box(1.0, 0.5, 0.7, 'planks', { y: 0.25 }),
        box(1.02, 0.22, 0.72, 'planks', { y: 0.62 }, 0xd0a878),
        taper(1.02, 0.08, 0.72, 1, 0.7, 'planks', { y: 0.77 }, 0xd0a878),
        box(0.08, 0.84, 0.74, 'gold', { x: -0.36, y: 0.4 }),
        box(0.08, 0.84, 0.74, 'gold', { x: 0.36, y: 0.4 }),
        box(0.14, 0.16, 0.06, 'gold', { y: 0.5, z: 0.37 }),
        box(0.05, 0.06, 0.03, 'metal', { y: 0.46, z: 0.4 }, 0x202020),
      ]);
    case 'bed':
      return merge([
        box(1.2, 0.25, 2.2, 'planks', { y: 0.2 }),
        box(1.1, 0.16, 2.0, 'cloth', { y: 0.4 }),
        box(0.9, 0.12, 0.4, 'plain', { y: 0.53, z: -0.75 }, 0xf0ece0),
        box(1.2, 0.8, 0.12, 'planks', { y: 0.4, z: -1.06 }),
        box(1.2, 0.5, 0.12, 'planks', { y: 0.25, z: 1.06 }),
        ...legs(1.2, 2.2, 0.12, 0.12, 0.08),
      ]);
  }
}

/** Static frame around a door leaf, filling a 2 m x 2.5 m wall slot. */
export function doorFrame(): THREE.BufferGeometry {
  return merge([
    box(0.4, 2.5, 0.2, 'planks', { x: -0.8, y: 1.25 }, 0xc8a070),
    box(0.4, 2.5, 0.2, 'planks', { x: 0.8, y: 1.25 }, 0xc8a070),
    box(1.2, 0.2, 0.2, 'planks', { y: 2.4 }, 0xb89060),
    box(0.1, 2.3, 0.24, 'planks', { x: -0.62, y: 1.15 }, 0x8a5a3a),
    box(0.1, 2.3, 0.24, 'planks', { x: 0.62, y: 1.15 }, 0x8a5a3a),
  ]);
}

// ---------------------------------------------------------------- registry

const cache = new Map<string, THREE.BufferGeometry>();

export function modelFor(spec: ModelSpec): THREE.BufferGeometry {
  const key = JSON.stringify(spec);
  const hit = cache.get(key);
  if (hit) return hit;
  let g: THREE.BufferGeometry;
  switch (spec.type) {
    case 'pickaxe': g = pickaxe(spec.head); break;
    case 'axe': g = axe(spec.head); break;
    case 'sword': g = sword(spec.head); break;
    case 'bow': g = bow(spec.head); break;
    case 'staff': g = staff(spec.head); break;
    case 'hook': g = hook(spec.head); break;
    case 'ore': g = ore(spec.layer); break;
    case 'bar': g = bar(spec.layer); break;
    case 'crystal': g = crystal(spec.layer); break;
    case 'nugget': g = ore(spec.layer); break;
    case 'block': g = block(spec.layer); break;
    case 'log': g = log(); break;
    case 'gel': g = gel(); break;
    case 'arrow': g = arrow(); break;
    case 'bomb': g = bomb(); break;
    case 'potion': g = bottle('red'); break;
    case 'bottle': g = bottle(null); break;
    case 'mushroom': g = mushroom(); break;
    case 'coin': g = coin(); break;
    case 'wing': g = wing(); break;
    case 'armor': g = armor(spec.slot, spec.layer); break;
    case 'boots': g = boots(spec.layer); break;
    case 'jar': g = jar(spec.layer); break;
    case 'charm': g = charm(spec.layer); break;
    case 'band': g = band(spec.layer); break;
    case 'furniture': g = furniture(spec.id); break;
  }
  cache.set(key, g);
  return g;
}

export function itemModel(def: ItemDef) { return modelFor(def.model); }
export function furnitureModel(id: FurnitureId) { return modelFor({ type: 'furniture', id }); }

/** Building blocks for other model modules (creatures, NPCs). */
export const parts = { box, cyl, ico, octa, cone, taper, merge };
