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
  const furnBefore = await page.evaluate(() => __game.furniture.items.size);
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
  check('place the workbench (station nearby)', benchPlaced.n === furnBefore + 1 && benchPlaced.st.includes('workbench'), JSON.stringify(benchPlaced));
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
  check('furniture placed (workbench, furnace, anvil, chest, torch, chair)', furnCount >= furnBefore + 5, `${furnCount - furnBefore} pieces`);
  const mine = await page.evaluate(n => [...__game.furniture.items.values()].slice(n).map(f => f.uid), furnBefore);
  await page.evaluate(ids => {
    const g = __game;
    const f = [...g.furniture.items.values()].filter(x => ids.includes(x.uid));
    const cx = f.reduce((s, a) => s + a.x, 0) / f.length, cz = f.reduce((s, a) => s + a.z, 0) / f.length;
    g.player.teleport(cx + 4, g.player.y + 0.5, cz + 4);
    g.player.yaw = Math.atan2(-(cx - g.player.x), -(cz - g.player.z)); g.player.pitch = -0.35;
  }, mine);
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
  await page.evaluate(ids => {
    const g = __game;
    const f = [...g.furniture.items.values()].filter(x => ids.includes(x.uid));
    const cx = f.reduce((s, a) => s + a.x, 0) / f.length, cz = f.reduce((s, a) => s + a.z, 0) / f.length;
    g.player.yaw = Math.atan2(-(cx - g.player.x), -(cz - g.player.z)); g.player.pitch = -0.3;
  }, mine);
  await shot('14-night');
  await page.evaluate(() => { __game.atmosphere.timeOfDay = 0.4; __game.simulate(0.2); });

  // ------------------------------------------------------------ housing / NPC
  const house = await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    // Build a 3x2-cell wooden house on a flat patch near spawn (pieces + furniture).
    const x0 = Math.floor((s.x + 8) / 2) * 2, z0 = Math.floor((s.z + 8) / 2) * 2;
    const y = Math.floor((g.sky.raw[Math.floor(x0 + 3) + Math.floor(z0 + 2) * g.sky.w] + 1.2) / 0.25) * 0.25;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      g.structures.add({ shape: 'floor', texture: 'planks', x: x0 + i * 2 + 1, y, z: z0 + j * 2 + 1, rot: 0 });
      g.structures.add({ shape: 'floor', texture: 'planks', x: x0 + i * 2 + 1, y: y + 2.75, z: z0 + j * 2 + 1, rot: 0 });
    }
    for (let i = 0; i < 3; i++) {
      if (i !== 1) g.structures.add({ shape: 'wall', texture: 'planks', x: x0 + i * 2 + 1, y: y + 0.25, z: z0, rot: 0 });
      g.structures.add({ shape: 'wall', texture: 'planks', x: x0 + i * 2 + 1, y: y + 0.25, z: z0 + 4, rot: 0 });
    }
    for (let j = 0; j < 2; j++) {
      g.structures.add({ shape: 'wall', texture: 'planks', x: x0, y: y + 0.25, z: z0 + j * 2 + 1, rot: 1 });
      g.structures.add({ shape: 'wall', texture: 'planks', x: x0 + 6, y: y + 0.25, z: z0 + j * 2 + 1, rot: 1 });
    }
    g.furniture.add({ type: 'door', x: x0 + 3, y: y + 0.25, z: z0, rot: 0 });
    g.furniture.add({ type: 'torch', x: x0 + 0.3, y: y + 1.5, z: z0 + 2, rot: 0, wall: [1, 0, 0] });
    g.furniture.add({ type: 'chair', x: x0 + 4.6, y: y + 0.25, z: z0 + 3, rot: 2 });
    g.furniture.add({ type: 'table', x: x0 + 3, y: y + 0.25, z: z0 + 3, rot: 0 });
    g.player.teleport(x0 + 1.5, y + 0.4, z0 + 1.5);
    g.player.yaw = -2.4; g.player.pitch = -0.1;
    return { x0, z0, y };
  });
  await settle();
  const housing = await page.evaluate(() => { const g = __game; return g.town.tryRegister(g.player.x, g.player.y, g.player.z, true); });
  check('a built room is recognised as valid housing', housing.ok, housing.ok ? `${housing.volume.toFixed(0)} m³` : housing.missing.join(', '));
  await page.evaluate(() => { __game.simulate(11); });
  const npcs = await page.evaluate(() => __game.town.npcs.map(n => n.def.name));
  check('an NPC moves into the house', npcs.length >= 1, npcs.join(', '));
  await page.evaluate(() => {
    const g = __game, n = g.town.npcs[0];
    if (n) { g.player.yaw = Math.atan2(-(n.body.x - g.player.x), -(n.body.z - g.player.z)); g.player.pitch = -0.15; }
  });
  await shot('15-house-npc');

  // Grappling hook.
  const grapple = await page.evaluate(() => {
    const g = __game;
    g.equipment.set(3, { id: 'grappling_hook', count: 1 });
    g.stats = g.equipment.stats();
    const s = g.gen.spawn;
    g.player.teleport(s.x, s.y + 0.5, s.z);
    g.player.yaw = -1.72; g.player.pitch = -0.6;
    g.simulate(0.3);
    const before = { x: g.player.x, y: g.player.y, z: g.player.z };
    const c = g.camera.position, d = new c.constructor(0, 0, -1).applyQuaternion(g.camera.quaternion);
    const probe = {
      cam: [c.x, c.y, c.z].map(v => +v.toFixed(2)), dir: [d.x, d.y, d.z].map(v => +v.toFixed(2)),
      terrain: g.field.raycast(c.x, c.y, c.z, d.x, d.y, d.z, 26, 0.25)?.distance ?? null,
      pieces: g.structures.raycast(c.x, c.y, c.z, d.x, d.y, d.z, 26)?.distance ?? null,
      furniture: g.furniture.raycast(c.x, c.y, c.z, d.x, d.y, d.z, 26)?.distance ?? null,
      hp: g.vitals.hp, dead: g.vitals.dead,
    };
    g.grapple.fire(c.x, c.y, c.z, d.x, d.y, d.z);
    for (let i = 0; i < 20 && g.grapple.state === 'flying'; i++) g.simulate(1 / 30);
    const state = g.grapple.state;
    g.simulate(0.6);
    return { state, moved: Math.hypot(g.player.x - before.x, g.player.z - before.z), probe };
  });
  check('grappling hook latches and pulls the player', grapple.state === 'attached' && grapple.moved > 0.5, JSON.stringify(grapple));
  await page.evaluate(() => __game.grapple.release());

  // Biomes, depths and structures (visual review).
  const biomeSpot = async (b, name) => {
    const ok = await page.evaluate(b => {
      const g = __game, s = g.gen.spawn;
      let best = null, bd = Infinity;
      for (let z = 40; z < g.field.sz - 40; z += 8) for (let x = 40; x < g.field.sx - 40; x += 8) {
        if (g.gen.biomeAt(x, z) !== b || g.gen.height(x, z) < g.field.cfg.seaLevel + 4) continue;
        let pure = true;
        for (const [ox, oz] of [[16, 0], [-16, 0], [0, 16], [0, -16]]) if (g.gen.biomeAt(x + ox, z + oz) !== b) pure = false;
        if (!pure) continue;
        const sf = g.gen.surfaceAt(x, z);
        if (!sf || sf.ny < 0.85 || sf.y < g.gen.height(x, z) - 3) continue;
        const d = Math.hypot(x - s.x, z - s.z);
        if (d < bd) { bd = d; best = [x, z]; }
      }
      if (!best) return false;
      const surf = g.gen.surfaceAt(best[0], best[1]);
      if (surf && (surf.ny < 0.85 || surf.y < g.gen.height(best[0], best[1]) - 3)) { /* avoid chasms/cliffs */ }
      g.player.teleport(best[0], (surf ? surf.y : g.gen.height(best[0], best[1])) + 1, best[1]);
      g.player.pitch = -0.2;
      return true;
    }, b);
    if (ok) await shot(name);
    return ok;
  };
  const biomes = [await biomeSpot(1, '16-desert'), await biomeSpot(2, '17-snow'), await biomeSpot(3, '18-blight')];
  check('world has desert, snow and blight biomes', biomes.every(Boolean), JSON.stringify(biomes));
  const depths = await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    for (let r = 0; r < 120; r += 4) for (let a = 0; a < 6.28; a += 0.5) {
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      for (let y = 8; y < 19; y++) {
        if (g.gen.densityAt(x, y, z) < -1.5 && g.gen.densityAt(x, y + 1.8, z) < -1 && g.gen.densityAt(x, y - 1.2, z) > 0) {
          g.player.teleport(x, y - 0.6, z); g.player.pitch = -0.1; return [x, y, z];
        }
      }
    }
    return null;
  });
  if (depths) await shot('19-depths');
  check('found an Ember Depths cavern', !!depths, JSON.stringify(depths));
  const cabin = await page.evaluate(() => {
    const g = __game, c = g.gen.cabins[0];
    if (!c) return null;
    g.player.teleport(c.x + 1.2, c.y + 0.4, c.z + 1.2);
    g.player.yaw = -2.4; g.player.pitch = -0.15;
    return { chests: [...g.furniture.items.values()].filter(f => f.type === 'chest' && f.chest.some(Boolean)).length };
  });
  if (cabin) await shot('20-cabin');
  check('cabins with loot chests were generated', cabin && cabin.chests >= 3, JSON.stringify(cabin));

  // Boss: summon the Deepwyrm at night and let it erupt.
  const bossInfo = await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    g.player.teleport(s.x, s.y + 0.5, s.z);
    g.atmosphere.timeOfDay = 0.9;
    g.vitals.hp = g.vitals.maxHp = 400;
    g.inventory.add('wyrm_bait', 1);
    const ok = g.consume ? true : true;
    const b = g.combat.summonBoss(s.x + 14, s.y - 20, s.z + 14);
    return { segs: b.seg.length, hp: b.hp };
  });
  await page.evaluate(() => __game.simulate(0.2));
  await settle();
  let erupted = false;
  for (let i = 0; i < 20 && !erupted; i++) {
    const st = await page.evaluate(() => { const g = __game; g.simulate(0.5); const b = g.combat.boss; return b ? { y: b.head.y, top: g.sky.raw[Math.floor(b.head.x) + Math.floor(b.head.z) * g.sky.w], edits: g.log.edits.length } : null; });
    if (st && st.y > st.top + 2) erupted = true;
  }
  await page.evaluate(() => {
    const g = __game, b = g.combat.boss;
    if (b) { g.player.yaw = Math.atan2(-(b.head.x - g.player.x), -(b.head.z - g.player.z)); g.player.pitch = Math.atan2(b.head.y - g.player.y - 1.6, Math.hypot(b.head.x - g.player.x, b.head.z - g.player.z)) * 0.8; }
  });
  await shot('21-boss');
  const bossStats = await page.evaluate(() => ({ alive: !!__game.combat.boss, edits: __game.log.edits.length }));
  check('Deepwyrm burrows (carves tunnels) and erupts from the ground', erupted && bossStats.edits > 20, `erupted ${erupted}, edits ${bossStats.edits}`);
  const kill = await page.evaluate(() => {
    const g = __game, b = g.combat.boss;
    if (!b) return false;
    g.combat.explode(b.head.x, b.head.y, b.head.z, 1, 99999, g.player.x, g.player.y + 500, g.player.z);
    g.simulate(0.1);
    return { gone: !g.combat.boss, flag: g.progress.bossDefeated, scales: g.pickups.serialize().filter(p => p.id === 'wyrm_scale').length };
  });
  check('defeating the Deepwyrm drops loot and sets progression', kill && kill.gone && kill.flag && kill.scales > 0, JSON.stringify(kill));
  await page.evaluate(() => { const g = __game; g.atmosphere.timeOfDay = 0.4; g.vitals.hp = g.vitals.maxHp = 100; g.simulate(0.2); });

  // ------------------------------------------------------------ world events
  // Find an open, flat spot away from the house (spawns are suppressed near homes).
  const bloodSpot = await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    g.combat.clear();
    g.combat.spawning = true;
    g.atmosphere.timeOfDay = 0.45;
    const clear = (x, z) => !g.veg.trees.some(t => t.alive && Math.hypot(t.x - x, t.z - z) < 9);
    for (let r = 40; r < 160; r += 6) for (let a = 0; a < 6.28; a += 0.3) {
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      const sf = g.gen.surfaceAt(x, z);
      if (!sf || sf.ny < 0.9 || sf.y < g.field.cfg.seaLevel + 3 || !clear(x, z)) continue;
      g.player.teleport(x, sf.y + 1, z);
      return [x, z];
    }
    return null;
  });
  await settle();
  // New creatures lined up in daylight for visual review.
  await page.evaluate(() => {
    const g = __game;
    g.player.pitch = -0.12;
    g.simulate(0.1);
    const ids = ['blood_glob', 'gorehound', 'vein_shambler', 'bloodwisp', 'hollow_brute', 'hollow_sapper', 'raid_miner'];
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw), sx = -fz, sz = fx;
    ids.forEach((id, i) => {
      const o = (i - 3) * 1.7;
      const x = g.player.x + fx * 7 + sx * o, z = g.player.z + fz * 7 + sz * o;
      const top = g.sky.raw[Math.floor(x) + Math.floor(z) * g.sky.w];
      const c = g.spawnCreature(id, x, top + (id === 'bloodwisp' ? 1.2 : 0.2), z);
      c.yaw = Math.atan2(-fx, -fz);
      c.cooldown = 5;
    });
    g.combat.spawning = false;
  });
  await page.evaluate(() => { for (const c of __game.combat.creatures) c.cooldown = 5; __game.simulate(0.1); });
  await shot('22-event-creatures');
  await page.evaluate(() => { __game.combat.clear(); __game.combat.spawning = true; });

  await settle();
  const blood = await page.evaluate(() => {
    const g = __game;
    g.vitals.hp = g.vitals.maxHp = 400;
    g.atmosphere.timeOfDay = 0.9;
    g.simulate(0.5);
    g.startEvent('blood_moon');
    let spawned = 0;
    for (let i = 0; i < 12; i++) { g.vitals.hp = 400; g.simulate(2); spawned = Math.max(spawned, g.combat.creatures.filter(c => c.event === 'blood_moon').length); }
    return { kind: g.events.kind, spawned, blood: g.atmosphere.bloodVisible, bar: getComputedStyle(document.querySelector('#eventbar')).display };
  });
  check('the Blood Moon brings its own creatures and a red sky', blood.kind === 'blood_moon' && blood.spawned > 0 && blood.blood > 0.5 && blood.bar === 'block', JSON.stringify({ spot: bloodSpot, ...blood }));
  await page.evaluate(() => {
    const g = __game;
    // Look toward the moon with a Gorehound on the prowl.
    g.combat.clear();
    g.combat.spawning = false;
    const t = g.atmosphere.timeOfDay, ang = (t - 0.25) * Math.PI * 2;
    const dx = -Math.cos(ang), dz = 0.35;
    g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = 0.3;
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
    const x = g.player.x + fx * 7, z = g.player.z + fz * 7;
    const c = g.spawnCreature('gorehound', x, g.sky.raw[Math.floor(x) + Math.floor(z) * g.sky.w] + 0.3, z);
    c.yaw = Math.atan2(-fx, -fz); c.cooldown = 5;
    g.simulate(0.05);
  });
  await shot('23-blood-moon');
  const dawn = await page.evaluate(() => {
    const g = __game;
    g.combat.clear();
    g.combat.spawning = true;
    g.atmosphere.timeOfDay = 0.3;
    g.simulate(0.2);
    return { kind: g.events.kind, bar: getComputedStyle(document.querySelector('#eventbar')).display };
  });
  check('the Blood Moon ends at dawn', dawn.kind === null && dawn.bar === 'none', JSON.stringify(dawn));

  // Hollow Raid: sound the war horn in town, watch raiders march, repel them.
  await page.evaluate(h => { const g = __game; g.player.teleport(h.x0 + 3, h.y + 0.5, h.z0 - 3); g.player.yaw = 0; }, house);
  await settle();
  const horn = await page.evaluate(() => {
    const g = __game;
    g.vitals.hp = g.vitals.maxHp = 400;
    const started = g['consume']({ id: 'hollow_horn' });
    return { started, kind: g.events.kind, goal: g.events.goal, town: g.townInfo(), player: [g.player.x, g.player.z], msgs: [...document.querySelectorAll('#messages div')].map(e => e.textContent).slice(-3) };
  });
  check('the war horn starts the Hollow Raid near town', horn.started && horn.kind === 'raid' && horn.goal > 0, JSON.stringify(horn));
  const march = await page.evaluate(() => {
    const g = __game;
    let first = null, closest = Infinity, count = 0;
    for (let i = 0; i < 16; i++) {
      g.vitals.hp = 400;
      g.simulate(1);
      const raiders = g.combat.creatures.filter(c => c.event === 'raid');
      count = Math.max(count, raiders.length);
      for (const c of raiders) {
        const d = Math.hypot(c.x - g.player.x, c.z - g.player.z);
        if (first === null) first = d;
        closest = Math.min(closest, d);
      }
    }
    return { count, first, closest };
  });
  check('raiders spawn around the town and march in', march.count >= 4 && march.closest < march.first - 5, JSON.stringify(march));
  await page.evaluate(() => {
    const g = __game;
    const r = g.combat.creatures.filter(c => c.event === 'raid').sort((a, b) => Math.hypot(a.x - g.player.x, a.z - g.player.z) - Math.hypot(b.x - g.player.x, b.z - g.player.z))[0];
    if (r) { g.player.yaw = Math.atan2(-(r.x - g.player.x), -(r.z - g.player.z)); g.player.pitch = -0.08; }
  });
  await shot('24-raid');
  const raid = await page.evaluate(() => {
    const g = __game;
    for (let i = 0; i < 120 && g.events.kind === 'raid'; i++) {
      g.vitals.hp = 400;
      for (const c of g.combat.creatures.filter(c => c.event === 'raid')) g.combat['applyHit'](c, 99999, 0, c.x, c.z);
      g.simulate(1);
    }
    return { kind: g.events.kind, won: g.progress.raidDefeated, coins: g.pickups.serialize().filter(p => p.id === 'coin').length, left: g.combat.creatures.filter(c => c.event === 'raid').length };
  });
  check('repelling the raid sets progression and pays out', raid.kind === null && raid.won && raid.coins > 0 && raid.left === 0, JSON.stringify(raid));
  await page.evaluate(() => { const g = __game; g.combat.spawning = false; g.combat.clear(); g.vitals.hp = g.vitals.maxHp = 100; g.simulate(0.2); });

  // ---------------------------------------------------------------- sky tier
  const aerite = await page.evaluate(() => {
    const g = __game;
    let ore = 0, total = 0;
    for (const isl of g.gen.islands) {
      for (let y = isl.y - isl.depth + 2; y < isl.y - 2; y += 1.5)
        for (let a = 0; a < 6.28; a += 0.6) for (const r of [0, isl.r * 0.3, isl.r * 0.55]) {
          const x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
          if (g.gen.densityAt(x, y, z) < 2) continue;
          total++;
          if (g.gen.materialFor(x, y, z, 10, 1) === 18) ore++;
        }
    }
    return { islands: g.gen.islands.length, ore, total };
  });
  check('floating islands hold aerite ore', aerite.ore > 20 && aerite.ore < aerite.total * 0.6, JSON.stringify(aerite));

  // Wings: take off from an island, climb, then glide.
  const island = await page.evaluate(() => {
    const g = __game;
    // An open spot on an island (away from its shrine), clear sky above.
    for (const isl of g.gen.islands) for (const f of [0.5, 0.35, 0.65]) for (let a = 0; a < 6.28; a += 0.5) {
      const x = isl.x + Math.cos(a) * isl.r * f, z = isl.z + Math.sin(a) * isl.r * f;
      const top = g.gen.surfaceAt(x, z);
      if (!top || top.y < isl.y - 3 || top.ny < 0.8) continue;
      if (g.structures.raycast(x, top.y + 1, z, 0, 1, 0, 40) || g.furniture.near(x, top.y, z, 4).length) continue;
      g.player.teleport(x, top.y + 1, z);
      return { x, y: top.y, z };
    }
    return null;
  });
  await settle();
  const flight = await page.evaluate(() => {
    const g = __game;
    g.combat.clear();
    g.combat.spawning = false;
    g.atmosphere.timeOfDay = 0.42;
    g.equipment.set(4, { id: 'roc_wings', count: 1 });
    g.stats = g.equipment.stats();
    g.simulate(0.3);
    const y0 = g.player.y;
    g.input.keys.add('Space');
    let peak = y0, minVy = 0;
    for (let i = 0; i < 60; i++) { g.simulate(0.05); peak = Math.max(peak, g.player.y); }
    for (let i = 0; i < 30; i++) { g.simulate(0.05); if (!g.player.grounded) minVy = Math.min(minVy, g.player.vy); }
    const gliding = g.player.gliding;
    g.input.keys.delete('Space');
    return { climb: +(peak - y0).toFixed(1), minVy: +minVy.toFixed(2), gliding, time: g.stats.flight };
  });
  check('Roc Wings fly and then glide', flight.climb > 10 && flight.minVy > -3 && flight.time > 0, JSON.stringify(flight));
  await page.evaluate(() => { const g = __game; g.equipment.set(4, null); g.stats = g.equipment.stats(); g.simulate(3); });

  const skySpawns = await page.evaluate(i => {
    const g = __game;
    g.player.teleport(i.x, i.y + 1, i.z);
    g.vitals.hp = g.vitals.maxHp = 400;
    g.combat.spawning = true;
    const seen = new Set();
    for (let k = 0; k < 20; k++) { g.vitals.hp = 400; g.simulate(1); for (const c of g.combat.creatures) seen.add(c.def.id); }
    g.combat.spawning = false;
    return [...seen];
  }, island);
  check('sky creatures live around the islands', skySpawns.some(id => id === 'gale_swift' || id === 'cloud_glob'), skySpawns.join(', '));
  await page.evaluate(() => {
    const g = __game;
    const c = g.combat.creatures.find(c => c.def.id === 'gale_swift') ?? g.spawnCreature('gale_swift', g.player.x + 3, g.player.y + 3, g.player.z - 5);
    g.player.yaw = Math.atan2(-(c.x - g.player.x), -(c.z - g.player.z)); g.player.pitch = Math.atan2(c.y - g.player.y - 1.6, Math.hypot(c.x - g.player.x, c.z - g.player.z));
  });
  await shot('25-sky-island');

  // The Tempest Roc: summon it with the idol, watch it dive and volley feathers.
  const roc = await page.evaluate(i => {
    const g = __game;
    g.combat.clear();
    g.player.teleport(i.x, i.y + 1, i.z);
    g.vitals.hp = g.vitals.maxHp = 600;
    g.simulate(0.2);
    const ok = g['consume']({ id: 'gale_idol' });
    const b = g.combat.boss;
    let dove = false, feathers = 0, minDist = Infinity;
    for (let k = 0; k < 160 && b; k++) {
      g.vitals.hp = 600;
      g.simulate(0.1);
      if (b['mode'] === 'dive') dove = true;
      feathers = Math.max(feathers, g.combat['projectiles'].filter(p => p.kind === 'feather').length);
      minDist = Math.min(minDist, b.center.distanceTo(g.player.position));
    }
    return { ok, id: b?.id, dove, feathers, minDist: +minDist.toFixed(1) };
  }, island);
  check('the Tempest Roc circles, volleys feathers and dives', roc.ok && roc.id === 'roc' && roc.dove && roc.feathers > 0 && roc.minDist < 12, JSON.stringify(roc));
  await page.evaluate(() => {
    const g = __game, b = g.combat.boss;
    if (!b) return;
    b['mode'] = 'circle'; b['modeTime'] = 0;
    const c = b.center;
    c.set(g.player.x + 10, g.player.y + 7, g.player.z - 14);
    b.update({ px: g.player.x, py: g.player.y, pz: g.player.z, pvx: 0, pvz: 0, dt: 0.001, underground: () => false, distance: () => 99, carve() {}, erupt() {}, spit() {}, feathers() {}, summon() {}, gust() {}, sound() {}, hurtPlayer() {}, worldHeight: 160 });
    g.player.yaw = Math.atan2(-(c.x - g.player.x), -(c.z - g.player.z)); g.player.pitch = Math.atan2(c.y - g.player.y - 1.6, Math.hypot(c.x - g.player.x, c.z - g.player.z));
    g.combat['projectiles'].forEach(p => g.combat.group.remove(p.mesh)); g.combat['projectiles'].length = 0;
  });
  await page.evaluate(() => { __game.render(); });
  await page.screenshot({ path: `${OUT}/26-tempest-roc.png` });
  const rocKill = await page.evaluate(() => {
    const g = __game, b = g.combat.boss;
    if (!b) return null;
    const c = b.center;
    g.combat['hitBoss'](99999, c.x, c.y, c.z);
    g.simulate(0.1);
    const drops = g.pickups.serialize().map(p => p.id);
    return { gone: !g.combat.boss, flag: g.progress.rocDefeated, wings: drops.includes('roc_wings'), staff: drops.includes('tempest_staff'), plumes: drops.includes('roc_plume') };
  });
  check('defeating the Roc drops its wings and staff', rocKill && rocKill.gone && rocKill.flag && rocKill.wings && rocKill.staff && rocKill.plumes, JSON.stringify(rocKill));

  // Tempest Staff gust and Gale Bow multishot.
  const weapons = await page.evaluate(() => {
    const g = __game;
    g.combat.clear();
    g.vitals.mana = g.vitals.maxMana;
    // Face the island's middle so both targets stand on solid ground.
    const isl = g.gen.islands.reduce((a, i) => (Math.hypot(i.x - g.player.x, i.z - g.player.z) < Math.hypot(a.x - g.player.x, a.z - g.player.z) ? i : a));
    g.player.yaw = Math.atan2(-(isl.x - g.player.x), -(isl.z - g.player.z));
    g.player.pitch = 0;
    g.simulate(0.05);
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
    const targets = [3, 5.5].map(d => g.spawnCreature('shambler', g.player.x + fx * d, g.player.y + 0.2, g.player.z + fz * d));
    targets.forEach(t => { t.hp = 999; t.cooldown = 9; });
    g.simulate(0.3);
    // Aim through both (the ground may slope).
    const far = targets[1];
    g.player.pitch = Math.atan2(far.cy - g.camera.position.y, Math.hypot(far.x - g.player.x, far.z - g.player.z));
    g.simulate(0.02);
    g['attack']({ id: 'tempest_staff', weapon: { type: 'magic', damage: 34, speed: 0.5, knockback: 16, projectileSpeed: 30, manaCost: 10 } });
    g.simulate(0.6);
    const pierced = targets.filter(t => t.hp < 999).length;
    g.inventory.add('wooden_arrow', 10);
    const before = g.inventory.count('wooden_arrow');
    const arrows0 = g.combat['projectiles'].filter(p => p.kind === 'arrow').length;
    g['attack']({ id: 'gale_bow', weapon: { type: 'bow', damage: 15, speed: 0.42, knockback: 3, projectileSpeed: 58, ammo: 'wooden_arrow', multishot: 2 } });
    const arrows = g.combat['projectiles'].filter(p => p.kind === 'arrow').length - arrows0;
    return { pierced, arrows, used: before - g.inventory.count('wooden_arrow') };
  });
  check('the gale pierces a line of foes; the Gale Bow looses two arrows', weapons.pierced === 2 && weapons.arrows === 2 && weapons.used === 1, JSON.stringify(weapons));
  await page.evaluate(() => { const g = __game; g.combat.clear(); g.vitals.hp = g.vitals.maxHp = 100; g.simulate(0.2); });

  // -------------------------------------------------------- character growth
  const crystal = await page.evaluate(() => {
    const g = __game;
    const all = [...g.furniture.items.values()].filter(f => f.type === 'life_crystal');
    const s = g.gen.spawn;
    const c = all.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
    if (!c) return { count: 0 };
    // Stand beside it, facing it.
    const a = Math.random() * 6.28;
    let px = c.x + 1.8, pz = c.z;
    for (let k = 0; k < 8; k++) {
      const ang = a + k * 0.785, x = c.x + Math.cos(ang) * 1.8, z = c.z + Math.sin(ang) * 1.8;
      if (g.gen.densityAt(x, c.y + 0.8, z) < -0.3 && g.gen.densityAt(x, c.y + 1.6, z) < -0.3) { px = x; pz = z; break; }
    }
    g.player.teleport(px, c.y + 0.3, pz);
    g.player.yaw = Math.atan2(-(c.x - px), -(c.z - pz));
    g.player.pitch = -0.35;
    return { count: all.length, x: c.x, y: c.y, z: c.z, uid: c.uid };
  });
  await settle();
  await shot('27-life-crystal');
  const grown = await page.evaluate(c => {
    const g = __game;
    const pick = g.inventory.slots.findIndex(x => x && x.id === 'copper_pickaxe');
    g.inventory.select(pick);
    g.player.yaw = Math.atan2(-(c.x - g.player.x), -(c.z - g.player.z));
    g.player.pitch = Math.atan2(c.y + 0.55 - g.player.y - 1.62, Math.hypot(c.x - g.player.x, c.z - g.player.z));
    g.simulate(0.1);
    g.input.lmb = true;
    for (let i = 0; i < 40 && g.furniture.items.has(c.uid); i++) g.simulate(0.1);
    g.input.lmb = false;
    g.simulate(1.5);
    const got = g.inventory.count('life_crystal');
    const before = g.vitals.maxHp;
    if (got) g['consume']({ id: 'life_crystal', grow: { life: 20 } }) && g.inventory.remove('life_crystal', 1);
    return { broken: !g.furniture.items.has(c.uid), got, before, after: g.vitals.maxHp, saved: g.snapshot().extra.maxHp };
  }, crystal);
  check('Life Crystals grow in caves and raise max life', crystal.count >= 10 && grown.broken && grown.got === 1 && grown.after === grown.before + 20 && grown.saved === grown.after, JSON.stringify({ count: crystal.count, ...grown }));
  const star = await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    g.player.teleport(s.x, s.y + 0.5, s.z);
    g.atmosphere.timeOfDay = 0.95;
    g.simulate(0.5);
    g.dropStar();
    let landed = false;
    for (let i = 0; i < 50 && !landed; i++) { g.simulate(0.1); landed = g.pickups.serialize().some(p => p.id === 'fallen_star'); }
    g.inventory.add('fallen_star', 5);
    const st = g.furniture.stationsNear(g.player.x, g.player.y + 1, g.player.z);
    g.furniture.add({ type: 'workbench', x: g.player.x + 1.5, y: g.player.y, z: g.player.z, rot: 0 });
    const crafted = g.craftItem('mana_crystal');
    const before = g.vitals.maxMana;
    g['consume']({ id: 'mana_crystal', grow: { mana: 20 } });
    g.atmosphere.timeOfDay = 0.4;
    g.simulate(0.2);
    return { landed, crafted, before, after: g.vitals.maxMana };
  });
  check('fallen stars land at night and craft into Mana Crystals', star.landed && star.crafted && star.after === star.before + 20, JSON.stringify(star));

  // ------------------------------------------------------- mushroom caverns
  const cavern = await page.evaluate(() => {
    const g = __game, s = g.gen.spawn;
    const shrooms = g.veg.trees.filter(t => t.kind === 'mushroom' && t.alive);
    if (!shrooms.length) return { count: 0 };
    const t = shrooms.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
    // Stand a few metres from the stem on open floor.
    for (let k = 0; k < 48; k++) {
      const r = [7, 5.5, 4, 3.2][Math.floor(k / 12)];
      const a = (k % 12) * 0.52, x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
      if (g.gen.densityAt(x, t.y + 1, z) < -0.4 && g.gen.densityAt(x, t.y + 1.8, z) < -0.4 && g.gen.densityAt(x, t.y - 0.8, z) > 0) {
        g.player.teleport(x, t.y + 0.6, z);
        break;
      }
    }
    return { count: shrooms.length, x: t.x, y: t.y, z: t.z, h: t.height, id: t.id };
  });
  await settle();
  const floorMat = await page.evaluate(t => {
    const g = __game;
    g.player.yaw = Math.atan2(-(t.x - g.player.x), -(t.z - g.player.z));
    g.player.pitch = Math.atan2(t.y + t.h * 0.6 - g.player.y - 1.6, Math.hypot(t.x - g.player.x, t.z - g.player.z));
    g.simulate(0.3);
    const hit = g.field.raycast(g.player.x, g.player.y + 1, g.player.z, 0, -1, 0, 4, 0.1);
    return { mat: hit?.material, inZone: g.gen.mushroomAt(g.player.x, g.player.y, g.player.z) };
  }, cavern);
  check('mushroom caverns have giant mushrooms on glowing floors', cavern.count >= 8 && floorMat.inZone && (floorMat.mat === 19 || floorMat.mat === 20), JSON.stringify({ ...cavern, ...floorMat }));
  await shot('28-mushroom-cavern');
  const shroomLife = await page.evaluate(t => {
    const g = __game;
    g.vitals.hp = g.vitals.maxHp;
    g.combat.spawning = true;
    const seen = new Set();
    for (let k = 0; k < 24; k++) { g.vitals.hp = g.vitals.maxHp; g.simulate(1); for (const c of g.combat.creatures) seen.add(c.def.id); }
    g.combat.spawning = false;
    g.combat.clear();
    // Fell the mushroom with the axe for glowcaps.
    const axe = g.inventory.slots.findIndex(x => x && x.id === 'copper_axe');
    g.inventory.select(axe);
    const tree = g.veg.trees.find(x => x.id === t.id);
    g.player.teleport(tree.x + 1.6, tree.y + 0.5, tree.z);
    g.player.yaw = Math.PI / 2; g.player.pitch = -0.1;
    g.simulate(0.2);
    const before = g.inventory.count('glowcap');
    g.input.lmb = true;
    for (let i = 0; i < 60 && tree.alive; i++) g.simulate(0.1);
    g.input.lmb = false;
    g.simulate(1.5);
    return { seen: [...seen], felled: !tree.alive, glowcaps: g.inventory.count('glowcap') - before };
  }, cavern);
  check('Sporelings and Glowmoths haunt the caverns; mushrooms fell into glowcaps', shroomLife.seen.some(id => id === 'sporeling' || id === 'glowmoth') && shroomLife.felled && shroomLife.glowcaps > 0, JSON.stringify(shroomLife));

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

  // --------------------------------------------- full save / reload round trip
  const saved2 = await page.evaluate(() => {
    const g = __game;
    g.equipment.set(4, { id: 'roc_wings', count: 1 });
    g.startEvent('raid');
    g.saveGame();
    return {
      maxHp: g.vitals.maxHp, maxMana: g.vitals.maxMana, progress: { ...g.progress }, event: g.events.kind,
      crystals: [...g.furniture.items.values()].filter(f => f.type === 'life_crystal').length,
      deadShrooms: g.veg.trees.filter(t => t.kind === 'mushroom' && !t.alive).map(t => t.id),
      wings: g.equipment.items[4]?.id, houses: g.town.houses.length, npcs: g.town.npcs.map(n => n.def.id),
    };
  });
  await boot('?continue=1');
  const loaded2 = await page.evaluate(() => {
    const g = __game;
    return {
      maxHp: g.vitals.maxHp, maxMana: g.vitals.maxMana, progress: { ...g.progress }, event: g.events.kind,
      crystals: [...g.furniture.items.values()].filter(f => f.type === 'life_crystal').length,
      deadShrooms: g.veg.trees.filter(t => t.kind === 'mushroom' && !t.alive).map(t => t.id),
      wings: g.equipment.items[4]?.id, flight: g.stats.flight, houses: g.town.houses.length, npcs: g.town.npcs.map(n => n.def.id),
    };
  });
  const same = saved2.maxHp === loaded2.maxHp && saved2.maxMana === loaded2.maxMana && JSON.stringify(saved2.progress) === JSON.stringify(loaded2.progress) &&
    saved2.event === loaded2.event && saved2.crystals === loaded2.crystals && JSON.stringify(saved2.deadShrooms) === JSON.stringify(loaded2.deadShrooms) &&
    loaded2.wings === 'roc_wings' && loaded2.flight > 0 && saved2.houses === loaded2.houses && JSON.stringify(saved2.npcs) === JSON.stringify(loaded2.npcs);
  check('everything new survives a save and reload', same && saved2.deadShrooms.length > 0, JSON.stringify({ saved: saved2, loaded: loaded2 }));

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
