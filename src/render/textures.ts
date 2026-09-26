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
  metal: { style: 'metal', palette: [0x6e6c78, 0x2e2c36, 0x9a98a6, 0xc4c2d0] },
  copper: { style: 'metal', palette: [0xc0703a, 0x6a3418, 0xe0945a, 0xffc890] },
  iron: { style: 'metal', palette: [0xb4aca6, 0x5a5460, 0xd6d0ca, 0xf4f0ea] },
  lumiteMetal: { style: 'metal', palette: [0x2aa8d8, 0x0e4a74, 0x6ae6ff, 0xd8ffff] },
  flame: { style: 'flame', palette: [0xffb030, 0xe0501a, 0xffe070, 0xfff8d0] },
  cloth: { style: 'cloth', palette: [0xb03a36, 0x6e1e22, 0xd0584a, 0xe8c070] },
  fabric: { style: 'cloth', palette: [0xe4e0dc, 0xb8b2ae, 0xf4f2f0, 0xcac4c0] },
  gel: { style: 'gel', palette: [0x4ec87a, 0x2a8a50, 0x8af0a8, 0xe0fff0] },
  bone: { style: 'bone', palette: [0xe6dcc0, 0x9a8e74, 0xfff6de, 0x6a604e] },
  chitin: { style: 'chitin', palette: [0x4a4658, 0x1e1c26, 0x6e6a82, 0x9a96b0] },
  fur: { style: 'fur', palette: [0x5a4a5e, 0x2e2434, 0x7a6a80, 0xb09ab8] },
  gold: { style: 'metal', palette: [0xe0b030, 0x8a5e10, 0xffd860, 0xfff4b0] },
  glass: { style: 'gel', palette: [0x9ad8f0, 0x5a9ab8, 0xd8f4ff, 0xffffff] },
  red: { style: 'gel', palette: [0xd83a3a, 0x8a1e22, 0xff7a6a, 0xffd0c8] },
  emberMetal: { style: 'metal', palette: [0xd0501e, 0x5a1a0a, 0xff8a3a, 0xffe070] },
  cactus: { style: 'bark', palette: [0x4a8a4a, 0x2a5a30, 0x6aaa5a, 0xd8e8a0] },
  deadbark: { style: 'bark', palette: [0x5a5058, 0x2a2430, 0x7a7078, 0x1e1a22] },
  blightleaves: { style: 'blotch', palette: [0x6a3a7a, 0x4a2458, 0x8a52a0, 0xb070c8] },
  scale: { style: 'chitin', palette: [0x7a8a5a, 0x3a4228, 0x9aaa76, 0xc8d890] },
  bloodMetal: { style: 'metal', palette: [0xb0222e, 0x4a0812, 0xe8444c, 0xffb0a0] },
  aeriteMetal: { style: 'metal', palette: [0x8ac8ec, 0x2e5a8a, 0xd0f0ff, 0xfff2b8] },
  feather: { style: 'fur', palette: [0xdce4ee, 0x7a8aa4, 0xf6f8fc, 0xa8b8d0] },
  glowcap: { style: 'blotch', palette: [0x3ac86a, 0x1a6a3a, 0x7af09a, 0xd8ffd0] },
  mushstem: { style: 'bark', palette: [0xd8d0c0, 0x9a8e7c, 0xece6da, 0xb8ae9a] },
  heart: { style: 'gel', palette: [0xf0304a, 0x8a0a22, 0xff7a8a, 0xffe0e6] },
  manaGem: { style: 'gel', palette: [0x3a6aff, 0x142a8a, 0x7aa8ff, 0xe0ecff] },
  bloodgel: { style: 'gel', palette: [0xd02a3a, 0x6a0a18, 0xff6a78, 0xffd0d4] },
  hide: { style: 'fur', palette: [0x6a2a2a, 0x2e1014, 0x8a3a36, 0xc0605a] },
  sporeMetal: { style: 'metal', palette: [0x2a9a80, 0x0e4a3e, 0x5ad8b0, 0xd0fff0] },
  rootplanks: { style: 'planks', palette: [0x7a6250, 0x3e3028, 0x9a8068, 0x5e4a3c] },
  saltbricks: { style: 'bricks', palette: [0xe8e0d4, 0x9a8e80, 0xf8f4ec, 0xcfc4b4] },
  basaltbricks: { style: 'bricks', palette: [0x3e383c, 0x141016, 0x544c52, 0x2e282c] },
  bonebricks: { style: 'bricks', palette: [0xe0d4b4, 0x7a6a50, 0xf6ecd0, 0xb8a888] },
  rotfur: { style: 'fur', palette: [0x4e5a4a, 0x262e26, 0x6a7a62, 0x8aa07a] },
  riftleaves: { style: 'crystal', palette: [0x3ab8c8, 0x1a5a70, 0x8af0f0, 0xe0ffff] },
  amberleaves: { style: 'blotch', palette: [0xd8702a, 0xa0421e, 0xf0a038, 0xf8d050] },
  mossleaves: { style: 'blotch', palette: [0x56763a, 0x344e26, 0x74924a, 0xb4c066] },
  rootbark: { style: 'bark', palette: [0x5e4a3c, 0x33261e, 0x7a6250, 0x9ab870] },
  amber: { style: 'gel', palette: [0xf0a028, 0xa0520e, 0xffd060, 0xfff4b0] },
  jelly: { style: 'gel', palette: [0xb8a8ff, 0x6a5ac8, 0xe0d8ff, 0xffffff] },
  spore: { style: 'blotch', palette: [0x3ac8a0, 0x1a6a5a, 0x7af0c8, 0xe0fff0] },
  ember: { style: 'flame', palette: [0xff8a30, 0xd0401a, 0xffd060, 0xfff4c0] },
  glim: { style: 'gel', palette: [0x4ab8ff, 0x1a5ab0, 0x9ae0ff, 0xf0ffff] },
  /** Flat white that glows: pixel flames (the colour comes from vertex colours). */
  glow: { style: 'plain', palette: [0xffffff, 0xffffff, 0xffffff, 0xffffff] },
} as const satisfies Record<string, { style: Style; palette: readonly number[] }>;

/** Self-illumination per extra layer (flames glow, crystals shimmer). */
export const EXTRA_EMISSIVE: Partial<Record<keyof typeof EXTRA_LAYERS, number>> = {
  flame: 1.2, lumiteMetal: 0.35, gel: 0.08, emberMetal: 0.4, bloodMetal: 0.18, bloodgel: 0.1, aeriteMetal: 0.22, heart: 0.45, manaGem: 0.4, glowcap: 0.6,
  riftleaves: 0.22, amber: 0.55, spore: 0.5, jelly: 0.3, ember: 1.0, glim: 0.5, sporeMetal: 0.2, glow: 0.65,
};

export type ExtraLayer = keyof typeof EXTRA_LAYERS;
export function layerOf(name: ExtraLayer): number {
  return MATERIALS.length + Object.keys(EXTRA_LAYERS).indexOf(name);
}

type Style = TextureStyle | 'planks' | 'bricks' | 'plain' | 'metal' | 'flame' | 'cloth' | 'gel' | 'bone' | 'chitin' | 'fur';

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
  if (style === 'crackle') {
    // Salt-pan crust: big polygons with raised, cracked rims.
    const vor = voronoi(rand, 9);
    for (let i = 0; i < TEX * TEX; i++) {
      const e = vor.edge[i];
      const t = 0.95 + (vor.id[i] % 5) * 0.02;
      put(i, e < 1.1 ? dark : e < 2.6 ? accent : n3[i] > 0.8 ? light : base, e < 1.1 ? 1 : t);
    }
  }
  if (style === 'litter') {
    // Fallen leaves over dark loam.
    for (let i = 0; i < TEX * TEX; i++) put(i, n2[i] < 0.4 ? dark : base);
    const leafCols = [light, accent, [0xb0, 0x3a, 0x22] as [number, number, number], light];
    for (let k = 0; k < 150; k++) {
      const cx = rand() * TEX, cy = rand() * TEX, a = rand() * Math.PI, c = leafCols[k % 4];
      const ca = Math.cos(a), sa = Math.sin(a), shade = 0.8 + rand() * 0.3;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
          if ((u * u) / 7 + (v * v) / 1.6 > 1) continue;
          const x = Math.floor(cx + dx + TEX) % TEX, y = Math.floor(cy + dy + TEX) % TEX;
          put(x + y * TEX, c, Math.abs(v) < 0.4 ? shade * 0.8 : shade);
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
  if (style === 'metal') {
    // Riveted plates with a bevelled highlight on each plate.
    for (let i = 0; i < TEX * TEX; i++) {
      const x = i % TEX, y = (i / TEX) | 0;
      const px2 = x % 16, py2 = y % 16;
      const seam = px2 === 0 || py2 === 0;
      const rivet = (px2 === 3 || px2 === 12) && (py2 === 3 || py2 === 12);
      const bevel = px2 === 1 || py2 === 1 ? 1.12 : px2 === 15 || py2 === 15 ? 0.8 : 1;
      const scratch = n3[i] > 0.8 ? light : n2[i] < 0.28 ? dark : base;
      put(i, seam ? dark : rivet ? accent : scratch, bevel * (0.94 + n1[i] * 0.12));
    }
  }
  if (style === 'flame') {
    for (let i = 0; i < TEX * TEX; i++) {
      const y = (i / TEX) | 0;
      const h = (y / TEX + n2[i] * 0.35) % 1;
      put(i, h < 0.25 ? accent : h < 0.5 ? light : h < 0.8 ? base : dark);
    }
  }
  if (style === 'cloth') {
    for (let i = 0; i < TEX * TEX; i++) {
      const x = i % TEX, y = (i / TEX) | 0;
      const weave = (x + y) % 4 < 2 ? 1.06 : 0.94;
      const stripe = y % 32 < 3;
      put(i, stripe ? accent : n2[i] < 0.3 ? dark : n2[i] > 0.7 ? light : base, weave);
    }
  }
  if (style === 'gel') {
    for (let i = 0; i < TEX * TEX; i++) {
      const v = n1[i] * 0.6 + n2[i] * 0.4;
      const r = rand();
      put(i, r < 0.02 ? accent : v > 0.64 ? light : v < 0.36 ? dark : base);
    }
  }
  if (style === 'bone') {
    for (let i = 0; i < TEX * TEX; i++) {
      const x = i % TEX;
      const crack = Math.abs(n2[i] - 0.5) < 0.03;
      put(i, crack ? accent : Math.sin(x * 0.4 + n1[i] * 5) > 0.85 ? dark : n3[i] > 0.7 ? light : base);
    }
  }
  if (style === 'chitin') {
    for (let i = 0; i < TEX * TEX; i++) {
      const y = (i / TEX) | 0;
      const seg = y % 12;
      put(i, seg === 0 ? dark : seg < 3 ? accent : seg > 9 ? dark : n2[i] > 0.62 ? light : base, 1 - seg * 0.02);
    }
  }
  if (style === 'fur') {
    for (let i = 0; i < TEX * TEX; i++) {
      const x = i % TEX, y = (i / TEX) | 0;
      const strand = Math.sin(x * 1.3 + Math.sin(y * 0.3) * 2 + n2[i] * 6);
      put(i, strand > 0.75 ? light : strand < -0.8 ? dark : n3[i] > 0.85 ? accent : base);
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
