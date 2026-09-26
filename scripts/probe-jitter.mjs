// Probe: stand still on many cave floors near spawn and report vertical
// jitter (total eye travel over two seconds; ~0 is steady).
//
//   npm run build && node scripts/probe-jitter.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 4191;
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
    for (let r = 10; r < 160 && out.length < 40; r += 7) for (let a = 0; a < 6.28 && out.length < 40; a += 0.7) {
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      for (let y = 6; y < 60; y++) {
        if (g.gen.densityAt(x, y, z) < -0.5 && g.gen.densityAt(x, y + 1.9, z) < -0.3 && g.gen.densityAt(x, y - 1, z) > 0 && g.gen.height(x, z) > y + 6) { out.push([x, y, z]); break; }
      }
    }
    return out;
  });
  console.log('spots', spots.length);
  const results = [];
  for (const [x, y, z] of spots) {
    await page.evaluate(([x, y, z]) => { const g = __game; g.vitals.hp = g.vitals.maxHp; g.player.teleport(x, y, z); }, [x, y, z]);
    await settle();
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, ys = [], gr = [];
      for (let i = 0; i < 60; i++) g.simulate(1 / 60);
      for (let i = 0; i < 120; i++) { g.simulate(1 / 60); ys.push(p.y); gr.push(p.grounded ? 1 : 0); }
      let tv = 0; for (let i = 1; i < ys.length; i++) tv += Math.abs(ys[i] - ys[i - 1]);
      const mat = g.field.materialNear(p.x, p.y - 0.3, p.z);
      return { tv: +tv.toFixed(3), minY: Math.min(...ys), maxY: Math.max(...ys), grounded: gr.reduce((a, b) => a + b, 0), mat, pos: [p.x, p.y, p.z].map(v => +v.toFixed(2)), crouch: p.crouching };
    });
    results.push(r);
  }
  results.sort((a, b) => b.tv - a.tv);
  for (const r of results.slice(0, 12)) console.log(JSON.stringify(r));
} finally { await browser.close(); server.kill(); }
