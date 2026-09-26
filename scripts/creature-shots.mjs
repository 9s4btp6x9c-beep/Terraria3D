// Close-up lineups of every creature, for visual review of the models.
//
//   npm run build && node scripts/creature-shots.mjs

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output/creatures';
mkdirSync(OUT, { recursive: true });
const PORT = 4189;
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

const GROUPS = {
  blobs: ['blob', 'dune_blob', 'frost_blob', 'rift_blob', 'moss_blob', 'amber_blob'],
  blobs2: ['deep_blob', 'cinder_blob', 'cloud_blob', 'spore_blob'],
  walkers: ['rootwalker', 'sporebound', 'rotfang', 'mossback', 'salt_crawler'],
  flyers: ['drifter', 'rift_drifter', 'spore_drifter', 'bonepicker', 'leafwing'],
  cinderbound: ['ash_blob', 'cinder_scout', 'cinder_raider', 'firebrand', 'basalt_colossus', 'cinder_blob'],
};
const FLY = new Set(['drifter', 'rift_drifter', 'spore_drifter', 'bonepicker', 'leafwing']);

try {
  await page.goto(`http://localhost:${PORT}/?new&seed=1337`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.evaluate(() => { __menu.hide(); __game.setMenuMode(false); __game.manual = true; __game.input.locked = true; __game.combat.spawning = false; __game.atmosphere.timeOfDay = 0.4; });
  // Find a flat, open spot near spawn with no trees in front.
  await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    let best = null;
    for (let i = 0; i < 300; i++) {
      const x = s.x + (Math.random() - 0.5) * 80, z = s.z + (Math.random() - 0.5) * 80, h = g.gen.height(x, z);
      let flat = 0;
      for (let k = 0; k < 8; k++) flat = Math.max(flat, Math.abs(g.gen.height(x + Math.cos(k) * 8, z + Math.sin(k) * 8) - h));
      const trees = g.veg.treesNear(x, z, 10).length;
      const score = flat + trees * 3;
      if (!best || score < best.score) best = { x, z, score };
    }
    g.player.teleport(best.x, g.gen.height(best.x, best.z) + 1, best.z);
    g.player.yaw = 0; g.player.pitch = -0.16;
    for (const t of g.veg.treesNear(best.x, best.z - 6, 12)) t.alive = false;
  });
  await settle();
  for (const [name, ids] of Object.entries(GROUPS)) {
    await page.evaluate(({ ids, fly }) => {
      const g = __game;
      g.combat.clear();
      const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw), sx = -fz, sz = fx;
      ids.forEach((id, i) => {
        const o = (i - (ids.length - 1) / 2) * 1.55;
        const x = g.player.x + fx * 5.2 + sx * o, z = g.player.z + fz * 5.2 + sz * o;
        const c = g.spawnCreature(id, x, g.gen.height(x, z) + (fly.includes(id) ? 1.3 : 0.3), z);
        c.yaw = Math.atan2(-fx, -fz) + 0.4;
      });
    }, { ids, fly: [...FLY] });
    await page.evaluate(() => { for (const c of __game.combat.creatures) { c.cooldown = 5; c.aggro = 0; } __game.simulate(0.05); __game.render(); });
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
