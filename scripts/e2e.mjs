// End-to-end check of the terrain foundation in a real browser (WebGL):
// walk on organic terrain, enter the cave, mine a tunnel, build, save,
// reload, and verify the modifications persisted. Writes screenshots to
// e2e-output/.
//
//   npm run build && npm run e2e

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e-output';
mkdirSync(OUT, { recursive: true });
const PORT = 4179;

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
    document.querySelector('#overlay').style.display = 'none';
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
  const t0 = Date.now();
  await boot('?new&seed=1337');
  console.log(`world loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 1. Organic terrain + walking.
  await shot('01-spawn');
  const start = await page.evaluate(() => ({ x: __game.player.x, y: __game.player.y, z: __game.player.z }));
  await act(() => { __game.input.keys.add('KeyW'); }, 2.5);
  const walked = await page.evaluate(() => ({ x: __game.player.x, y: __game.player.y, z: __game.player.z, g: __game.player.grounded }));
  const dist = Math.hypot(walked.x - start.x, walked.z - start.z);
  check('player walks across terrain', dist > 3, `moved ${dist.toFixed(1)}m, y ${start.y.toFixed(1)} -> ${walked.y.toFixed(1)}`);
  await page.evaluate(() => { __game.player.yaw += 2.2; __game.player.pitch = 0.05; });
  await shot('02-landscape');

  // 2. Enter the real 3D cave (teleport to a point inside the entrance tunnel).
  const cave = await page.evaluate(() => {
    const e = __game.gen.entrance[5];
    __game.player.teleport(e.ax, e.ay - e.r + 0.6, e.az);
    __game.player.yaw = Math.atan2(-(e.bx - e.ax), -(e.bz - e.az));
    __game.player.pitch = -0.1;
    return { x: e.ax, y: e.ay, z: e.az, depth: __game.gen.height(e.ax, e.az) - e.ay };
  });
  await settle();
  await page.evaluate(() => __game.simulate(0.8));
  const inCave = await page.evaluate(() => ({ vis: __game.sky.visibility(__game.player.x, __game.player.y + 1.6, __game.player.z), y: __game.player.y }));
  check('cave interior is underground and enclosed', cave.depth > 4 && inCave.vis < 0.5, `depth ${cave.depth.toFixed(1)}m, sky ${inCave.vis.toFixed(2)}`);
  await shot('03-cave');
  await page.evaluate(() => {
    const g = __game, c = g.gen.entrance.at(-1);
    g.player.teleport(c.ax, c.ay - c.r + 1, c.az);
    g.player.yaw = 0.8; g.player.pitch = 0.1;
  });
  await shot('03b-cave-chamber');
  await page.evaluate(() => {
    const e = __game.gen.entrance[5];
    __game.player.teleport(e.ax, e.ay - e.r + 0.6, e.az);
    __game.player.yaw = Math.atan2(-(e.bx - e.ax), -(e.bz - e.az));
    __game.player.pitch = -0.1;
  });
  await settle();
  await page.evaluate(() => __game.simulate(0.2));

  // 3-5. Mine into the cave wall and dig a tunnel by holding the pickaxe while walking.
  const before = await page.evaluate(() => {
    __game.inventory.select(0);
    const d = new window.__game.camera.position.constructor(0, 0, -1).applyQuaternion(__game.camera.quaternion);
    const hit = __game.field.raycast(__game.camera.position.x, __game.camera.position.y, __game.camera.position.z, d.x, d.y, d.z, 10);
    return { hit: hit && { x: hit.x, y: hit.y, z: hit.z, d: hit.distance }, edits: __game.log.edits.length };
  });
  // Turn to face a wall: pick the horizontal direction with the nearest wall.
  await page.evaluate(() => {
    const g = __game, p = g.camera.position;
    let best = 0, bestD = 99;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const h = g.field.raycast(p.x, p.y - 0.4, p.z, -Math.sin(a), 0, -Math.cos(a), 12);
      if (h && h.distance < bestD) { bestD = h.distance; best = a; }
    }
    g.player.yaw = best; g.player.pitch = -0.15;
  });
  const solidNear = () => page.evaluate(() => {
    const g = __game, p = g.player;
    let n = 0;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (let a = 0.5; a < 5; a += 0.5)
      for (let dy = 0; dy < 2; dy += 0.5)
        for (let s = -1; s <= 1; s += 0.5)
          if (g.field.sample(p.x + fx * a - fz * s, p.y + 0.5 + dy, p.z + fz * a + fx * s) > 0) n++;
    return n;
  });
  const solidBefore = await solidNear();
  await act(() => { __game.input.lmb = true; __game.input.keys.add('KeyW'); }, 9);
  const after = await page.evaluate(() => ({
    edits: __game.log.edits.length,
    inv: __game.inventory.serialize().filter(Boolean).map(s => `${s.id}:${s.count}`).join(' '),
  }));
  check('mining removes terrain (edit log grows)', after.edits > before.edits + 3, `${after.edits - before.edits} edits`);
  // Walk back to where we started digging and look at the tunnel we made.
  const solidAfter = await page.evaluate(({ x, z }) => {
    const g = __game;
    let n = 0;
    for (let yy = -1; yy < 3; yy += 0.5) if (g.field.sample(x, g.player.y + 0.5 + yy * 0.5, z) > 0) n++;
    return n;
  }, await page.evaluate(() => ({ x: __game.player.x, z: __game.player.z })));
  check('a walkable tunnel was dug (player advanced into rock)', solidAfter === 0 && solidBefore > 10, `solid ahead before ${solidBefore}, at new position ${solidAfter}`);
  check('resources collected', /stone|dirt|copper|clay/.test(after.inv), after.inv);
  await page.evaluate(() => { __game.player.yaw += Math.PI; });
  await shot('04-tunnel-back');
  await page.evaluate(() => { __game.player.yaw -= Math.PI; });
  await shot('05-tunnel-face');

  // 6. Place a structure on the surface at spawn.
  const built = await page.evaluate(async () => {
    const g = __game, s = g.gen.spawn;
    g.player.teleport(s.x, s.y, s.z);
    g.player.pitch = -0.7;
    const wood = g.inventory.slots.findIndex(x => x && x.id === 'wood');
    g.inventory.swap(wood, 2);
    g.inventory.select(2);
    return g.structures.pieces.size;
  });
  await act(() => { __game.input.lmb = true; }, 0.4);
  await page.evaluate(() => { __game.interaction.cycleMode(); __game.player.pitch = -0.35; });
  await act(() => { __game.input.lmb = true; }, 0.3);
  await page.evaluate(() => { __game.player.yaw += 1.6; });
  await act(() => { __game.input.lmb = true; }, 0.3);
  const pieces = await page.evaluate(() => __game.structures.pieces.size);
  check('building pieces placed', pieces > built, `${pieces} pieces`);
  await page.evaluate(() => { const g = __game; g.player.teleport(g.player.x + 5, g.player.y + 1, g.player.z + 5); g.player.yaw = Math.PI * 0.25; g.player.pitch = -0.3; });
  await shot('06-structure');

  // 7. Save.
  const saved = await page.evaluate(() => {
    const g = __game;
    g.saveGame();
    return { edits: g.log.edits.length, pieces: g.structures.pieces.size, probe: g.log.edits.at(-1) };
  });

  // 8. Reload from the save and verify the world state matches.
  await boot('?continue=1');
  const loaded = await page.evaluate(({ probe }) => {
    const g = __game;
    return { edits: g.log.edits.length, pieces: g.structures.pieces.size, density: g.field.sample(probe[1], probe[2], probe[3]) };
  }, { probe: saved.probe });
  check('reload restores terrain edits', loaded.edits === saved.edits && loaded.density < 0, `${loaded.edits} edits, density at last edit ${loaded.density.toFixed(2)}`);
  check('reload restores structures', loaded.pieces === saved.pieces, `${loaded.pieces} pieces`);
  await shot('07-reloaded');

  // Extra views for visual review.
  await page.evaluate(() => {
    const g = __game, i = g.gen.islands[0];
    g.player.teleport(i.x + 40, g.gen.height(i.x + 40, i.z) + 1.5, i.z);
    g.player.yaw = Math.PI / 2; g.player.pitch = 0.25;
  });
  await shot('08-sky-island');
  await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    g.player.teleport(s.x - 30, g.gen.height(s.x - 30, s.z - 30) + 30, s.z - 30);
    g.player.yaw = -Math.PI * 0.75; g.player.pitch = -0.35;
  });
  await shot('09-overview');

  // ---------------------------------------------------------------- gameplay
  await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    g.player.teleport(s.x, s.y, s.z); g.player.pitch = -0.95;
    for (const [id, n] of [['wood', 80], ['stone', 60], ['gel', 20], ['iron_bar', 12], ['copper_bar', 6], ['sand', 6]]) g.inventory.add(id, n);
  });
  await settle();
  const crafted = await page.evaluate(() => {
    const g = __game;
    const ok = g.craftItem('workbench');
    g.inventory.swap(g.inventory.slots.findIndex(s => s && s.id === 'workbench'), 3);
    g.inventory.select(3);
    return ok;
  });
  check('craft a workbench by hand', crafted);
  await act(() => { __game.input.lmb = true; }, 0.3);
  const benchPlaced = await page.evaluate(() => {
    const g = __game;
    return { n: g.furniture.items.size, st: [...g.furniture.stationsNear(g.player.x, g.player.y + 1, g.player.z)] };
  });
  check('place the workbench (station nearby)', benchPlaced.n === 1 && benchPlaced.st.includes('workbench'), JSON.stringify(benchPlaced));
  const more = await page.evaluate(() => {
    const g = __game;
    const r = ['furnace', 'chair', 'table', 'chest', 'anvil', 'wooden_bow', 'wooden_arrow', 'bomb', 'door', 'bed'].map(id => [id, g.craftItem(id)]);
    return Object.fromEntries(r);
  });
  check('craft station-gated items at the workbench', more.furnace && more.chair && more.table && more.chest && more.anvil, JSON.stringify(more));
  // Place a few more pieces of furniture around.
  const placeAt = async (id, yawOffset, pitch = -0.9) => {
    await page.evaluate(({ id, yawOffset, pitch }) => {
      const g = __game;
      const i = g.inventory.slots.findIndex(s => s && s.id === id);
      if (i < 0) return;
      g.inventory.swap(i, 4);
      g.inventory.select(4);
      g.player.yaw += yawOffset; g.player.pitch = pitch;
    }, { id, yawOffset, pitch });
    await act(() => { __game.input.lmb = true; }, 0.35);
  };
  await placeAt('furnace', 1.2);
  await placeAt('anvil', 1.0);
  await placeAt('chest', 1.0);
  await placeAt('torch', 1.2, -0.7);
  await placeAt('chair', 1.0);
  const furnCount = await page.evaluate(() => __game.furniture.items.size);
  check('furniture placed (workbench, furnace, anvil, chest, torch, chair)', furnCount >= 5, `${furnCount} pieces`);
  await page.evaluate(() => {
    const g = __game;
    const f = [...g.furniture.items.values()];
    const cx = f.reduce((s, a) => s + a.x, 0) / f.length, cz = f.reduce((s, a) => s + a.z, 0) / f.length;
    g.player.teleport(cx + 4, g.player.y + 0.5, cz + 4);
    g.player.yaw = Math.atan2(-(cx - g.player.x), -(cz - g.player.z)); g.player.pitch = -0.35;
  });
  await shot('11-furniture');
  await page.evaluate(() => { __game.toggleInventory(true); });
  await shot('12-inventory');
  await page.evaluate(() => { __game.toggleInventory(false); __game.input.locked = true; });

  // Melee combat: a Glob in front of the player, killed with the sword.
  const fight = await page.evaluate(() => {
    const g = __game;
    g.combat.spawning = false;
    g.combat.clear();
    const sw = g.inventory.slots.findIndex(s => s && s.id === 'wooden_sword');
    g.inventory.swap(sw, 5); g.inventory.select(5);
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
    const c = g.spawnCreature('glob', g.player.x + fx * 2.2, g.player.y + 0.3, g.player.z + fz * 2.2);
    g.player.pitch = -0.3;
    return { gel: g.inventory.count('gel'), hp: c.hp, kills: g.combat.kills };
  });
  await act(() => { __game.input.lmb = true; }, 4);
  await page.evaluate(() => __game.simulate(1.5));
  const after2 = await page.evaluate(() => ({ kills: __game.combat.kills, gel: __game.inventory.count('gel'), drops: __game.pickups.count, hp: __game.vitals.hp }));
  check('sword kills a Glob and it drops gel', after2.kills > fight.kills && (after2.gel > fight.gel || after2.drops > 0), `kills ${after2.kills}, gel ${fight.gel} -> ${after2.gel}, pickups ${after2.drops}, player hp ${after2.hp.toFixed(0)}`);

  // Creature lineup for visual review.
  await page.evaluate(() => {
    const g = __game;
    g.combat.clear();
    const ids = ['glob', 'deep_glob', 'shambler', 'gloomwisp', 'duskwing', 'rockmite', 'hollow_miner'];
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw), sx = -fz, sz = fx;
    ids.forEach((id, i) => {
      const o = (i - 3) * 1.6;
      const x = g.player.x + fx * 6 + sx * o, z = g.player.z + fz * 6 + sz * o;
      const top = g.sky.raw[Math.floor(x) + Math.floor(z) * g.sky.w];
      const c = g.spawnCreature(id, x, top + (id === 'gloomwisp' || id === 'duskwing' ? 1.2 : 0.2), z);
      c.yaw = Math.atan2(-fx, -fz);
    });
    g.player.pitch = -0.12;
  });
  await page.evaluate(() => { for (const c of __game.combat.creatures) { c.cooldown = 5; } __game.simulate(0.1); });
  await shot('13-creatures');

  // Night with torches.
  await page.evaluate(() => { const g = __game; g.combat.clear(); g.atmosphere.timeOfDay = 0.93; });
  await page.evaluate(() => __game.simulate(0.5));
  await page.evaluate(() => {
    const g = __game;
    const f = [...g.furniture.items.values()];
    const cx = f.reduce((s, a) => s + a.x, 0) / f.length, cz = f.reduce((s, a) => s + a.z, 0) / f.length;
    g.player.yaw = Math.atan2(-(cx - g.player.x), -(cz - g.player.z)); g.player.pitch = -0.3;
  });
  await shot('14-night');
  await page.evaluate(() => { __game.atmosphere.timeOfDay = 0.4; __game.simulate(0.2); });

  // Far view over the world with the debug readout (LOD + draw stats).
  await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    g.hud.debugVisible = true;
    g.player.teleport(s.x, g.gen.height(s.x, s.z) + 60, s.z);
    g.player.yaw = 0.6; g.player.pitch = -0.25;
  });
  await shot('10-far-view');
  const stats = await page.evaluate(() => ({ ...__game.terrain.stats, calls: __game.renderer.info.render.calls, tris: __game.renderer.info.render.triangles }));
  console.log('render stats', JSON.stringify(stats));
  check('far terrain uses LOD regions', stats.nodes > 10, `${stats.nodes} LOD nodes, ${stats.meshes} visible terrain meshes`);

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
