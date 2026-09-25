// Screenshots of every menu screen and the in-game HUD for visual review.
//
//   npm run build && node scripts/ui-shots.mjs

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output/ui';
mkdirSync(OUT, { recursive: true });
const PORT = 4185;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', d => { if (String(d).includes(String(PORT))) resolve(); });
  server.on('exit', code => reject(new Error(`preview exited ${code}`)));
});
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${OUT}/${name}.png` }); };

try {
  await page.goto(`http://localhost:${PORT}/?new&seed=1337`);
  await page.waitForTimeout(1200);
  await shot('0-loading', 0);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  // Let the title camera settle and terrain stream in around it.
  await page.waitForFunction(() => __game.terrain.complete && __game.terrain.stats.pending === 0, null, { timeout: 120000, polling: 250 });
  await page.evaluate(() => { __game.atmosphere.timeOfDay = 0.36; });
  await shot('1-title', 1500);
  // Stop the render loop so the (software) GPU does not starve CSS animations.
  await page.evaluate(() => { __game.manual = true; });
  await page.click('#title [data-a="new"]');
  await shot('2-new-world');
  await page.keyboard.press('Escape');
  await page.click('#title [data-a="settings"]');
  await shot('3-settings');
  await page.click('#settings [data-a="back"]');
  await page.click('#title [data-a="controls"]');
  await shot('4-controls');
  await page.click('#controls [data-a="back"]');
  // Into the game.
  const frame = () => page.evaluate(() => { __game.simulate(0.05); __game.render(); });
  await page.evaluate(() => { __menu.hide(); __game.setMenuMode(false); __game.input.locked = true; });
  await page.waitForFunction(() => { __game.simulate(0.05); return __game.terrain.complete && __game.terrain.stats.pending === 0; }, null, { timeout: 120000, polling: 250 });
  await frame();
  await shot('5-hud');
  await page.evaluate(() => { __game.paused = true; __menu.open('pause'); });
  await shot('6-pause');
  await page.evaluate(() => { __menu.hide(); __game.paused = false; __game.toggleInventory(true); });
  await frame();
  const slot = await page.locator('#inventory .grid .slot').first().boundingBox();
  await page.mouse.move(slot.x + 20, slot.y + 20);
  await shot('7-inventory');
  // Every item icon from the retheme and the new biomes.
  await page.evaluate(() => {
    const g = __game;
    g.toggleInventory(false);
    for (const id of ['coin', 'life_crystal', 'fallen_star', 'mana_crystal', 'mana_potion', 'healing_potion', 'gel', 'wyrm_bait', 'blood_shard',
      'sanguine_blade', 'heartstone', 'rootwood', 'salt', 'fossil', 'bramble_maul', 'heartwood_bow', 'titanbone_pickaxe', 'hearth', 'salt_lamp',
      'amber_lantern', 'houndfang_charm', 'blightstone', 'bat_wing']) g.inventory.add(id, 3);
    g.toggleInventory(true);
  });
  await frame();
  await shot('7b-items');
  await page.evaluate(() => { __game.toggleInventory(false); __game.input.locked = true; __game.vitals.damage(9999, NaN, NaN, 0); });
  await frame();
  await shot('8-death');
  console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
