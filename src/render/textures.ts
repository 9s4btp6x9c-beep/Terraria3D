// Procedural pixel-art textures, generated at startup into one texture array.
// Every surface in the world (terrain materials, bark, leaves, planks...)
// samples a layer of this array with world-space triplanar mapping, so the
// whole scene shares one crisp retro texel density.

import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { MATERIALS, type TextureStyle } from '../world/materials';

export const TEX = 64;
/** World metres covered by one texture tile (TEX/TILE = texels per metre). */
export const TILE_METRES = 4;

/** Extra (non-terrain) surface layers, appended after the terrain materials. */
export const EXTRA_LAYERS = {
  bark: { style: 'bark', palette: [0x7a5238, 0x4e321f, 0x94664a, 0x3a2416] },
  leaves: { style: 'blotch', palette: [0x3c8660, 0x2c6a4c, 0x509a6c, 0x64ac78] },
  planks: { style: 'planks', palette: [0xa8744a, 0x5e3a22, 0xc08a5a, 0x8a5c38] },
  bricks: { style: 'bricks', palette: [0x9a98a4, 0x3a3842, 0xb8b6c0, 0x7e7c88] },
  plain: { style: 'plain', palette: [0xffffff, 0xffffff, 0xffffff, 0xffffff] },
  cloud: { style: 'plain', palette: [0xffffff, 0xffffff, 0xffffff, 0xffffff] },
} as const satisfies Record<string, { style: TextureStyle | 'bark' | 'planks' | 'bricks' | 'plain'; palette: readonly number[] }>;

export type ExtraLayer = keyof typeof EXTRA_LAYERS;
export function layerOf(name: ExtraLayer): number {
  return MATERIALS.length + Object.keys(EXTRA_LAYERS).indexOf(name);
}

type Style = TextureStyle | 'bark' | 'planks' | 'bricks' | 'plain';

function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Tileable value noise on a TEX x TEX torus with cell size `cell`. */
function valueNoise(rand: () => number, cell: number): Float32Array {
  const n = TEX / cell;
  const grid = new Float32Array(n * n).map(() => rand());
  const out = new Float32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const gx = x / cell, gy = y / cell;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const g = (i: number, j: number) => grid[((i % n) + n) % n + (((j % n) + n) % n) * n];
      const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
      const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
      out[x + y * TEX] = a + (b - a) * sy;
    }
  return out;
}

/** Tileable Voronoi: returns nearest-cell id and edge distance per texel. */
function voronoi(rand: () => number, count: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) pts.push([rand() * TEX, rand() * TEX]);
  const id = new Int16Array(TEX * TEX);
  const edge = new Float32Array(TEX * TEX);
  const inner = new Float32Array(TEX * TEX);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      let d1 = Infinity, d2 = Infinity, best = 0, bdx = 0, bdy = 0;
      for (let i = 0; i < count; i++)
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const dx = pts[i][0] + ox * TEX - x - 0.5, dy = pts[i][1] + oy * TEX - y - 0.5;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; best = i; bdx = dx; bdy = dy; } else if (d < d2) d2 = d;
          }
      id[x + y * TEX] = best;
      edge[x + y * TEX] = d2 - d1;
      // Offset toward the cell centre, used for a simple bevel highlight.
      inner[x + y * TEX] = (bdx + bdy) / (d1 + 1e-3);
    }
  return { id, edge, inner };
}

function paint(style: Style, palette: readonly number[], seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const [base, dark, light, accent] = palette.map(rgb);
  const px = new Uint8Array(TEX * TEX * 4);
  const put = (i: number, c: [number, number, number], shade = 1) => {
    px[i * 4] = Math.min(255, c[0] * shade);
    px[i * 4 + 1] = Math.min(255, c[1] * shade);
    px[i * 4 + 2] = Math.min(255, c[2] * shade);
    px[i * 4 + 3] = 255;
  };
  const n1 = valueNoise(rand, 16), n2 = valueNoise(rand, 8), n3 = valueNoise(rand, 4);
  for (let i = 0; i < TEX * TEX; i++) {
    const x = i % TEX, y = (i / TEX) | 0;
    const v = n1[i] * 0.55 + n2[i] * 0.3 + n3[i] * 0.15;
    const r = rand();
    switch (style) {
      case 'blotch': {
        const c = v < 0.38 ? dark : v < 0.55 ? base : v < 0.68 ? light : accent;
        put(i, r < 0.04 ? light : r > 0.97 ? dark : c);
        break;
      }
      case 'speckle': {
        let c = v < 0.42 ? dark : v < 0.62 ? base : light;
        if (n3[i] > 0.78 && r < 0.6) c = accent;
        put(i, r < 0.05 ? accent : c);
        break;
      }
      case 'dither': {
        const c = (x + y) % 2 === 0 && v > 0.6 ? light : (x + y) % 2 === 1 && v < 0.4 ? dark : base;
        put(i, r < 0.03 ? accent : c);
        break;
      }
      case 'strata': {
        const band = Math.sin((y + n1[i] * 10) * 0.45);
        put(i, band > 0.5 ? light : band < -0.6 ? dark : r < 0.05 ? accent : base);
        break;
      }
      case 'plain':
        put(i, base);
        break;
      default:
        put(i, base);
    }
  }
  if (style === 'cobble' || style === 'ore' || style === 'crystal') {
    const vor = voronoi(rand, style === 'crystal' ? 7 : 11);
    const tint = new Float32Array(16).map(() => 0.88 + rand() * 0.2);
    for (let i = 0; i < TEX * TEX; i++) {
      const e = vor.edge[i];
      if (e < 1.6) { put(i, dark); continue; }
      const t = tint[vor.id[i] % 16];
      const highlight = vor.inner[i] > 0.9 && e < 4 ? 1.12 : vor.inner[i] < -0.9 && e < 4 ? 0.86 : 1;
      const v = n2[i];
      let c = v > 0.62 ? light : v < 0.35 ? accent : base;
      if (style === 'crystal') c = e < 3 ? accent : v > 0.55 ? light : base;
      put(i, c, t * highlight);
    }
    if (style === 'ore') {
      // Ore nuggets: small clusters in the accent/light colours.
      for (let k = 0; k < 14; k++) {
        const cx = Math.floor(rand() * TEX), cy = Math.floor(rand() * TEX), s = 1 + Math.floor(rand() * 3);
        for (let dy = -s; dy <= s; dy++)
          for (let dx = -s; dx <= s; dx++) {
            if (dx * dx + dy * dy > s * s + 1) continue;
            const x = (cx + dx + TEX) % TEX, y = (cy + dy + TEX) % TEX;
            const i = x + y * TEX;
            put(i, dx + dy < 0 ? accent : light);
          }
      }
    }
  }
  if (style === 'bark') {
    for (let i = 0; i < TEX * TEX; i++) {
      const x = i % TEX;
      const stripe = Math.sin(x * 0.9 + n1[i] * 6);
      put(i, stripe > 0.6 ? dark : stripe < -0.7 ? light : n3[i] > 0.75 ? accent : base);
    }
  }
  if (style === 'planks' || style === 'bricks') {
    const rowH = style === 'planks' ? 8 : 8;
    for (let i = 0; i < TEX * TEX; i++) {
      const x = i % TEX, y = (i / TEX) | 0;
      const row = Math.floor(y / rowH);
      const len = style === 'planks' ? 32 : 16;
      const off = (row * (style === 'planks' ? 13 : 8)) % len;
      const seam = (y % rowH === 0) || ((x + off) % len === 0);
      const grain = style === 'planks' ? Math.sin(x * 0.35 + row * 3 + n2[i] * 4) : n2[i] - 0.5;
      put(i, seam ? dark : grain > 0.7 ? light : grain < -0.75 ? accent : base, 0.92 + (row % 3) * 0.05);
    }
  }
  return px;
}

export function buildTextureArray(): THREE.DataArrayTexture {
  const layers: { style: Style; palette: readonly number[] }[] = [
    ...MATERIALS.map(m => ({ style: m.texture as Style, palette: m.palette })),
    ...Object.values(EXTRA_LAYERS).map(l => ({ style: l.style as Style, palette: l.palette })),
  ];
  const data = new Uint8Array(TEX * TEX * 4 * layers.length);
  layers.forEach((l, i) => data.set(paint(l.style, l.palette, 1000 + i * 17), i * TEX * TEX * 4));
  const tex = new THREE.DataArrayTexture(data, TEX, TEX, layers.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** CSS colour of a layer's base, for UI swatches. */
export function layerSwatch(hex: number) {
  return '#' + hex.toString(16).padStart(6, '0');
}
