// The Dune Worm in the desert: burrowing, bursting out and arcing overhead.
//
//   npm run build && node scripts/worm-shots.mjs

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output/worm';
mkdirSync(OUT, { recursive: true });
const PORT = 4198;
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
  await page.goto(`http://localhost:${PORT}/?new&seed=1337`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.evaluate(() => { __menu.hide(); __game.setMenuMode(false); __game.manual = true; __game.input.locked = true; __game.combat.spawning = false; __game.atmosphere.timeOfDay = 0.42; __game.atmosphere.cycle = false; __game.inventory.select(8); });
  // Stand in open desert.
  await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    for (let r = 20; r < 400; r += 6) for (let a = 0; a < 6.28; a += 0.3) {
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      if ([[0, 0], [15, 0], [-15, 0], [0, 15], [0, -15]].every(([dx, dz]) => g.gen.biomeAt(x + dx, z + dz) === 1) && g.gen.height(x, z) > g.gen.cfg.seaLevel + 3) {
        g.player.teleport(x, g.gen.height(x, z) + 1, z); g.player.yaw = 0; g.player.pitch = 0.2; return;
      }
    }
  });
  await settle();
  const info = await page.evaluate(() => {
    const g = __game, p = g.player;
    g.vitals.hp = g.vitals.maxHp; g.vitals.maxHp = 9999; g.vitals.hp = 9999;
    const c = g.spawnCreature('dune_worm', p.x, g.gen.height(p.x, p.z - 14) - 6, p.z - 14);
    return { hp: c.hp, segs: c.body.length };
  });
  console.log('spawned', JSON.stringify(info));
  const log = [];
  for (let i = 0; i < 14; i++) {
    const st = await page.evaluate(() => {
      const g = __game, p = g.player;
      for (let k = 0; k < 8; k++) { g.simulate(1 / 20); g.vitals.hp = g.vitals.maxHp; }
      const c = g.combat.creatures.find(c => c.def.id === 'dune_worm');
      if (!c) return null;
      // Keep looking at the head.
      const dx = c.x - p.x, dz = c.z - p.z, dy = c.y - (p.y + 1.6);
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.max(-0.6, Math.min(0.9, Math.atan2(dy, Math.hypot(dx, dz))));
      g.render();
      return { y: +(c.y - g.gen.height(c.x, c.z)).toFixed(1), phase: c.phase, dist: +Math.hypot(dx, dz).toFixed(1) };
    });
    log.push(st);
    await page.screenshot({ path: `${OUT}/worm-${String(i).padStart(2, '0')}.png` });
  }
  console.log(JSON.stringify(log));
  console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
