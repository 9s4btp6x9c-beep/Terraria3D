// First-person tool sprites: little pixel-art drawings (16 x 16) of picks,
// axes, hammers, swords and bows, extruded one pixel thick into solid blocky
// shapes, the way block games show a held tool. Much cleaner in the hand than
// the full 3D item models, and every metal tier recolours the same drawing.
//
// Legend: H head, h head shadow/outline, L head highlight, s handle,
// d handle shadow, g grip wrap, p pommel/guard, w bow limb, t bow string.

import * as THREE from 'three';
import type { ItemDef, MetalLayer } from '../items/items';
import { EXTRA_LAYERS, layerOf } from './textures';

const PICKAXE = [
  '....hhhhhhhh....',
  '..hhLLLLLLLLhh..',
  '.hLLHHHHHHHHLLh.',
  'hLHHhhhssdhhhHHh',
  'hHHh...sd...hHHh',
  'hHh....sd....hHh',
  'hh.....sd.....hh',
  'h......sd......h',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......gg.......',
  '.......gg.......',
  '.......gg.......',
  '.......sd.......',
  '.......dd.......',
];

const AXE = [
  '...hhh.sd.......',
  '..hLLHhsd.......',
  '.hLLHHHsdh......',
  'hLLHHHHsdh......',
  'hLHHHHHsdh......',
  'hLHHHHHsdh......',
  '.hLHHHHsd.......',
  '..hhhHhsd.......',
  '.....hhsd.......',
  '.......sd.......',
  '.......sd.......',
  '.......gg.......',
  '.......gg.......',
  '.......gg.......',
  '.......sd.......',
  '.......dd.......',
];

const HAMMER = [
  '..hhhhhhhhhhh...',
  '..hLLLLLLLLLh...',
  '..hHHHHHHHHHh...',
  '..hHHHHHHHHHh...',
  '..hhhhhsdhhhh...',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......gg.......',
  '.......gg.......',
  '.......gg.......',
  '.......sd.......',
  '.......dd.......',
];

const SWORD = [
  '.......LH.......',
  '......hLHh......',
  '......hLHh......',
  '......hLHh......',
  '......hLHh......',
  '......hLHh......',
  '......hLHh......',
  '......hLHh......',
  '......hLHh......',
  '......hLHh......',
  '...pppppppppp...',
  '...pppppppppp...',
  '.......gg.......',
  '.......gg.......',
  '.......gg.......',
  '......pppp......',
];

/** A torch: a stick with a charred tip under a pixel flame (Y/O/R glow). */
const TORCH = [
  '................',
  '........Y.......',
  '.......YYO......',
  '.......YOO......',
  '......OYRO......',
  '.......RRO......',
  '.......cc.......',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......sd.......',
  '.......dd.......',
  '................',
];
/** Sprite characters drawn with the glowing layer. */
const GLOWING = new Set(['Y', 'O', 'R']);

/** A bow: a curved limb on the left, the string straight down the right. */
function bowRows(): string[] {
  const rows: string[][] = Array.from({ length: 16 }, () => Array(16).fill('.'));
  for (let y = 0; y < 16; y++) {
    const x = Math.round(9 - Math.sin(Math.PI * y / 15) * 6);
    rows[y][x] = 'w'; rows[y][x + 1] = 'w';
    if (y > 0 && y < 15) rows[y][11] = 't';
  }
  for (let y = 6; y <= 9; y++) { rows[y][3] = 'g'; rows[y][4] = 'g'; }
  return rows.map(r => r.join(''));
}
const BOW = bowRows();

const WOOD = { s: 0x9a6a3e, d: 0x6a4428, g: 0x5a4234 };

/** Head colours [base, shadow, highlight] for a metal tier. */
function headColours(head: MetalLayer): [number, number, number] {
  const pal = (EXTRA_LAYERS as Record<string, { palette: readonly number[] }>)[head]?.palette;
  if (!pal) return [0x9a98a6, 0x4a4856, 0xc4c2d0];
  const base = new THREE.Color(pal[0]), light = new THREE.Color(pal[2]);
  const dark = new THREE.Color(pal[1]).lerp(base, 0.35);
  return [base.getHex(), dark.getHex(), light.getHex()];
}

/** The sprite drawing and palette for an item, or null if it is held as a 3D model. */
function spriteFor(def: ItemDef): { rows: string[]; colours: Record<string, number> } | null {
  const m = def.model;
  const wood = (c: Record<string, number>) => ({ ...WOOD, ...c });
  if (m.type === 'pickaxe' || m.type === 'axe' || m.type === 'sword') {
    const [H, h, L] = headColours(m.head);
    const rows = m.type === 'pickaxe' ? PICKAXE : m.type === 'axe' ? AXE : SWORD;
    return { rows, colours: wood({ H, h, L, p: m.type === 'sword' ? (m.head === 'planks' ? 0x6a4428 : 0x8a6a34) : h }) };
  }
  if (m.type === 'furniture' && m.id === 'torch') return { rows: TORCH, colours: { ...WOOD, Y: 0xfff0a0, O: 0xffa030, R: 0xe8501a, c: 0x3a2418 } };
  if (m.type === 'hammer') return { rows: HAMMER, colours: wood({ H: 0x9a98a6, h: 0x4e4c5a, L: 0xd0ced8 }) };
  if (m.type === 'bow') {
    const [H, h] = headColours(m.head);
    return { rows: BOW, colours: { w: m.head === 'planks' ? 0x9a6a3e : H, t: 0xf0ead8, g: m.head === 'planks' ? 0x5a4234 : h } };
  }
  return null;
}

/** Size of one sprite pixel, in metres. */
export const SPRITE_PIXEL = 0.028;

/**
 * Extruded sprite geometry for a held tool, with its grip (the middle of the
 * handle wrap) at the origin, the handle along +y and the flat faces along ±z.
 */
const cache = new Map<string, THREE.BufferGeometry | null>();

export function heldSprite(def: ItemDef): THREE.BufferGeometry | null {
  if (!cache.has(def.id)) cache.set(def.id, buildSprite(def));
  return cache.get(def.id)!;
}

function buildSprite(def: ItemDef): THREE.BufferGeometry | null {
  const s = spriteFor(def);
  if (!s) return null;
  const { rows, colours } = s;
  const P = SPRITE_PIXEL, T = P * 0.5;
  // Grip: the centre of the wrapped part of the handle (or the middle).
  let gr = 0, gc = 0, gn = 0;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'g') { gr += y; gc += x; gn++; } }));
  const cy = gn ? gr / gn + 0.5 : 12, cx = gn ? gc / gn + 0.5 : 8;
  const filled = (x: number, y: number) => y >= 0 && y < rows.length && x >= 0 && x < rows[y].length && rows[y][x] !== '.';
  const pos: number[] = [], nor: number[] = [], col: number[] = [], lay: number[] = [];
  const plain = layerOf('plain'), glow = layerOf('glow');
  let layer = plain, fx = 0, fy = 0, fn = 0;
  const c = new THREE.Color();
  const quad = (a: number[], b: number[], cc: number[], d: number[], n: number[], shade: number) => {
    pos.push(...a, ...b, ...cc, ...a, ...cc, ...d);
    const k = layer === glow ? 1 : shade;
    for (let i = 0; i < 6; i++) { nor.push(...n); col.push(c.r * k, c.g * k, c.b * k); lay.push(layer, layer, layer); }
  };
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      c.setHex(colours[ch] ?? 0xff00ff);
      layer = GLOWING.has(ch) ? glow : plain;
      if (layer === glow) { fx += x + 0.5 - cx; fy += cy - y - 0.5; fn++; }
      const x0 = (x - cx) * P, x1 = x0 + P, y1 = (cy - y) * P, y0 = y1 - P;
      quad([x0, y0, T], [x1, y0, T], [x1, y1, T], [x0, y1, T], [0, 0, 1], 1);
      quad([x1, y0, -T], [x0, y0, -T], [x0, y1, -T], [x1, y1, -T], [0, 0, -1], 0.9);
      if (!filled(x - 1, y)) quad([x0, y0, -T], [x0, y0, T], [x0, y1, T], [x0, y1, -T], [-1, 0, 0], 0.8);
      if (!filled(x + 1, y)) quad([x1, y0, T], [x1, y0, -T], [x1, y1, -T], [x1, y1, T], [1, 0, 0], 0.8);
      if (!filled(x, y - 1)) quad([x0, y1, T], [x1, y1, T], [x1, y1, -T], [x0, y1, -T], [0, 1, 0], 0.95);
      if (!filled(x, y + 1)) quad([x0, y0, -T], [x1, y0, -T], [x1, y0, T], [x0, y0, T], [0, -1, 0], 0.7);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('mats', new THREE.BufferAttribute(new Uint8Array(lay), 3));
  // Where the flame is (sprite-local), for the fire particles it gives off.
  if (fn) g.userData.flame = [fx / fn * P, fy / fn * P, 0];
  g.computeBoundingSphere();
  return g;
}
