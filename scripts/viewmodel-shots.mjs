// First-person held items at rest and mid-swing, for visual review.
//
//   npm run build && node scripts/viewmodel-shots.mjs [item ...]

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output/held';
mkdirSync(OUT, { recursive: true });
const PORT = 4193;
const ITEMS = process.argv.length > 2 ? process.argv.slice(2) : ['copper_pickaxe', 'copper_axe', 'wooden_sword', 'builder_hammer', 'wooden_bow', 'torch', 'stone'];
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', d => { if (String(d).includes(String(PORT))) resolve(); });
  server.on('exit', code => reject(new Error(`preview exited ${code}`)));
});
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const settle = () => page.waitForFunction(() => { __game.simulate(0.05); return __game.terrain.complete && __game.terrain.stats.pending === 0; }, null, { timeout: 180000, polling: 200 });

try {
  await page.goto(`http://localhost:${PORT}/?new&seed=1337`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.evaluate(() => { __menu.hide(); __game.setMenuMode(false); __game.manual = true; __game.input.locked = true; __game.combat.spawning = false; __game.atmosphere.timeOfDay = 0.4; });
  // Face a rock wall close up: the held item must stay solid and in front of it.
  await page.evaluate(() => { const g = __game; g.player.yaw = 0.6; g.player.pitch = 0.05; });
  await settle();
  for (const id of ITEMS) {
    await page.evaluate(id => {
      const g = __game;
      if (!g.inventory.count(id)) g.inventory.add(id, 1);
      const i = g.inventory.slots.findIndex(s => s && s.id === id);
      g.inventory.swap(i, 0); g.inventory.select(0);
      g.simulate(0.5);
      g.render();
    }, id);
    await page.screenshot({ path: `${OUT}/${id}-rest.png` });
    for (const [t, tag] of [[0.08, 'wind'], [0.15, 'strike']]) {
      await page.evaluate(t => { const g = __game; g.viewmodel.triggerSwing(0.4); g.viewmodel.update(t, 0, 1); g.render(); }, t);
      await page.screenshot({ path: `${OUT}/${id}-${tag}.png` });
    }
  }
  console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
