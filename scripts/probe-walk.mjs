// Probe: sprint in straight lines across the land from spawn (no jumping) and
// report how far the player gets and how often they stall on the terrain.
//
//   npm run build && node scripts/probe-walk.mjs [seed]

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 4200;
const seed = Number(process.argv[2] ?? 1337);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', d => { if (String(d).includes(String(PORT))) res(); }); setTimeout(() => rej(new Error('timeout')), 20000); });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', e => console.log('ERR', String(e)));
try {
  await page.goto(`http://localhost:${PORT}/?new&seed=${seed}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.evaluate(d => { window.__diag = d; }, !!process.env.K);
  await page.evaluate(() => { __menu.hide(); __game.setMenuMode(false); __game.paused = false; __game.manual = true; __game.input.locked = true; __game.combat.spawning = false; });
  const settle = () => page.waitForFunction(() => { __game.simulate(0.05); return __game.terrain.complete && __game.terrain.stats.pending === 0; }, null, { timeout: 120000, polling: 100 });
  let total = 0, stalls = 0, runs = 0;
  const rows = [];
  for (const k of (process.env.K ? process.env.K.split(',').map(Number) : [...Array(24).keys()])) {
    const yaw = k / 24 * Math.PI * 2;
    await page.evaluate(() => { const g = __game, s = g.gen.spawn; g.vitals.hp = g.vitals.maxHp; g.player.teleport(s.x, s.y, s.z); });
    await settle();
    const r = await page.evaluate(yaw => {
      const g = __game, p = g.player;
      p.yaw = yaw; p.pitch = 0;
      g.input.keys.add('KeyW'); g.input.keys.add('ShiftLeft');
      const x0 = p.x, z0 = p.z;
      let stalls = 0, slow = 0, lx = p.x, lz = p.z, water = false;
      for (let i = 0; i < 12 * 20; i++) {
        g.simulate(1 / 20);
        p.yaw = yaw;
        if (p.inWater) { water = true; break; }
        if (i % 10 === 9) {
          const moved = Math.hypot(p.x - lx, p.z - lz);
          if (moved < 1.2) { slow++; if (slow === 1) stalls++; } else slow = 0;
          lx = p.x; lz = p.z;
        }
      }
      g.input.keys.clear();
      const out = { dist: +Math.hypot(p.x - x0, p.z - z0).toFixed(1), stalls, water };
      if (window.__diag) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), n = [0, 0, 0], prof = [];
        for (let d = -1; d <= 4; d += 0.5) prof.push((g.gen.height(p.x + fx * d, p.z + fz * d) - p.y).toFixed(2));
        const col = [];
        for (let d = 0.5; d <= 2.5; d += 0.5) { let top = null; for (let y = p.y + 4; y > p.y - 2; y -= 0.1) if (g.field.sample(p.x + fx * d, y, p.z + fz * d) > 0) { top = (y - p.y).toFixed(1); break; } col.push(top); }
        g.collision.distance(p.x, p.y + 0.4, p.z, n);
        Object.assign(out, { pos: [p.x, p.y, p.z].map(v => v.toFixed(1)), biome: g.gen.biomeAt(p.x, p.z), prof: prof.join(' '), col: col.join(' '), foot: n.map(v => v.toFixed(2)).join(','), trees: g.veg.treesNear(p.x, p.z, 1.5).map(t => t.kind) });
      }
      return out;
    }, yaw);
    if (!r.water) { total += r.dist; stalls += r.stalls; runs++; }
    rows.push(r);
    await settle();
  }
  if (process.env.K) for (const r of rows) console.log(JSON.stringify(r));
  console.log(JSON.stringify(rows.map(r => `${r.dist}${r.stalls ? '!' + r.stalls : ''}${r.water ? 'w' : ''}`)));
  console.log(`runs ${runs}  mean distance ${(total / runs).toFixed(1)} m (max ${(8.2 * 12).toFixed(0)})  stalls ${stalls}`);
} finally { await browser.close(); server.kill(); }
