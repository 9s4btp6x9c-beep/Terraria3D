// Probe: dig tunnels with the pickaxe from cave spots at several pitches,
// then stand still in them (and step back and forth) and report view jitter.
//
//   npm run build && node scripts/probe-tunnel.mjs   (ONLY=2,4 to pick spots)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const PORT = 4194;
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
    for (let r = 10; r < 160 && out.length < 8; r += 11) for (let a = 0; a < 6.28 && out.length < 8; a += 1.1) {
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      for (let y = 8; y < 60; y++) if (g.gen.densityAt(x, y, z) < -0.5 && g.gen.densityAt(x, y + 1.9, z) < -0.3 && g.gen.densityAt(x, y - 1, z) > 0 && g.gen.height(x, z) > y + 6) { out.push([x, y, z]); break; }
    }
    return out;
  });
  const res = [];
  const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
  for (const [i, sp] of spots.entries()) {
    if (only && !only.includes(i)) continue;
    const pitch = [-0.15, 0, -0.35, 0.1][i % 4];
    await page.evaluate(([x, y, z]) => { const g = __game; g.vitals.hp = g.vitals.maxHp; g.player.teleport(x, y, z); g.inventory.select(0); }, sp);
    await settle();
    await page.evaluate(pitch => {
      const g = __game, p = g.camera.position;
      let best = 0, bestD = 99;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) { const h = g.field.raycast(p.x, p.y - 0.4, p.z, -Math.sin(a), 0, -Math.cos(a), 12); if (h && h.distance < bestD) { bestD = h.distance; best = a; } }
      g.player.yaw = best; g.player.pitch = pitch;
      g.input.lmb = true; g.input.keys.add('KeyW');
      for (let t = 0; t < 12; t += 0.05) { g.simulate(0.05); g.player.pitch = pitch; }
      g.input.lmb = false; g.input.keys.clear();
    }, pitch);
    await settle();
    const r = await page.evaluate(() => {
      const g = __game, p = g.player, ys = [];
      for (let i = 0; i < 30; i++) g.simulate(1 / 60);
      const trace = [];
      for (let i = 0; i < 120; i++) { g.simulate(1 / 60); ys.push(p.y + p.eyeHeight); if (i % 3 === 0) trace.push((p.y + p.eyeHeight).toFixed(2) + (p.crouching ? 'C' : '') + (p.grounded ? '' : 'A') + ':' + p.vy.toFixed(1)); }
      let tv = 0; for (let i = 1; i < ys.length; i++) tv += Math.abs(ys[i] - ys[i - 1]);
      // Also walk back and forth a little and check the eye never pops.
      let pops = 0, prev = p.y + p.eyeHeight;
      for (const k of ['KeyS', 'KeyW']) { g.input.keys.add(k); for (let i = 0; i < 40; i++) { g.simulate(1 / 60); const e = p.y + p.eyeHeight; if (Math.abs(e - prev) > 0.12) pops++; prev = e; } g.input.keys.clear(); }
      return { trace: trace, tv: +tv.toFixed(3), pops, crouch: p.crouching, edits: g.log.edits.length, dead: g.vitals.dead };
    });
    res.push(r); console.log(JSON.stringify(r));
  }
} finally { await browser.close(); server.kill(); }
