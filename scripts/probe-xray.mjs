// Probe: walk into cave walls, slopes and overhangs at several pitches and
// report how close the eye and near-plane corners get to solid (<0 = x-ray).
//
//   npm run build && node scripts/probe-xray.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 4195;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', d => { if (String(d).includes(String(PORT))) res(); }); setTimeout(() => rej(new Error('timeout')), 20000); });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', e => console.log('ERR', String(e)));
try {
  await page.goto(`http://localhost:${PORT}/?new&seed=1337`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.evaluate(() => { __menu.hide(); __game.setMenuMode(false); __game.paused = false; __game.manual = true; __game.input.locked = true; __game.combat.spawning = false; });
  const settle = () => page.waitForFunction(() => { __game.simulate(0.05); return __game.terrain.complete && __game.terrain.stats.pending === 0; }, null, { timeout: 120000, polling: 100 });
  const spots = await page.evaluate(() => {
    const g = __game, s = g.gen.spawn, out = [];
    for (let r = 10; r < 160 && out.length < 16; r += 9) for (let a = 0; a < 6.28 && out.length < 16; a += 0.9) {
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      for (let y = 8; y < 60; y++) if (g.gen.densityAt(x, y, z) < -0.5 && g.gen.densityAt(x, y + 1.9, z) < -0.3 && g.gen.densityAt(x, y - 1, z) > 0 && g.gen.height(x, z) > y + 6) { out.push([x, y, z]); break; }
    }
    return out;
  });
  let worst = 9;
  for (const sp of spots) {
    await page.evaluate(([x, y, z]) => { const g = __game; g.vitals.hp = g.vitals.maxHp; g.player.teleport(x, y, z); }, sp);
    await settle();
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, n = [0, 0, 0];
      let min = 9;
      for (let a = 0; a < 6.28; a += 0.785) {
        const x0 = p.x, y0 = p.y, z0 = p.z;
        p.yaw = a; g.input.keys.add('KeyW');
        for (let pitch of [-0.8, 0, 0.8]) {
          p.pitch = pitch;
          for (let i = 0; i < 40; i++) {
            g.simulate(1 / 30);
            const c = g.camera.position;
            // Check the eye and the near-plane corners.
            for (const [ox, oy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
              const v = new c.constructor(ox * 0.072, oy * 0.041, -0.05).applyQuaternion(g.camera.quaternion);
              min = Math.min(min, g.field.distance(c.x + v.x, c.y + v.y, c.z + v.z, n));
            }
          }
        }
        g.input.keys.clear();
        p.teleport(x0, y0, z0);
      }
      return min;
    });
    worst = Math.min(worst, r);
    console.log(sp.map(v => v.toFixed(1)).join(','), r.toFixed(3));
  }
  console.log('worst', worst.toFixed(3));
} finally { await browser.close(); server.kill(); }
