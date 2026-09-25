// First-person held items at rest and mid-swing, for reviewing tool poses.
//
//   npm run build && node scripts/held-shots.mjs

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output/held';
mkdirSync(OUT, { recursive: true });
const PORT = 4191;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', d => { if (String(d).includes(String(PORT))) resolve(); });
  server.on('exit', code => reject(new Error(`preview exited ${code}`)));
});
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const ITEMS = process.argv.slice(2).length ? process.argv.slice(2) : ['copper_pickaxe', 'copper_axe', 'wooden_sword', 'iron_sword', 'wooden_bow', 'lumite_staff', 'torch', 'bramble_maul'];
try {
  await page.goto(`http://localhost:${PORT}/?new&seed=1337`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.evaluate(() => { __menu.hide(); __game.setMenuMode(false); __game.manual = true; __game.input.locked = true; __game.combat.spawning = false; __game.player.pitch = 0.05; });
  await page.waitForFunction(() => { __game.simulate(0.05); return __game.terrain.complete && __game.terrain.stats.pending === 0; }, null, { timeout: 180000, polling: 200 });
  for (const id of ITEMS) {
    await page.evaluate(id => { const g = __game; g.inventory.add(id, 1); const i = g.inventory.slots.findIndex(s => s && s.id === id); g.inventory.swap(i, 8); g.inventory.select(8); g.simulate(0.4); g.render(); }, id);
    await page.screenshot({ path: `${OUT}/${id}-rest.png` });
    await page.evaluate(() => { const g = __game; g.viewmodel.triggerSwing(0.4); g.simulate(0.14); g.render(); });
    await page.screenshot({ path: `${OUT}/${id}-swing.png` });
  }
  console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
