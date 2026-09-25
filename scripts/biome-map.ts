// Renders a top-down biome map per seed (PNG via a tiny encoder) and prints
// each biome's share of dry land, to tune the biome noise thresholds.
//
//   npx tsx scripts/biome-map.ts 1337 7 42

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { defaultConfig } from '../src/world/config';
import { BIOME_NAMES, WorldGenerator } from '../src/world/generator';

const COLORS = [[74, 145, 96], [220, 200, 140], [234, 242, 248], [70, 120, 140], [46, 90, 50], [200, 150, 200], [216, 116, 42]];
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w: number, h: number, rgb: Uint8Array) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('e2e-output', { recursive: true });
for (const seed of process.argv.slice(2).map(Number)) {
  const t0 = performance.now();
  const gen = new WorldGenerator(defaultConfig(seed));
  const ms = performance.now() - t0;
  const W = gen.size.x, D = gen.size.z, step = 2;
  const w = W / step, h = D / step;
  const rgb = new Uint8Array(w * h * 3);
  const count = new Array(BIOME_NAMES.length).fill(0);
  let land = 0;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = i * step, z = j * step, b = gen.biomeAt(x, z), ht = gen.height(x, z);
      const water = ht < gen.cfg.seaLevel;
      let c = water ? [40, 90, 170] : COLORS[b];
      const shade = water ? 1 : 0.75 + Math.min(1, (ht - 60) / 60) * 0.35;
      if (gen.featureTop(x, z, x, z) > ht && gen.featureAt(x, Math.min(gen.featureTop(x, z, x, z) - 1, ht + 6), z)?.d! > 0) c = [255, 0, 0];
      const k = (i + j * w) * 3;
      rgb[k] = Math.min(255, c[0] * shade); rgb[k + 1] = Math.min(255, c[1] * shade); rgb[k + 2] = Math.min(255, c[2] * shade);
      if (!water) { land++; count[b]++; }
    }
  writeFileSync(`e2e-output/biomes-${seed}.png`, png(w, h, rgb));
  const pct = count.map((n, b) => `${BIOME_NAMES[b]} ${(100 * n / land).toFixed(1)}%`).join(', ');
  const kinds = new Map<number, number>();
  for (const f of gen.features) kinds.set(f.mat, (kinds.get(f.mat) ?? 0) + 1);
  console.log(`seed ${seed} (${ms.toFixed(0)} ms): ${pct}; features ${[...kinds].map(([m, n]) => `${m}:${n}`).join(' ')}`);
}
