// Close-ups for visual review of recent changes (fossils, lake shores, caves,
// torches and windows at night, cliff lighting, a tree mid-shake).
//
//   npm run build && node scripts/review-shots.mjs

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output/review';
mkdirSync(OUT, { recursive: true });
const PORT = 4196;
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
const shot = async name => { await settle(); await page.evaluate(() => { __game.simulate(0.05); __game.render(); }); await page.screenshot({ path: `${OUT}/${name}.png` }); };
/** Stand `dist` from a target point on the ground and look at it. */
const lookAt = (t, dist, yaw = 0, up = 2) => page.evaluate(({ t, dist, yaw, up }) => {
  const g = __game, x = t[0] + Math.sin(yaw) * dist, z = t[2] + Math.cos(yaw) * dist;
  const y = Math.max(g.gen.height(x, z), t[1] - 3) + up;
  g.player.teleport(x, y, z);
  g.player.yaw = Math.atan2(x - t[0], z - t[2]);
  g.player.pitch = Math.atan2(t[1] - (y + 1.6), dist);
  g.vitals.hp = g.vitals.maxHp;
}, { t, dist, yaw, up });

try {
  await page.goto(`http://localhost:${PORT}/?new&seed=1337`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.evaluate(() => { __menu.hide(); __game.setMenuMode(false); __game.manual = true; __game.input.locked = true; __game.combat.spawning = false; __game.atmosphere.timeOfDay = 0.4; __game.atmosphere.cycle = false; __game.inventory.select(8); });
  const targets = await page.evaluate(() => {
    const g = __game.gen, s = g.spawn;
    const rib = g.features.filter(f => f.mat === 24 && f.ra < 1.2).sort((a, b) => Math.hypot(a.ax - s.x, a.az - s.z) - Math.hypot(b.ax - s.x, b.az - s.z))[0];
    const lake = g.lakes.slice().sort((a, b) => a.r - b.r)[0];
    return { rib: rib && [(rib.ax + rib.bx) / 2, (rib.ay + rib.by) / 2, (rib.az + rib.bz) / 2], lake: lake && [lake.x, lake.level, lake.z, lake.r] };
  });
  if (targets.rib) {
    for (const [i, yaw] of [[0, 0.8], [1, 2.6], [2, 4.4]]) {
      await page.evaluate(({ t, yaw }) => {
        const g = __game;
        // Back off until the eye is in open air.
        for (let dist = 10; dist < 40; dist += 2) {
          const x = t[0] + Math.sin(yaw) * dist, z = t[2] + Math.cos(yaw) * dist, y = g.gen.height(x, z) + 2;
          if (g.gen.densityAt(x, y + 1.6, z) < -1 && g.gen.densityAt(x, y + 0.5, z) < -0.5) {
            g.player.teleport(x, y, z); g.player.yaw = Math.atan2(x - t[0], z - t[2]); g.player.pitch = Math.atan2(t[1] - (y + 1.6), dist); return;
          }
        }
      }, { t: targets.rib, yaw });
      await shot(`fossil${i}`);
    }
  }
  if (targets.lake) {
    const [x, y, z, r] = targets.lake;
    await lookAt([x, y, z], r + 5, 0.3, 2.5); await shot('lake-shore');
    await lookAt([x, y, z], r + 3, 2.2, 1.5); await shot('lake-shore2');
  }
  // Cave mouths and sinkholes (caves v2), seen from outside; then a big cavern from inside.
  for (const kind of ['mouth', 'sinkhole']) {
    const ok = await page.evaluate(kind => {
      const g = __game, s = g.gen.spawn;
      const m = g.gen.mouths.filter(m => m.kind === kind).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
      if (!m) return false;
      const a = 0.7, d = kind === 'mouth' ? 13 : 9, x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      for (const t of g.veg.treesNear(m.x, m.z, 18)) t.alive = false;
      g.vegRenderer.treesDirty = true;
      g.player.teleport(x, g.gen.height(x, z) + (kind === 'mouth' ? 2 : 3), z);
      g.player.yaw = Math.atan2(x - m.x, z - m.z); g.player.pitch = kind === 'mouth' ? -0.3 : -0.75;
      g.vitals.hp = g.vitals.maxHp;
      return true;
    }, kind);
    if (ok) await shot(`cave-${kind}`);
  }
  await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    // The roomiest air pocket near spawn: most open space around a point.
    let best = null;
    for (let i = 0; i < 3000; i++) {
      const x = s.x + (Math.random() - 0.5) * 200, z = s.z + (Math.random() - 0.5) * 200, y = 20 + Math.random() * 40;
      if (g.gen.height(x, z) < y + 14 || g.gen.densityAt(x, y, z) > -1 || g.gen.densityAt(x, y - 1.6, z) < 0) continue;
      let open = 0;
      for (let k = 0; k < 16; k++) { const a = k / 16 * 6.28; for (let r = 2; r < 24; r += 2) { if (g.gen.densityAt(x + Math.cos(a) * r, y + 1.5, z + Math.sin(a) * r) > 0) break; open++; } }
      if (!best || open > best.open) best = { x, y, z, open };
    }
    g.player.teleport(best.x, best.y - 1, best.z); g.player.pitch = 0.05;
    g.vitals.hp = g.vitals.maxHp;
    g.inventory.select(4);
  });
  await shot('cavern');
  // A cliff base: the steepest slope near spawn, seen from its foot.
  const cliff = await page.evaluate(() => {
    const g = __game.gen, s = g.spawn;
    let best = null;
    for (let i = 0; i < 4000; i++) {
      const x = s.x + (Math.random() - 0.5) * 240, z = s.z + (Math.random() - 0.5) * 240;
      const h = g.height(x, z), hx = g.height(x + 3, z);
      const d = Math.abs(hx - h);
      if (h > g.cfg.seaLevel + 2 && (!best || d > best.d)) best = { d, x: hx > h ? x : x + 3, z, dir: hx > h ? 1 : -1 };
    }
    return best;
  });
  await page.evaluate(c => { const g = __game; const x = c.x - c.dir * 8; g.player.teleport(x, g.gen.height(x, c.z) + 1, c.z); g.player.yaw = c.dir > 0 ? -Math.PI / 2 : Math.PI / 2; g.player.pitch = 0.2; }, cliff);
  await shot('cliff-base');
  // Tree shake: hit the nearest tree with an axe and capture mid-wobble.
  await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    const t = g.veg.treesNear(s.x, s.z, 40).filter(t => t.alive && t.kind === 'tall')[0];
    g.player.teleport(t.x + 4, g.gen.height(t.x + 4, t.z) + 1, t.z);
    g.player.yaw = Math.PI / 2; g.player.pitch = 0.35;
    g.wobble.set(t.id, 0);
  });
  await settle();
  for (const [i, dt] of [[0, 0.02], [1, 0.03], [2, 0.03]]) {
    await page.evaluate(dt => { __game.simulate(dt); __game.render(); }, dt);
    await page.screenshot({ path: `${OUT}/tree-shake-${i}.png` });
  }
  // Night: a little hut with a window, a door and torches.
  await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    g.atmosphere.timeOfDay = 0.96;
    const x = Math.round(s.x / 2) * 2 + 10, z = Math.round(s.z / 2) * 2, y = g.gen.height(x + 1, z + 1) + 0.2;
    for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) g.structures.add({ shape: 'foundation', texture: 'planks', x: x + dx + 1, y, z: z + dz + 1, rot: 0, ext: 1 });
    const top = y + 0.5;
    g.structures.add({ shape: 'window', texture: 'planks', x: x + 1, y: top, z, rot: 0 });
    g.structures.add({ shape: 'wall', texture: 'planks', x: x + 3, y: top, z, rot: 0 });
    g.structures.add({ shape: 'window', texture: 'planks', x: x + 4, y: top, z: z + 1, rot: 1 });
    g.structures.add({ shape: 'wall', texture: 'planks', x: x + 4, y: top, z: z + 3, rot: 1 });
    g.furniture.add({ type: 'torch', x: x + 1, y: top, z: z + 2, rot: 0 });
    g.furniture.add({ type: 'torch', x: x + 3, y: top, z: z + 3, rot: 0 });
    g.furniture.add({ type: 'hearth', x: x + 2.6, y: top, z: z + 1.2, rot: 2 });
    for (const t of g.veg.treesNear(x + 2, z + 2, 12)) t.alive = false;
    g.vegRenderer.treesDirty = true;
    g.player.teleport(x + 1, g.gen.height(x + 1, z - 3.5) + 1, z - 3.5);
    g.player.yaw = Math.PI; g.player.pitch = -0.05;
  });
  await settle();
  await page.evaluate(() => { for (let i = 0; i < 20; i++) __game.simulate(0.05); });
  await shot('night-hut');
  // A cave wall with ore.
  await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    g.atmosphere.timeOfDay = 0.4;
    for (let r = 10; r < 160; r += 5) for (let a = 0; a < 6.28; a += 0.4) {
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      for (let y = 20; y < 50; y++) {
        if (g.gen.densityAt(x, y, z) < -1 && g.gen.densityAt(x, y - 1.2, z) > 0 && g.gen.height(x, z) > y + 10) {
          for (let k = 0; k < 12; k++) { const b = k / 12 * 6.28; const h = g.field.raycast(x, y + 1.5, z, Math.sin(b), 0, Math.cos(b), 8); if (h && [7, 8].includes(h.material)) { g.player.teleport(x, y, z); g.player.yaw = Math.atan2(-Math.sin(b), -Math.cos(b)); g.player.pitch = -0.1; return; } }
        }
      }
    }
  });
  await shot('cave-ore');
  console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
