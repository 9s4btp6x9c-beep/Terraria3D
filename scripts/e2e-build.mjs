// End-to-end check of building with the Builder's Hammer in a real browser:
// a house built by aiming and clicking like a player (level foundations on
// a slope, walls, doorway and door, a second storey, a pitched roof with
// gables), then comfort and resting, taking pieces down and levelling ground.
// Writes screenshots to e2e-output/.
//
//   npm run build && node scripts/e2e-build.mjs

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });
const PORT = 4181;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', d => { if (String(d).includes(String(PORT))) resolve(); });
  server.on('exit', code => reject(new Error(`preview exited ${code}`)));
  setTimeout(() => reject(new Error('preview timeout')), 20000);
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

async function boot(query) {
  await page.goto(`http://localhost:${PORT}/${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.evaluate(() => {
    // Leave the title screen straight into the game.
    window.__menu.hide();
    window.__game.setMenuMode(false);
    window.__game.paused = false;
    // Software WebGL is slow; drive the simulation with fixed steps instead of real time.
    window.__game.manual = true;
    window.__game.input.locked = true;
  });
}

/** Simulate `seconds` of game time with the given input held. */
async function act(setup, seconds) {
  await page.evaluate(setup);
  await page.evaluate(s => window.__game.simulate(s), seconds);
  await page.evaluate(() => {
    const g = window.__game;
    g.input.keys.clear();
    g.input.lmb = false;
  });
}

/** Let terrain streaming (async workers) catch up after a teleport. */
async function settle() {
  await page.waitForFunction(() => {
    __game.simulate(0.05);
    return __game.terrain.complete && __game.terrain.stats.pending === 0;
  }, null, { timeout: 120000, polling: 100 });
}

async function shot(name) {
  await settle();
  await page.evaluate(() => { window.__game.simulate(0.05); window.__game.render(); });
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

try {
  await boot('?new&seed=1337');
  // ------------------------------------------------ building with the hammer
  // A real two-cell house built the way a player does it: aim, click. Level
  // foundations on a slope, walls stacked on them, a doorway with a door, a
  // second storey, a pitched roof with gables, then comfort and resting.
  const site = await page.evaluate(site_index => {
    const g = __game, s = g.gen.spawn;
    g.combat.spawning = false;
    g.combat.clear();
    // A gently sloping, tree-free spot near spawn.
    let best = null;
    for (let i = 0; i < 1600; i++) {
      const x = Math.floor((s.x - 40 + (i % 40) * 2) / 2) * 2, z = Math.floor((s.z - 40 + Math.floor(i / 40) * 2) / 2) * 2;
      const hs = [[0, 0], [4, 0], [0, 4], [4, 4]].map(([a, b]) => g.gen.height(x + a, z + b));
      const slope = Math.max(...hs) - Math.min(...hs);
      if (g.veg.treesNear(x + 2, z + 2, 7).length || g.gen.lakeAt(x + 2, z + 2) || Math.min(...hs) < g.field.cfg.seaLevel + 2) continue;
      (window.__sites ??= []).push({ x, z, slope, score: Math.abs(slope - 1.4) });
    }
    window.__sites.sort((a, b) => a.score - b.score);
    // SITE picks another plot (to try the build on different ground).
    best = window.__sites[site_index * 7] ?? window.__sites[0];
    const i = g.inventory.slots.findIndex(q => q && q.id === 'builder_hammer');
    g.inventory.swap(i, 0); g.inventory.select(0);
    g.inventory.add('wood', 400);
    g.atmosphere.timeOfDay = 0.4;
    // Aim the camera through a world point from the current eye and click once.
    window.__aimClick = (tx, ty, tz, alt = false) => {
      g.simulate(0.02);
      const e = g.camera.position;
      g.player.yaw = Math.atan2(-(tx - e.x), -(tz - e.z));
      g.player.pitch = Math.atan2(ty - e.y, Math.hypot(tx - e.x, tz - e.z));
      g.simulate(0.02);
      if (alt) g.input.interact(); else g.input.setUse(true);
      g.simulate(0.03);
      g.input.setUse(false);
      g.simulate(0.02);
    };
    window.__stand = (x, y, z) => { g.player.teleport(x, y, z); g.player.vy = 0; };
    return best;
  }, Number(process.env.SITE ?? 0));
  await page.evaluate(({ x, z }) => { __game.player.teleport(x + 2, __game.gen.height(x + 2, z - 4) + 1, z - 4); }, site);
  await settle();
  const built = await page.evaluate(({ x: x0, z: z0, debug }) => {
    const g = __game, S = g.structures;
    const count = shape => [...S.pieces.values()].filter(p => p.shape === shape && p.x > x0 - 0.5 && p.x < x0 + 4.5 && p.z > z0 - 0.5 && p.z < z0 + 4.5).length;
    const at = (shape, x, z) => [...S.pieces.values()].find(p => p.shape === shape && Math.abs(p.x - x) < 0.01 && Math.abs(p.z - z) < 0.01);
    const choose = (shape, turn = 0) => { g.interaction.build = { shape, texture: 'planks' }; g.interaction.turn = turn; };
    const out = {};
    // 1. Foundations on the slope (standing south of the plot).
    choose('foundation');
    const surf = (x, z) => g.field.raycast(x, 150, z, 0, -1, 0, 150).y;
    for (const [cx, cz] of [[1, 3], [3, 3], [1, 1], [3, 1]]) {
      __stand(x0 + cx, surf(x0 + cx, z0 + cz - 4) + 0.2, z0 + cz - 4);
      __aimClick(x0 + cx + 0.1, surf(x0 + cx + 0.1, z0 + cz + 0.1), z0 + cz + 0.1);
      if (debug) { const a = g.interaction.aim; (out.dbg ??= []).push([cx, cz, a?.kind, a && +a.hit.x.toFixed(2), a && +a.hit.y.toFixed(2), a && +a.hit.z.toFixed(2), g.interaction.modeLabel(), [...S.pieces.values()].filter(p => Math.abs(p.x - x0) < 9 && Math.abs(p.z - z0) < 9).map(p => `${p.shape}@${p.x},${p.y},${p.z} e${p.ext}`).join(";"), [x0, z0], +g.player.x.toFixed(1), +g.player.y.toFixed(1), +g.player.z.toFixed(1)]); }
    }
    const fs = [[1, 1], [3, 1], [1, 3], [3, 3]].map(([cx, cz]) => at('foundation', x0 + cx, z0 + cz));
    out.foundations = fs.filter(Boolean).length;
    out.level = fs.every(f => f && Math.abs(f.y - fs[0].y) < 0.01);
    out.footing = Math.max(...fs.map(f => f?.ext ?? 0));
    const top = fs[0] ? fs[0].y + 0.5 : 0;
    // 2. Walls around the outside from a raised vantage (so the foundation top is visible).
    const edges = [[1, 0, 'doorway'], [3, 0, 'window'], [1, 4, 'wall'], [3, 4, 'wall'], [0, 1, 'wall'], [0, 3, 'wall'], [4, 1, 'wall'], [4, 3, 'window']];
    for (const [ex, ez, shape] of edges) {
      choose(shape);
      const inX = ex === 0 ? 0.25 : ex === 4 ? -0.25 : 0, inZ = ez === 0 ? 0.25 : ez === 4 ? -0.25 : 0;
      __stand(x0 + 2, top + 4, z0 + 2);
      __aimClick(x0 + ex + inX, top + 0.01, z0 + ez + inZ);
    }
    out.walls = count('wall') + count('doorway') + count('window');
    out.wallsOnTop = [...S.pieces.values()].filter(p => ['wall', 'doorway', 'window'].includes(p.shape) && Math.abs(p.x - x0 - 2) < 2.5 && Math.abs(p.z - z0 - 2) < 2.5).every(p => Math.abs(p.y - top) < 0.01);
    // 3. Stack a second wall on a wall by aiming at its face (anywhere on it).
    choose('wall');
    __stand(x0 + 1, top + 1, z0 + 7.5);
    __aimClick(x0 + 1.3, top + 1.1, z0 + 4.1);
    const stacked = [...S.pieces.values()].find(p => p.shape === 'wall' && Math.abs(p.x - x0 - 1) < 0.01 && Math.abs(p.z - z0 - 4) < 0.01 && p.y > top + 1);
    out.stackedAt = stacked ? +(stacked.y - top).toFixed(2) : null;
    if (stacked) S.remove(stacked.id);
    // 4. Upper floor on the wall tops (aim at the top of the south wall from above, facing north).
    choose('floor');
    for (const [cx, cz] of [[1, 1], [3, 1], [1, 3], [3, 3]]) {
      const south = cz === 1;
      __stand(x0 + cx, top + 5, south ? z0 - 1.5 : z0 + 5.5);
      __aimClick(x0 + cx + 0.1, top + 2.5 + 0.001, south ? z0 + 0.05 : z0 + 3.95);
    }
    const upper = [[1, 1], [3, 1], [1, 3], [3, 3]].map(([cx, cz]) => [...S.pieces.values()].find(p => p.shape === 'floor' && Math.abs(p.x - x0 - cx) < 0.01 && Math.abs(p.z - z0 - cz) < 0.01));
    out.upperFloors = upper.filter(f => f && Math.abs(f.y - (top + 2.5)) < 0.01).length;
    for (const f of upper) if (f) S.remove(f.id); // make way for the roof
    // 5. Pitched roof: south row rises north, north row rises south; both rest on the wall tops.
    choose('roof');
    for (const [cx, cz, fromZ] of [[1, 1, -3], [3, 1, -3], [1, 3, 7], [3, 3, 7]]) {
      __stand(x0 + cx, top + 5, z0 + fromZ);
      __aimClick(x0 + cx + 0.1, top + 2.5 + 0.001, cz === 1 ? z0 + 0.05 : z0 + 3.95);
    }
    const roofs = [...S.pieces.values()].filter(p => p.shape === 'roof' && Math.abs(p.x - x0 - 2) < 2.5 && Math.abs(p.z - z0 - 2) < 2.5);
    out.roofs = roofs.length;
    out.roofOnWalls = roofs.every(r => Math.abs(r.y - (top + 2.5)) < 0.01);
    // 6. Gables on the east and west ends, high side toward the ridge.
    choose('gable');
    for (const [ex, ez] of [[0, 1], [0, 3], [4, 1], [4, 3]]) {
      let turn = 0;
      for (const t of [0, 1]) {
        const pl = S.place('gable', x0 + ex, top + 2.5, z0 + ez, 0, 1, 0, 0, { turn: t });
        const probe = { shape: 'gable', x: pl.x, y: pl.y, z: pl.z, rot: pl.rot };
        if (window.__pieceSDF(probe, x0 + ex, pl.y + 1.7, z0 + 2 + (ez === 1 ? -0.1 : 0.1)) < 0) turn = t;
      }
      g.interaction.turn = turn;
      __stand(x0 + ex + (ex === 0 ? -4 : 4), top + 4, z0 + ez);
      __aimClick(x0 + ex + (ex === 0 ? -0.05 : 0.05), top + 2.5 + 0.001, z0 + ez + 0.1);
    }
    out.gables = count('gable');
    return out;
  }, { ...site, debug: !!process.env.DEBUG });
  check('foundations lie level on a slope and reach down into it', built.foundations === 4 && built.level && built.footing > 0.5, JSON.stringify(built));
  check('walls, a doorway and windows snap onto the foundations', built.walls === 8 && built.wallsOnTop, JSON.stringify(built));
  check('a wall aimed at the middle of another wall stacks on top of it', built.stackedAt === 2.5, JSON.stringify(built));
  check('floors aimed at wall tops make an upper storey', built.upperFloors === 4, JSON.stringify(built));
  check('a pitched roof and gables rest on the wall tops', built.roofs === 4 && built.roofOnWalls && built.gables === 4, JSON.stringify(built));
  const home = await page.evaluate(({ x: x0, z: z0 }) => {
    const g = __game;
    const f = [...g.structures.pieces.values()].find(p => p.shape === 'foundation' && Math.abs(p.x - x0 - 1) < 0.01 && Math.abs(p.z - z0 - 1) < 0.01);
    const top = f.y + 0.5;
    // Hang a door in the doorway by aiming the door item at it.
    g.inventory.add('door', 1);
    const i = g.inventory.slots.findIndex(q => q && q.id === 'door');
    g.inventory.swap(i, 1); g.inventory.select(1);
    __stand(x0 + 1, top + 0.2, z0 - 3);
    __aimClick(x0 + 1.75, top + 1.2, z0 - 0.12);
    const door = [...g.furniture.items.values()].find(d => d.type === 'door' && Math.abs(d.x - x0 - 1) < 0.01 && Math.abs(d.z - z0) < 0.01);
    // Furnish: a Hearth, a bed, a chair and a lamp.
    g.furniture.add({ type: 'hearth', x: x0 + 3, y: top, z: z0 + 3.4, rot: 2 });
    g.furniture.add({ type: 'bed', x: x0 + 1, y: top, z: z0 + 2.6, rot: 0 });
    g.furniture.add({ type: 'chair', x: x0 + 3.2, y: top, z: z0 + 1.2, rot: 2 });
    g.furniture.add({ type: 'torch', x: x0 + 0.3, y: top + 1.5, z: z0 + 1, rot: 0, wall: [1, 0, 0] });
    __stand(x0 + 2.6, top + 0.1, z0 + 1.6);
    g.simulate(0.2);
    for (let t = 0; t < 12; t += 0.25) g.simulate(0.25);
    return { door: !!door, doorY: door ? +(door.y - top).toFixed(2) : null, rested: Math.round(g.rested), comfort: g.comfort, buff: document.querySelector('#buffs').textContent };
  }, site);
  check('a door dropped at a doorway snaps into it', home.door && home.doorY === 0, JSON.stringify(home));
  check('resting by the Hearth under the roof makes you Rested', home.rested > 0 && home.comfort >= 4 && /Rested/.test(home.buff), JSON.stringify(home));
  await page.evaluate(({ x: x0, z: z0 }) => {
    const g = __game;
    g.player.teleport(x0 + 2.2, g.gen.height(x0 + 2, z0 - 5) + 1.5, z0 - 6.5);
    g.player.yaw = Math.atan2(-(x0 + 2 - g.player.x), -(z0 + 2 - g.player.z)); g.player.pitch = 0.05;
  }, site);
  await shot('30-house-built');
  await page.evaluate(({ x: x0, z: z0 }) => {
    const g = __game;
    const f = [...g.structures.pieces.values()].find(p => p.shape === 'foundation' && Math.abs(p.x - x0 - 1) < 0.01);
    g.player.teleport(x0 + 1, f.y + 0.6, z0 + 0.8);
    g.player.yaw = Math.atan2(-(x0 + 3 - g.player.x), -(z0 + 3.4 - g.player.z)); g.player.pitch = -0.15;
    g.atmosphere.timeOfDay = 0.9;
  }, site);
  await shot('31-house-inside');
  await page.evaluate(() => { __game.atmosphere.timeOfDay = 0.4; });
  // Take a wall down with the hammer: it disappears and refunds its wood.
  const down = await page.evaluate(({ x: x0, z: z0 }) => {
    const g = __game;
    const i = g.inventory.slots.findIndex(q => q && q.id === 'builder_hammer');
    g.inventory.select(i);
    const w = [...g.structures.pieces.values()].find(p => p.shape === 'wall' && Math.abs(p.x - x0 - 3) < 0.01 && Math.abs(p.z - z0 - 4) < 0.01);
    const ground = g.field.raycast(x0 + 3, w.y + 20, z0 + 6.5, 0, -1, 0, 40);
    __stand(x0 + 3, Math.max(w.y, ground ? ground.y : w.y) + 0.2, z0 + 6.5);
    const wood = g.inventory.count('wood') + g.pickups.serialize().filter(p => p.id === 'wood').reduce((a, p) => a + p.count, 0);
    __aimClick(x0 + 3.1, w.y + 1.2, z0 + 4.1, true);
    g.simulate(1.5);
    const after = g.inventory.count('wood') + g.pickups.serialize().filter(p => p.id === 'wood').reduce((a, p) => a + p.count, 0);
    return { gone: !g.structures.pieces.has(w.id), refund: after - wood };
  }, site);
  check('the hammer takes pieces down for a full refund', down.gone && down.refund === 3, JSON.stringify(down));
  // Level ground: a slope flattens to the height of your feet.
  const level = await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    let best = null;
    for (let i = 0; i < 300; i++) {
      const x = s.x - 50 + Math.random() * 100, z = s.z - 50 + Math.random() * 100;
      const d = Math.abs(g.gen.height(x + 2, z) - g.gen.height(x - 2, z));
      if (d > 0.8 && d < 2.5 && !g.structures.near(x, g.gen.height(x, z), z, 6).length && !best) best = { x, z };
    }
    const { x, z } = best;
    g.interaction.build = { shape: 'level', texture: 'planks' };
    __stand(x, g.gen.height(x, z) + 0.5, z + 4);
    g.simulate(0.5);
    const feet = Math.round(g.player.y * 4) / 4;
    const surf = (px, pz) => g.field.raycast(px, feet + 6, pz, 0, -1, 0, 14)?.y ?? NaN;
    const edits = g.log.edits.length;
    __aimClick(x, surf(x, z), z);
    const e = g.log.edits[g.log.edits.length - 1];
    if (g.log.edits.length === edits) return { committed: false, why: g.interaction.modeLabel() };
    // Measure across the levelled disc, before (from the pure generator) and after.
    const xs = [-1.5, 0, 1.5].map(d => e[1] + d);
    const before = xs.map(px => g.gen.surfaceAt(px, e[3])?.y ?? NaN), after = xs.map(px => surf(px, e[3]));
    const spread = a => Math.max(...a) - Math.min(...a);
    return { before: before.map(v => +v.toFixed(2)), after: after.map(v => +v.toFixed(2)), feet, flatter: spread(after) < 0.35 && Math.abs(after[1] - feet) < 0.35 };
  });
  check('level ground flattens a slope to your feet', level.flatter, JSON.stringify(level));

  // The build menu opens with [Q] while holding the hammer, and choosing a card selects it.
  const menu = await page.evaluate(() => {
    const g = __game;
    g.interaction.build = { shape: 'wall', texture: 'planks' };
    g.input.tap('KeyQ'); g.simulate(0.05);
    const open = g.buildMenu.open && getComputedStyle(document.querySelector('#buildmenu')).display !== 'none';
    const cards = document.querySelectorAll('#buildmenu [data-piece]').length;
    return { open, cards };
  });
  await page.screenshot({ path: `${OUT}/32-build-menu.png` });
  await page.click('#buildmenu [data-piece="window"]');
  const picked = await page.evaluate(() => ({ shape: __game.interaction.build.shape, open: __game.buildMenu.open }));
  check('the build menu lists every piece and picks one', menu.open && menu.cards >= 15 && picked.shape === 'window' && !picked.open, JSON.stringify({ ...menu, ...picked }));
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
