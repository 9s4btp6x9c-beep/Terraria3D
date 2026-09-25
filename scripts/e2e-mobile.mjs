// Mobile/touch smoke test: phone-sized landscape viewport with touch, low
// quality preset. Verifies the touch UI appears and drives the player.
//
//   npm run build && node scripts/e2e-mobile.mjs

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });
const PORT = 4182;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', d => { if (String(d).includes(String(PORT))) resolve(); });
  server.on('exit', code => reject(new Error(`preview exited ${code}`)));
});
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failures++; };

try {
  await page.goto(`http://localhost:${PORT}/?new&touch`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const q = await page.evaluate(() => __game.quality.name);
  check('touch device gets the low quality preset', q === 'low', q);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/m0-title.png` });
  await page.tap('#title [data-a="play"]');
  await page.evaluate(() => { __game.manual = true; });
  const ui = await page.evaluate(() => ({ touch: getComputedStyle(document.querySelector('#touch')).display, locked: __game.input.locked, menu: document.querySelector('#menu').classList.contains('show') }));
  check('touch controls shown after tapping Play', ui.touch === 'block' && ui.locked && !ui.menu, JSON.stringify(ui));

  // Drag the joystick up (forward) and hold while the game simulates.
  const box = await page.locator('#touch .stick').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const before = await page.evaluate(() => ({ x: __game.player.x, z: __game.player.z }));
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 45, { steps: 4 });
  await page.evaluate(() => __game.simulate(1.5));
  const axis = await page.evaluate(() => __game.input.axisForward);
  await page.mouse.up();
  const after = await page.evaluate(() => ({ x: __game.player.x, z: __game.player.z }));
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check('virtual joystick moves the player', moved > 2, `axis ${axis.toFixed(2)}, moved ${moved.toFixed(1)} m`);

  // Drag on the right side to look around.
  const yaw0 = await page.evaluate(() => __game.player.yaw);
  await page.mouse.move(470, 140);
  await page.mouse.down();
  await page.mouse.move(380, 140, { steps: 5 });
  await page.evaluate(() => __game.simulate(0.05));
  await page.mouse.up();
  const yaw1 = await page.evaluate(() => __game.player.yaw);
  check('dragging the screen turns the camera', Math.abs(yaw1 - yaw0) > 0.1, `${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);

  // Use button swings the held tool.
  await page.evaluate(() => { __game.player.pitch = -0.9; });
  const useBtn = await page.locator('#touch button[data-b="use"]').boundingBox();
  await page.mouse.move(useBtn.x + 20, useBtn.y + 20);
  await page.mouse.down();
  await page.evaluate(() => __game.simulate(2));
  await page.mouse.up();
  const edits = await page.evaluate(() => __game.log.edits.length);
  check('use button mines with the pickaxe', edits > 0, `${edits} edits`);

  // Inventory button opens the inventory.
  const invBtn = await page.locator('#touch button[data-b="inv"]').boundingBox();
  await page.mouse.click(invBtn.x + 20, invBtn.y + 20);
  const invOpen = await page.evaluate(() => __game.inventoryOpen);
  check('inventory button opens the inventory', invOpen);
  await page.evaluate(() => { __game.simulate(0.05); __game.render(); });
  await page.waitForTimeout(100);
  const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('#touch')).display);
  check('touch controls hide while the inventory is open', hidden === 'none', hidden);
  const fits = await page.evaluate(() => { const r = document.querySelector('#inventory').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
  check('inventory fits on a phone screen', fits);
  await page.screenshot({ path: `${OUT}/m2-inventory.png` });
  await page.tap('#inventory .close');
  await page.evaluate(() => { __game.simulate(0.05); __game.render(); });
  await page.waitForTimeout(100);
  const back = await page.evaluate(() => ({ open: __game.inventoryOpen, touch: getComputedStyle(document.querySelector('#touch')).display }));
  check('close button closes the inventory and restores controls', !back.open && back.touch === 'block', JSON.stringify(back));
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('#minimap').getBoundingClientRect();
    const hit = r => !(r.right <= a.left || r.left >= a.right || r.bottom <= a.top || r.top >= a.bottom);
    const hot = document.querySelector('#hotbar').getBoundingClientRect();
    const btns = [...document.querySelectorAll('#touch button, #touch .stick')].map(b => b.getBoundingClientRect());
    const hitHot = r => !(r.right <= hot.left || r.left >= hot.right || r.bottom <= hot.top || r.top >= hot.bottom);
    return btns.some(hit) || btns.some(hitHot);
  });
  check('touch controls avoid the minimap and hotbar', !overlap);
  // Every hotbar slot can be tapped, including those over the look area.
  const picked = [];
  for (const i of [0, 3, 5, 8]) {
    const r = await page.locator(`#hotbar .slot[data-hot="${i}"]`).boundingBox();
    await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    await page.evaluate(() => { __game.simulate(0.05); });
    picked.push(await page.evaluate(() => __game.inventory.selected));
  }
  check('tapping any hotbar slot selects it', picked.join() === '0,3,5,8', picked.join());
  // The hammer: the shape button opens the build menu (fits the phone), a rotate button appears.
  const hammerSlot = await page.evaluate(() => __game.inventory.slots.findIndex(q => q && q.id === 'builder_hammer'));
  const hs = await page.locator(`#hotbar .slot[data-hot="${hammerSlot}"]`).boundingBox();
  await page.touchscreen.tap(hs.x + hs.width / 2, hs.y + hs.height / 2);
  await page.evaluate(() => { __game.simulate(0.05); });
  const rot = await page.evaluate(() => getComputedStyle(document.querySelector('#touch [data-b="rot"]')).display);
  await page.tap('#touch [data-b="mode"]');
  await page.evaluate(() => { __game.simulate(0.05); __game.render(); });
  const bm = await page.evaluate(() => {
    const r = document.querySelector('#buildmenu').getBoundingClientRect();
    return { open: __game.buildMenu.open, fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
  });
  await page.screenshot({ path: `${OUT}/m3-build-menu.png` });
  await page.tap('#buildmenu [data-piece="doorway"]');
  const chosen = await page.evaluate(() => ({ shape: __game.interaction.build.shape, open: __game.buildMenu.open, touch: getComputedStyle(document.querySelector('#touch')).display }));
  check('with the hammer, the build button opens a menu that fits and a rotate button shows', rot !== 'none' && bm.open && bm.fits && chosen.shape === 'doorway' && !chosen.open, JSON.stringify({ rot, ...bm, ...chosen }));
  await page.screenshot({ path: `${OUT}/m1-touch.png` });
  check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
