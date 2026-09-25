// Screenshots of every biome (and its landmark features) for visual review.
//
//   npm run build && node scripts/biome-shots.mjs [seed]

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output/biomes';
mkdirSync(OUT, { recursive: true });
const PORT = 4187;
const seed = Number(process.argv[2] ?? 1337);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', d => { if (String(d).includes(String(PORT))) resolve(); });
  server.on('exit', code => reject(new Error(`preview exited ${code}`)));
});
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

const settle = () => page.waitForFunction(() => { __game.simulate(0.05); return __game.terrain.complete && __game.terrain.stats.pending === 0; }, null, { timeout: 180000, polling: 200 });

try {
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?new&seed=${seed}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.evaluate(() => { __menu.hide(); __game.setMenuMode(false); __game.manual = true; __game.input.locked = true; __game.combat.spawning = false; });
  const views = await page.evaluate(() => {
    const g = __game.gen, out = [];
    const MAT = { root: 22, fossil: 24, amber: 26 };
    const deep = f => { const [x, , z] = center(f), b = g.biomeAt(x, z); return [[25, 0], [-25, 0], [0, 25], [0, -25]].every(([dx, dz]) => g.biomeAt(x + dx, z + dz) === b); };
    const feats = m => g.features.filter(f => f.mat === m && deep(f));
    const center = (f) => [(f.ax + f.bx) / 2, (f.ay + f.by) / 2, (f.az + f.bz) / 2];
    // Landmark views: stand back from the feature and look at it.
    const arch = feats(MAT.root).sort((a, b) => (b.ay + b.by) - (a.ay + a.by))[0];
    if (arch) out.push({ name: 'rootwold', target: center(arch), dist: 30 });
    const skull = feats(MAT.fossil).find(f => f.ra > 4);
    if (skull) out.push({ name: 'ossuary', target: center(skull), dist: 34, yawOff: 2.2 });
    const nod = feats(MAT.amber)[0];
    if (nod) out.push({ name: 'amberwood', target: center(nod), dist: 14 });
    for (const [name, b] of [['riftlands', 3], ['dunes', 1], ['frostmere', 2]]) {
      for (let i = 0; i < 4000; i++) {
        const x = 60 + Math.random() * (g.size.x - 120), z = 60 + Math.random() * (g.size.z - 120);
        if ([[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]].every(([dx, dz]) => g.biomeAt(x + dx, z + dz) === b) && g.height(x, z) > 64) {
          out.push({ name, target: [x, g.height(x, z) + 4, z], dist: 26 });
          break;
        }
      }
    }
    return out;
  });
  for (const v of views) {
    await page.evaluate(v => {
      const g = __game, [tx, ty, tz] = v.target;
      // Stand inside the same biome, on open ground no higher than the target.
      const b = g.gen.biomeAt(tx, tz);
      let best = null;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, x = tx + Math.cos(a) * v.dist, z = tz + Math.sin(a) * v.dist;
        const h = g.gen.height(x, z), score = (g.gen.biomeAt(x, z) === b ? 0 : 50) + Math.abs(h - (g.gen.height(tx, tz) + 3)) + (h < 63 ? 99 : 0);
        if (!best || score < best.score) best = { x, z, score };
      }
      const { x, z } = best;
      const y = Math.max(g.gen.height(x, z), 63) + 5;
      g.player.teleport(x, y, z);
      g.player.yaw = Math.atan2(-(tx - x), -(tz - z));
      g.player.pitch = Math.atan2(ty - y - 1.6, v.dist) * 0.8;
      g.atmosphere.timeOfDay = 0.37;
    }, v);
    await settle();
    await page.evaluate(() => { __game.player.vy = 0; __game.simulate(0.05); __game.render(); });
    await page.screenshot({ path: `${OUT}/${v.name}.png` });
    if (process.env.DEBUG) console.log(await page.evaluate(v => {
      const g = __game, [tx, , tz] = v.target, x = Math.floor(tx), z = Math.floor(tz);
      return JSON.stringify({ raw: g.sky.raw[x + z * g.sky.w], blurred: g.sky.blurred[x + z * g.sky.w], h: g.gen.height(x, z), top: g.gen.featureTop(x, z, x, z) });
    }, v));
    console.log(`shot ${v.name}`);
  }
  console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
