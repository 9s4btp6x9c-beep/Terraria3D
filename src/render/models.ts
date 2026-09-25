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
  sandstone: Mat.Sandstone, ice: Mat.Ice, blightstone: Mat.Riftstone, moss: Mat.Moss, rootwood: Mat.Rootwood, salt: Mat.Salt, fossil: Mat.Fossil, leaflitter: Mat.Leaflitter, basalt: Mat.Basalt, ash: Mat.Ash, obsidian: Mat.Obsidian, magmarock: Mat.Magmarock, emberstone: Mat.Emberstone, emberite: Mat.Emberite, aerite: Mat.Aerite, mud: Mat.Mud, mushgrass: Mat.Mushgrass,
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

/**
 * A broad, flat blade (extruded outline with bevelled edges and a darker
 * fuller down the middle), a wide crossguard, a wrapped grip and a pommel.
 */
function sword(head: MetalLayer) {
  const wooden = head === 'planks';
  const tint = wooden ? 0xe0c090 : 0xffffff;
  const w = wooden ? 0.075 : 0.07, len = 0.66;
  const outline = new THREE.Shape();
  outline.moveTo(-w, 0);
  outline.lineTo(-w, len);
  outline.lineTo(0, len + 0.16);
  outline.lineTo(w, len);
  outline.lineTo(w, 0);
  outline.closePath();
  const blade = new THREE.ExtrudeGeometry(outline, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 1 });
  blade.translate(0, 0.16, -0.006);
  const parts = [
    part(blade, head, tint),
    // Fuller: a darker groove running most of the blade's length.
    box(0.026, len * 0.72, 0.04, head, { y: 0.16 + len * 0.42 }, wooden ? 0xa07850 : 0x9a9aa8),
    // Crossguard with flared tips.
    box(0.34, 0.055, 0.08, wooden ? 'planks' : 'gold', { y: 0.13 }),
    box(0.05, 0.09, 0.09, wooden ? 'planks' : 'gold', { x: 0.17, y: 0.14 }),
    box(0.05, 0.09, 0.09, wooden ? 'planks' : 'gold', { x: -0.17, y: 0.14 }),
    box(0.05, 0.2, 0.05, 'cloth', { y: 0.0 }, 0x4a3a50),
    octa(0.05, wooden ? 'planks' : 'gold', { y: -0.13 }),
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

/** A curved war horn: tapering bone segments bound with iron bands. */
function horn() {
  const parts: THREE.BufferGeometry[] = [];
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const a = t * 1.9;
    const r = 0.075 * (1 - t * 0.75) + 0.012;
    const x = Math.sin(a) * 0.22 - 0.1, y = 0.08 + (1 - Math.cos(a)) * 0.2 + t * 0.06;
    parts.push(cyl(r * 0.85, r, 0.075, 7, 'bone', { x, y, rz: -a }));
  }
  // Bell, mouthpiece and bands.
  parts.push(cyl(0.1, 0.07, 0.06, 8, 'bone', { x: -0.1, y: 0.05 }, 0xfff0d8));
  parts.push(cyl(0.065, 0.065, 0.02, 8, 'metal', { x: -0.1, y: 0.02 }, 0x1a1418));
  parts.push(cyl(0.083, 0.083, 0.025, 8, 'iron', { x: -0.07, y: 0.13, rz: -0.35 }));
  parts.push(cyl(0.05, 0.05, 0.025, 8, 'iron', { x: 0.1, y: 0.33, rz: -1.3 }));
  parts.push(cyl(0.014, 0.018, 0.05, 6, 'gold', { x: 0.16, y: 0.4, rz: -1.8 }));
  parts.push(box(0.012, 0.12, 0.012, 'cloth', { x: 0.02, y: 0.19, rz: 0.4 }, 0x6a3a2a));
  return merge(parts);
}

/** A brute's club: a thick femur studded with iron. */
/** Magma Maul: a basalt block with glowing cracks on a charred haft. */
function club() {
  return merge([
    box(0.07, 0.32, 0.07, 'cloth', { y: 0.06 }, 0x3a2420),
    cyl(0.05, 0.045, 0.7, 6, 'bark', { y: 0.45 }, 0x4a3a34),
    box(0.26, 0.2, 0.2, 'basalt', { y: 0.88 }),
    box(0.2, 0.26, 0.16, 'basalt', { y: 0.88, ry: 0.3 }),
    box(0.28, 0.03, 0.21, 'flame', { y: 0.84 }, 0xff7a2a),
    box(0.03, 0.22, 0.21, 'flame', { x: 0.06, y: 0.88 }, 0xff9a3a),
    octa(0.05, 'basalt', { y: -0.13 }),
    cyl(0.07, 0.07, 0.04, 7, 'iron', { y: 0.74 }),
  ]);
}

/** A curved fang on a cord. */
function fang() {
  const parts = [box(0.012, 0.18, 0.012, 'cloth', { y: 0.24 }, 0x5a2a24), box(0.06, 0.03, 0.03, 'gold', { y: 0.155 })];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    parts.push(cone(0.035 * (1 - t * 0.6) + 0.008, 0.06, 5, 'bone', { x: t * t * 0.05, y: 0.12 - t * 0.055, rz: 0.2 + t * 0.6, rx: Math.PI }, 0xfff8e8));
  }
  parts.push(octa(0.02, 'bloodMetal', { y: 0.16, z: 0.02 }));
  return merge(parts);
}

/** A single flight feather: quill plus a tapered vane. */
function feather(layer: string, tint = 0xffffff, spine = 0xd8d0c0) {
  return merge([
    box(0.012, 0.36, 0.012, 'plain', { y: 0.16 }, spine),
    taper(0.1, 0.26, 0.012, 0.25, 1, layer, { x: 0.02, y: 0.2, rz: -0.05 }, tint),
    taper(0.06, 0.1, 0.012, 1, 1, layer, { x: 0.012, y: 0.02, rz: 0.1 }, tint),
  ]);
}

/** A storm-gold Roc plume with a crackling tip. */
function plume() {
  return merge([
    box(0.014, 0.42, 0.014, 'gold', { y: 0.18 }),
    taper(0.14, 0.3, 0.014, 0.2, 1, 'feather', { x: 0.03, y: 0.22, rz: -0.08 }, 0xf8e8b0),
    taper(0.08, 0.1, 0.014, 1, 1, 'feather', { x: 0.015, y: 0.03 }, 0x8a9ac0),
    octa(0.03, 'lumiteMetal', { x: 0.03, y: 0.4 }),
  ]);
}

/** Red crystal cluster: shards of crystallised life growing from a rock (the renderer spins the core). */
export function lifeCrystalBase() {
  return merge([
    ico(0.3, 'stone', { y: 0.08, sy: 0.5, jitter: 0.35, seed: 41 }),
    ico(0.15, 'stone', { x: 0.26, y: 0.06, jitter: 0.4, seed: 42 }),
    ico(0.13, 'stone', { x: -0.22, y: 0.07, z: 0.12, jitter: 0.4, seed: 43 }),
    octa(0.07, 'heart', { x: 0.2, y: 0.24, z: -0.08, sy: 2.4, rz: -0.35 }),
    octa(0.06, 'heart', { x: -0.2, y: 0.21, z: 0.1, sy: 2.2, rz: 0.45 }),
    octa(0.05, 'heart', { x: 0.02, y: 0.2, z: 0.22, sy: 2.2, rx: 0.4 }),
  ]);
}

/** The large essence crystal that floats and turns above the cluster. */
export function lifeCrystalHeart() {
  return merge(essenceCrystal('heart', 1, 0.62));
}

/** A faceted, double-pointed crystal with two small companions. */
function essenceCrystal(layer: string, s: number, y: number) {
  return [
    octa(0.16 * s, layer, { y, sy: 1.9 }),
    octa(0.06 * s, layer, { x: 0.16 * s, y: y - 0.12 * s, sy: 1.8, rz: -0.4 }),
    octa(0.05 * s, layer, { x: -0.15 * s, y: y - 0.1 * s, sy: 1.8, rz: 0.4 }),
    octa(0.035 * s, 'plain', { x: -0.05 * s, y: y + 0.12 * s, z: 0.08 * s }, 0xffffff),
  ];
}

/** A round-bellied elixir flask. */
function flask(liquid: string) {
  const belly = new THREE.SphereGeometry(0.1, 8, 6);
  const fill = new THREE.SphereGeometry(0.088, 8, 6, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65);
  return merge([
    part(place(belly, { y: 0.1 }), 'glass'),
    part(place(fill, { y: 0.1 }), liquid),
    cyl(0.03, 0.04, 0.09, 7, 'glass', { y: 0.22 }),
    cyl(0.038, 0.034, 0.045, 7, 'planks', { y: 0.285 }, 0xc09060),
    octa(0.025, 'plain', { x: -0.05, y: 0.15, z: 0.06 }, 0xffffff),
  ]);
}

/** Amber: a drop of hardened resin with a spark caught inside. */
function amberDrop() {
  const g = new THREE.SphereGeometry(0.1, 7, 5).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * (1 - p.getY(i) * 6), p.getY(i) * 1.8, p.getZ(i) * (1 - p.getY(i) * 6));
  return merge([part(place(g, { y: 0.1 }), 'amber'), octa(0.025, 'flame', { x: 0.01, y: 0.09, z: 0.03 }, 0xfff4b0), octa(0.05, 'amber', { x: 0.08, y: 0.04, rz: 0.6 }, 0xffd080)]);
}

/** Starseed: a glowing seed trailing a crown of fine, radiant filaments. */
function starseed() {
  const parts = [octa(0.05, 'flame', { y: 0.12, sy: 1.6 }, 0xe0f4ff), cyl(0.008, 0.012, 0.14, 4, 'plain', { y: 0.22 }, 0xd8ecff)];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, tilt = 0.9;
    const g = new THREE.CylinderGeometry(0.004, 0.004, 0.16, 3).translate(0, 0.08, 0);
    g.rotateZ(Math.cos(a) * tilt); g.rotateX(Math.sin(a) * tilt);
    parts.push(part(place(g, { y: 0.29 }), 'plain', 0xf0f8ff));
    const tip = Math.sin(tilt) * 0.16;
    parts.push(octa(0.014, 'glim', { x: -Math.cos(a) * tip, y: 0.29 + Math.cos(tilt) * 0.16, z: Math.sin(a) * tip }));
  }
  return merge(parts);
}

/** A carved stone post with rings of lumite and a staring eye. */
function totem() {
  return merge([
    taper(0.16, 0.36, 0.16, 0.7, 0.7, 'deepstone', { y: 0.18 }),
    cyl(0.1, 0.1, 0.04, 6, 'lumiteMetal', { y: 0.12 }),
    cyl(0.085, 0.085, 0.04, 6, 'lumiteMetal', { y: 0.28 }),
    box(0.08, 0.05, 0.03, 'flame', { y: 0.21, z: 0.075 }, 0x9af0ff),
    cone(0.07, 0.14, 4, 'deepstone', { y: 0.43, ry: Math.PI / 4 }),
    cone(0.06, 0.12, 4, 'deepstone', { y: -0.05, rx: Math.PI, ry: Math.PI / 4 }),
  ]);
}

/** Builder's Hammer: a squat iron head (claw on one side) on a wrapped haft. */
function hammer() {
  return merge([
    box(0.055, 0.66, 0.055, 'planks', { y: 0.28 }, 0xd8b890),
    box(0.07, 0.12, 0.07, 'cloth', { y: 0.02 }, 0x6a4a3a),
    box(0.07, 0.08, 0.07, 'cloth', { y: 0.46 }, 0x6a4a3a),
    box(0.16, 0.13, 0.13, 'iron', { x: 0.07, y: 0.62 }),
    box(0.06, 0.15, 0.15, 'iron', { x: 0.16, y: 0.62 }, 0xe8e2dc),
    ...[-0.03, 0.03].map(z => taper(0.16, 0.05, 0.035, 1, 1, 'iron', { x: -0.08, y: 0.66, z, rz: 0.5 })),
    box(0.1, 0.1, 0.1, 'iron', { x: -0.02, y: 0.62 }),
  ]);
}

/** Bramble Maul: a gnarled petrified root with a mossy, knotted head. */
function maul() {
  return merge([
    cyl(0.03, 0.04, 0.7, 5, 'rootbark', { y: 0.33, rz: 0.04 }),
    box(0.07, 0.12, 0.07, 'cloth', { y: 0.04 }, 0x5a3a2a),
    ico(0.16, 'rootbark', { y: 0.74, sy: 1.2, jitter: 0.35, seed: 61 }),
    ico(0.1, 'mossleaves', { x: 0.06, y: 0.84, z: 0.04, sy: 0.6, jitter: 0.3, seed: 62 }),
    ...[0, 1, 2, 3].map(k => cone(0.03, 0.12, 4, 'bone', { x: Math.cos(k * 1.6) * 0.14, y: 0.72 + (k % 2) * 0.1, z: Math.sin(k * 1.6) * 0.14, rz: -Math.cos(k * 1.6) * 1.4, rx: Math.sin(k * 1.6) * 1.4 }, 0xe8dcc0)),
  ]);
}


/** A glowing blue mushroom (item icon). */
function glowcapItem() {
  return merge([
    cyl(0.03, 0.045, 0.16, 6, 'mushstem', { y: 0.08 }),
    part(place(new THREE.SphereGeometry(0.12, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), { y: 0.14 }), 'glowcap'),
    cyl(0.115, 0.1, 0.02, 7, 'mushstem', { y: 0.14 }, 0x9ab8d0),
    ico(0.022, 'plain', { x: 0.05, y: 0.23, z: 0.04 }, 0xe0fcff),
    ico(0.018, 'plain', { x: -0.05, y: 0.22, z: -0.03 }, 0xe0fcff),
  ]);
}

/** An iron bucket, optionally full. */
function bucket(full: boolean) {
  const parts = [
    cyl(0.13, 0.1, 0.24, 9, 'iron', { y: 0.12 }),
    cyl(0.135, 0.135, 0.025, 9, 'metal', { y: 0.235 }),
    cyl(0.105, 0.105, 0.02, 9, 'metal', { y: 0.06 }),
    part(place(new THREE.TorusGeometry(0.13, 0.01, 4, 10, Math.PI), { y: 0.24 }), 'metal'),
  ];
  if (full) parts.push(cyl(0.12, 0.12, 0.02, 9, 'glass', { y: 0.22 }, 0x6aaaf0));
  return merge(parts);
}

/** Folded wings for the item icon: two layered feather fans on a harness. */
function wings() {
  const parts: THREE.BufferGeometry[] = [box(0.14, 0.1, 0.06, 'cloth', { y: 0.2 }, 0x6a4a3a), box(0.05, 0.05, 0.05, 'gold', { y: 0.2, z: 0.04 })];
  for (const side of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      parts.push(taper(0.08, 0.3 - t * 0.06, 0.02, 0.4, 1, 'feather', { x: side * (0.1 + t * 0.12), y: 0.22 + t * 0.03, z: -0.01 * i, rz: side * (-0.6 - t * 0.35) }, t > 0.6 ? 0x9aa8c8 : 0xffffff));
    }
  }
  return merge(parts);
}

/** Gale Idol: a small aerite bird effigy on a stone plinth. */
function idol() {
  return merge([
    cyl(0.1, 0.12, 0.08, 6, 'stone', { y: 0.04 }),
    cyl(0.04, 0.05, 0.1, 6, 'aeriteMetal', { y: 0.13 }),
    ico(0.07, 'aeriteMetal', { y: 0.23, sz: 1.3 }),
    cone(0.03, 0.08, 4, 'gold', { y: 0.25, z: 0.1, rx: Math.PI / 2 }),
    taper(0.16, 0.02, 0.06, 0.3, 1, 'feather', { x: 0.1, y: 0.28, rz: -0.5 }),
    taper(0.16, 0.02, 0.06, 0.3, 1, 'feather', { x: -0.1, y: 0.28, rz: 0.5 }),
    octa(0.025, 'flame', { x: 0.03, y: 0.25, z: 0.06 }, 0x9af0ff),
  ]);
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
    case 'glowcap_lamp':
      // A glowcap under a glass shade on a wooden post.
      return merge([
        cyl(0.2, 0.24, 0.08, 7, 'planks', { y: 0.04 }, 0xc8a070),
        cyl(0.045, 0.05, 0.9, 6, 'planks', { y: 0.5 }, 0xb08860),
        cyl(0.03, 0.04, 0.16, 6, 'mushstem', { y: 1.0 }),
        part(place(new THREE.SphereGeometry(0.16, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), { y: 1.07 }), 'glowcap'),
        cyl(0.22, 0.22, 0.04, 7, 'iron', { y: 0.95 }),
        ...[0, 1, 2, 3].map(i => box(0.025, 0.34, 0.025, 'iron', { x: Math.cos(i * Math.PI / 2 + 0.4) * 0.2, y: 1.12, z: Math.sin(i * Math.PI / 2 + 0.4) * 0.2 })),
        cone(0.26, 0.14, 7, 'iron', { y: 1.35 }),
      ]);
    case 'life_crystal':
      // A red crystal cluster with its essence crystal floating above.
      return merge([lifeCrystalBase(), lifeCrystalHeart()]);
    case 'hearth':
      // A squat fieldstone hearth with a fire in its mouth and a copper hood.
      return merge([
        box(1.4, 0.2, 0.9, 'stone', { y: 0.1 }),
        box(0.28, 0.75, 0.8, 'bricks', { x: -0.56, y: 0.55 }),
        box(0.28, 0.75, 0.8, 'bricks', { x: 0.56, y: 0.55 }),
        box(1.1, 0.75, 0.2, 'bricks', { y: 0.55, z: -0.3 }),
        box(1.4, 0.16, 0.9, 'stone', { y: 1.0 }),
        taper(0.9, 0.3, 0.6, 0.5, 0.5, 'copper', { y: 1.23, z: -0.05 }),
        ...[-0.2, 0, 0.2].map((x, i) => cyl(0.05, 0.06, 0.5, 5, 'bark', { x, y: 0.26, z: 0.08, rz: Math.PI / 2 + 0.2 * (i - 1), ry: 0.5 * (i - 1) })),
        cone(0.22, 0.42, 5, 'flame', { y: 0.47, z: 0.08 }),
        cone(0.12, 0.28, 5, 'flame', { x: 0.14, y: 0.4, z: 0.14 }, 0xffe070),
      ]);
    case 'salt_lamp':
      return merge([
        box(0.3, 0.06, 0.3, 'rootbark', { y: 0.03 }),
        ico(0.2, 'salt', { y: 0.28, sy: 1.4, jitter: 0.25, seed: 71 }),
        octa(0.08, 'flame', { y: 0.3 }, 0xffb090),
      ]);
    case 'amber_lantern':
      return merge([
        box(0.34, 0.05, 0.34, 'rootbark', { y: 0.03 }),
        ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => box(0.04, 0.5, 0.04, 'rootbark', { x: x * 0.14, y: 0.3, z: z * 0.14 })),
        box(0.26, 0.4, 0.26, 'amber', { y: 0.3 }),
        octa(0.07, 'flame', { y: 0.3 }, 0xfff0b0),
        taper(0.38, 0.14, 0.38, 0.3, 0.3, 'rootbark', { y: 0.6 }),
        cyl(0.03, 0.03, 0.12, 5, 'iron', { y: 0.73 }),
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
    case 'sap': g = merge([ico(0.12, 'amber', { y: 0.08, sy: 0.7, detail: 1, jitter: 0.12, seed: 4 }, 0xd8f080), ico(0.03, 'plain', { x: 0.05, y: 0.13, z: 0.05 }, 0xfffff0)]); break;
    case 'amber': g = amberDrop(); break;
    case 'starseed': g = starseed(); break;
    case 'totem': g = totem(); break;
    case 'maul': g = maul(); break;
    case 'hammer': g = hammer(); break;
    case 'red_essence': g = merge(essenceCrystal('heart', 1, 0.2)); break;
    case 'blue_essence': g = merge(essenceCrystal('manaGem', 1, 0.2)); break;
    case 'red_elixir': g = flask('red'); break;
    case 'blue_elixir': g = flask('manaGem'); break;
    case 'arrow': g = arrow(); break;
    case 'bomb': g = bomb(); break;
    case 'potion': g = bottle('red'); break;
    case 'bottle': g = bottle(null); break;
    case 'mushroom': g = mushroom(); break;
    case 'coin': g = coin(); break;
    case 'wing': g = wing(); break;
    case 'scale': g = merge([taper(0.26, 0.04, 0.3, 0.3, 1, 'scale', { y: 0.03, rx: -0.2 }), taper(0.2, 0.04, 0.24, 0.3, 1, 'scale', { y: 0.06, z: -0.05, rx: -0.2 }, 0xd8e8b0)]); break;
    case 'bait': g = merge([ico(0.1, 'red', { y: 0.1, detail: 1, jitter: 0.2, seed: 4 }), ico(0.07, 'gel', { x: 0.08, y: 0.07, jitter: 0.3, seed: 5 }), octa(0.04, 'lumiteMetal', { x: -0.06, y: 0.16 }), box(0.012, 0.15, 0.012, 'cloth', { y: 0.24 }, 0xd0c090)]); break;
    case 'horn': g = horn(); break;
    case 'club': g = club(); break;
    case 'fang': g = fang(); break;
    case 'feather': g = feather('feather'); break;
    case 'plume': g = plume(); break;
    case 'wings': g = wings(); break;
    case 'idol': g = idol(); break;
    case 'glowcap': g = glowcapItem(); break;
    case 'bucket': g = bucket(false); break;
    case 'water_bucket': g = bucket(true); break;
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
export const parts = { box, cyl, ico, octa, cone, taper, merge, part };
