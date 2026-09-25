// Combat: creature spawning/despawning, AI updates, contact damage, player
// melee arcs, projectiles (arrows, magic bolts, bombs, thrown rocks) and
// explosions. Rendering of creatures/projectiles lives here too since they
// are tightly coupled; the game wires in effects via hooks.

import * as THREE from 'three';
import { item } from '../items/items';
import { type CreatureVisual, buildCreatureVisual } from '../render/creatureModels';
import { itemModel, parts } from '../render/models';
import type { WorldCollision } from '../world/collision';
import type { TerrainField } from '../world/terrain';
import { type Boss, Deepwyrm } from './boss';
import { TempestRoc } from './roc';
import { CREATURES, Creature, type CreatureDef, type SpawnEnv, think } from './creatures';
import type { EventKind } from './events';

export interface CombatHooks {
  /** Material factory: a fresh object-space world material per creature (own hit flash). */
  creatureMaterial(): THREE.MeshLambertMaterial;
  projectileMaterial: THREE.Material;
  particles(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: number, count: number, speed?: number): void;
  damageNumber(x: number, y: number, z: number, text: string, color: string): void;
  drop(id: string, count: number, x: number, y: number, z: number): void;
  hurtPlayer(amount: number, fromX: number, fromZ: number, knockback: number): number;
  sound(name: 'hit' | 'die' | 'splat' | 'explode' | 'bow' | 'magic' | 'swing' | 'screech' | 'gust' | 'flap', x: number, y: number, z: number): void;
  /** Shove the player away from a point (Roc gusts). */
  pushPlayer(fromX: number, fromZ: number, strength: number): void;
  /** Carve terrain for explosions; returns nothing (drops handled by the game). */
  blast(x: number, y: number, z: number, r: number): void;
  /** Carve terrain without explosion effects (boss tunnels, drilling bolts). */
  carve(x: number, y: number, z: number, r: number, drops: boolean): void;
  bossDefeated(b: Boss): void;
  flash(x: number, y: number, z: number, color: number, range: number, life: number): void;
  shake(amount: number): void;
  killed(c: Creature): void;
  /** Environment probe for spawning. */
  skyVisibility(x: number, y: number, z: number): number;
  isNight(): boolean;
  /** Biome id at a column (0 forest, 1 desert, 2 snow, 3 blight). */
  biomeAt(x: number, z: number): number;
  /** Height below which the Ember Depths begin. */
  emberY: number;
  /** Surface height from the (exact, loaded) sky map at x,z. */
  surfaceTop(x: number, z: number): number;
  seaLevel: number;
  isLoaded(x: number, z: number): boolean;
  /** Suppress spawns near safe zones (houses / NPC homes). */
  safeZone(x: number, y: number, z: number): boolean;
  /** Is this point under water? */
  inWater(x: number, y: number, z: number): boolean;
  /** Inside a glowing mushroom cavern? */
  mushroomAt(x: number, y: number, z: number): boolean;
  /** The running world event, if any (raids march on `target`). */
  activeEvent(): { kind: EventKind; target: { x: number; z: number } | null } | null;
  /** A creature spawned by a world event died. */
  eventKill(c: Creature): void;
}

type ProjKind = 'arrow' | 'bolt' | 'bomb' | 'rock' | 'drill' | 'feather' | 'gust';

interface Projectile {
  kind: ProjKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  gravity: number;
  damage: number;
  knockback: number;
  enemy: boolean;
  life: number;
  stuck: boolean;
  fuse: number;
  blast: number;
  mesh: THREE.Object3D;
  /** Creatures already hit (piercing projectiles hit each target once). */
  hit: Set<number>;
  bossCd: number;
}

const CAPS = { day: 5, night: 10, cave: 8, sky: 3 };
/** Above this height the player is in the high sky (floating islands). */
export const SKY_Y = 112;
/** Raiders alive at once during the Hollow March. */
const RAID_CAP = 12;

/** Weighted random pick. */
function pick<T>(options: T[], weight: (o: T) => number): T {
  const total = options.reduce((s, o) => s + weight(o), 0);
  let r = Math.random() * total;
  return options.find(o => (r -= weight(o)) <= 0) ?? options[0];
}

export class Combat {
  readonly group = new THREE.Group();
  readonly creatures: Creature[] = [];
  private visuals = new Map<number, { v: CreatureVisual; mat: THREE.MeshLambertMaterial }>();
  private projectiles: Projectile[] = [];
  private spawnTimer = 1;
  private n: [number, number, number] = [0, 0, 0];
  spawning = true;
  /** Total creatures defeated (stats / tests). */
  kills = 0;
  /** Extra spawn-rate multiplier (events such as the Sporefall). */
  spawnBoost = 1;
  boss: Boss | null = null;
  private drillGeo = parts.merge([parts.cone(0.14, 0.6, 5, 'bone', { y: 0.1 }), parts.octa(0.08, 'flame', { y: -0.2 }, 0xd0ff90)]);
  private drillCarve = 0;
  private boltGeo = parts.merge([parts.octa(0.12, 'lumiteMetal', { sy: 1.6 }), parts.octa(0.07, 'flame', {}, 0xd0ffff)]);
  private rockGeo = parts.merge([parts.ico(0.16, 'stone', { jitter: 0.4, seed: 9 })]);
  private featherGeo = (() => { const g = itemModel(item('sky_feather')).clone(); g.scale(2.2, 2.2, 2.2); return g; })();
  /** A crescent of wind: swept feather-white blades around the flight axis. */
  private gustGeo = parts.merge([0, 1, 2, 3, 4, 5].map(i => {
    const a = (i / 6) * Math.PI * 2;
    return parts.taper(0.5, 0.05, 0.14, 0.2, 1, 'feather', { x: Math.cos(a) * 0.45, z: Math.sin(a) * 0.45, y: -i * 0.05, ry: -a + 0.6, rx: 0.3 }, 0xf4f8ff);
  }));

  constructor(private field: TerrainField, private world: WorldCollision, private hooks: CombatHooks) {}

  // ------------------------------------------------------------------ spawning

  spawn(def: CreatureDef, x: number, y: number, z: number): Creature {
    const c = new Creature(def, x, y, z);
    const mat = this.hooks.creatureMaterial();
    const v = buildCreatureVisual(def.model ?? def.id, mat, def.tint, def.skin);
    this.group.add(v.root);
    this.visuals.set(c.uid, { v, mat });
    this.creatures.push(c);
    return c;
  }

  private remove(c: Creature) {
    const vis = this.visuals.get(c.uid);
    if (vis) { this.group.remove(vis.v.root); vis.mat.dispose(); this.visuals.delete(c.uid); }
    const i = this.creatures.indexOf(c);
    if (i >= 0) this.creatures.splice(i, 1);
  }

  /** Raiders gather in a ring around the town and march in. */
  private spawnRaider(target: { x: number; z: number }, px: number, pz: number) {
    const h = this.hooks;
    if (this.creatures.filter(c => c.event === 'raid').length >= RAID_CAP) return;
    if (Math.hypot(px - target.x, pz - target.z) > 140) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = Math.random() * Math.PI * 2, d = 34 + Math.random() * 16;
      const x = target.x + Math.cos(a) * d, z = target.z + Math.sin(a) * d;
      if (x < 4 || z < 4 || x > this.field.sx - 4 || z > this.field.sz - 4 || !h.isLoaded(x, z)) continue;
      if (Math.hypot(x - px, z - pz) < 18) continue;
      const y = h.surfaceTop(x, z) + 0.4;
      if (y < h.seaLevel + 0.5 || h.skyVisibility(x, y + 1, z) < 0.7) continue;
      const def = pick(Object.values(CREATURES).filter(c => c.event?.kind === 'raid'), c => c.event!.weight);
      const c = this.spawn(def, x, y, z);
      c.event = 'raid';
      this.hooks.particles(x, y + 1, z, 0, 1, 0, 0x8a7a6a, 14, 4);
      return;
    }
  }

  /** Creatures that can spawn in an environment (by biome at the surface). */
  spawnTable(env: SpawnEnv, biome: number, night = false, shroom = false): CreatureDef[] {
    return Object.values(CREATURES).filter(c => c.spawn && (c.spawn.env === env || (env === 'deep' && c.spawn.env === 'cave')) &&
      (c.spawn.time === 'any' || (c.spawn.time === 'night') === night) &&
      (!c.spawn.biomes || env !== 'surface' || c.spawn.biomes.includes(biome)) &&
      (!c.spawn.zone || shroom));
  }

  private trySpawn(px: number, py: number, pz: number) {
    const h = this.hooks;
    const ev = h.activeEvent();
    if (ev?.kind === 'raid' && ev.target) this.spawnRaider(ev.target, px, pz);
    const night = h.isNight();
    const vis = h.skyVisibility(px, py + 1.5, pz);
    const underground = vis < 0.4;
    const regular = this.creatures.filter(c => !c.def.boss && c.event !== 'raid').length;
    const cap = (underground ? CAPS.cave : py > SKY_Y ? CAPS.sky : night ? CAPS.night : CAPS.day) * this.spawnBoost;
    if (regular >= cap) return;

    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2, d = 24 + Math.random() * 22;
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (x < 4 || z < 4 || x > this.field.sx - 4 || z > this.field.sz - 4 || !h.isLoaded(x, z)) continue;
      let y: number, env: SpawnEnv;
      if (!underground && py > SKY_Y) {
        // High sky: swifts on the wing, globs on island tops.
        env = 'sky';
        const top = h.surfaceTop(x, z);
        if (top > SKY_Y - 6 && Math.random() < 0.5) {
          y = top + 0.4;
          if (h.skyVisibility(x, y + 1, z) < 0.7) continue;
        } else {
          y = py + 1 + Math.random() * 7;
          if (this.field.sample(x, y, z) > -1.5) continue;
          const def = pick(Object.values(CREATURES).filter(c => c.spawn?.env === 'sky' && c.ai === 'flyer'), c => c.spawn!.weight);
          this.spawn(def, x, y, z);
          return;
        }
        const def = pick(Object.values(CREATURES).filter(c => c.spawn?.env === 'sky' && c.ai !== 'flyer'), c => c.spawn!.weight);
        this.spawn(def, x, y, z);
        return;
      } else if (!underground) {
        y = h.surfaceTop(x, z) + 0.4;
        if (y < h.seaLevel + 0.5 || h.skyVisibility(x, y + 1, z) < 0.7) continue;
        env = 'surface';
      } else {
        y = py + (Math.random() - 0.5) * 16;
        if (this.field.sample(x, y, z) > -0.5 || this.field.sample(x, y + 1.5, z) > -0.3) continue;
        const floor = this.field.raycast(x, y, z, 0, -1, 0, 8, 0.4);
        if (!floor) continue;
        y = floor.y + 0.3;
        if (h.skyVisibility(x, y + 1, z) > 0.3) continue;
        env = y < h.emberY + 6 ? 'depths' : y < 45 ? 'deep' : 'cave';
      }
      if (h.safeZone(x, y, z)) continue;
      // Sporefall: most surface spawns come from the event's own roster.
      if (ev?.kind === 'sporefall' && env === 'surface' && Math.random() < 0.7) {
        const def = pick(Object.values(CREATURES).filter(c => c.event?.kind === 'sporefall'), c => c.event!.weight);
        const c = this.spawn(def, x, y + (def.ai === 'flyer' ? 2.5 : 0), z);
        c.event = 'sporefall';
        return;
      }
      const biome = h.biomeAt(x, z);
      const shroom = env !== 'surface' && h.mushroomAt(x, y, z);
      let options = this.spawnTable(env, biome, night, shroom);
      // Mushroom caverns are mostly home to their own creatures.
      if (shroom && Math.random() < 0.75) options = options.filter(c => c.spawn!.zone === 'mushroom');
      if (!options.length) return;
      const def = pick(options, c => c.spawn!.weight);
      const flyer = def.ai === 'flyer';
      this.spawn(def, x, y + (flyer ? 2.5 : 0), z);
      return;
    }
  }

  // -------------------------------------------------------------------- combat

  private applyHit(c: Creature, raw: number, knock: number, fromX: number, fromZ: number): number {
    const crit = Math.random() < 0.04;
    const dmg = Math.max(1, Math.round((raw * (0.9 + Math.random() * 0.2) - c.def.defense * 0.5) * (crit ? 2 : 1)));
    c.hp -= dmg;
    c.hitFlash = 1;
    c.knock(fromX, fromZ, knock);
    this.hooks.damageNumber(c.cx, c.y + c.def.height + 0.3, c.cz, String(dmg), crit ? '#ff9a3a' : '#ffffff');
    this.hooks.particles(c.cx, c.cy, c.cz, 0, 0.6, 0, c.def.color, 6, 3);
    this.hooks.sound(c.def.id.includes('burrling') ? 'splat' : 'hit', c.cx, c.cy, c.cz);
    if (c.hp <= 0) this.kill(c);
    return dmg;
  }

  summonBoss(x: number, y: number, z: number, kind: Boss['id'] = 'deepwyrm') {
    if (this.boss) return this.boss;
    const mat = this.hooks.creatureMaterial();
    this.boss = kind === 'roc' ? new TempestRoc(x, y, z, mat) : new Deepwyrm(x, y, z, mat);
    this.group.add(this.boss.group);
    return this.boss;
  }

  private hitBoss(raw: number, x: number, y: number, z: number): number {
    const b = this.boss;
    if (!b || !b.alive) return 0;
    const crit = Math.random() < 0.04;
    const dmg = Math.max(1, Math.round((raw * (0.9 + Math.random() * 0.2) - b.defense * 0.5) * (crit ? 2 : 1)));
    b.hp -= dmg;
    b.hitFlash = 1;
    this.hooks.damageNumber(x, y + 1.5, z, String(dmg), crit ? '#ff9a3a' : '#ffe0a0');
    this.hooks.particles(x, y, z, 0, 0.6, 0, b.id === 'roc' ? 0xdce4ee : 0xc8d090, 6, 3);
    this.hooks.sound('hit', x, y, z);
    if (b.hp <= 0) {
      b.alive = false;
      this.kills++;
      const color = b.id === 'roc' ? 0xdce4ee : 0xc8d090;
      for (const s of b.points()) this.hooks.particles(s.x, s.y, s.z, 0, 1, 0, color, 14, 7);
      this.hooks.shake(1);
      const h = b.center;
      this.hooks.sound('explode', h.x, h.y, h.z);
      for (const [id, n] of b.drops()) this.hooks.drop(id, n, h.x, h.y + 1, h.z);
      this.hooks.bossDefeated(b);
      this.group.remove(b.group);
      this.boss = null;
    }
    return dmg;
  }

  private kill(c: Creature) {
    if (!c.alive) return;
    c.alive = false;
    this.kills++;
    this.hooks.particles(c.cx, c.cy, c.cz, 0, 1, 0, c.def.color, 24, 5);
    this.hooks.sound('die', c.cx, c.cy, c.cz);
    for (const d of c.def.drops) {
      if (Math.random() > d.chance) continue;
      const n = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
      if (n > 0) this.hooks.drop(d.item, n, c.cx, c.cy, c.cz);
    }
    this.hooks.killed(c);
    if (c.event) this.hooks.eventKill(c);
    this.remove(c);
  }

  /** Event creatures leave (raid over): they vanish in a puff of dust. */
  dismiss(kind: EventKind) {
    for (const c of [...this.creatures]) {
      if (c.event !== kind) continue;
      this.hooks.particles(c.cx, c.cy, c.cz, 0, 1, 0, 0x8a7a6a, 16, 3);
      this.remove(c);
    }
  }

  /** Line of sight through terrain between two points. */
  private visible(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz);
    const hit = this.field.raycast(ax, ay, az, dx / l, dy / l, dz / l, l, 0.3);
    return !hit;
  }

  /** Melee arc in front of the camera. Returns the total damage dealt. */
  melee(eye: THREE.Vector3, dir: THREE.Vector3, reach: number, damage: number, knockback: number, arcCos = 0.55): number {
    let dealt = 0;
    for (const c of [...this.creatures]) {
      const tx = c.cx - eye.x, ty = c.cy - eye.y, tz = c.cz - eye.z;
      const d = Math.hypot(tx, ty, tz);
      if (d > reach + c.def.radius + 0.3) continue;
      const cos = (tx * dir.x + ty * dir.y + tz * dir.z) / (d || 1);
      if (cos < arcCos && d > c.def.radius + 0.6) continue;
      if (!this.visible(eye.x, eye.y, eye.z, c.cx, c.cy, c.cz)) continue;
      dealt += this.applyHit(c, damage, knockback, eye.x, eye.z);
    }
    if (this.boss) {
      const t = this.boss.rayHit(eye, dir, reach + 1);
      if (t !== null) dealt += this.hitBoss(damage, eye.x + dir.x * t, eye.y + dir.y * t, eye.z + dir.z * t);
    }
    return dealt;
  }

  /** Distance to the first creature along a ray, or null. */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, reach: number): number | null {
    let best: number | null = null;
    for (const c of this.creatures) {
      const tx = c.cx - o.x, ty = c.cy - o.y, tz = c.cz - o.z;
      const t = tx * d.x + ty * d.y + tz * d.z;
      if (t < 0 || t > reach + c.def.radius) continue;
      const px = tx - d.x * t, py = ty - d.y * t, pz = tz - d.z * t;
      const r = Math.max(c.def.radius, c.def.height / 2) + 0.15;
      if (px * px + py * py + pz * pz < r * r && (best === null || t < best)) best = t;
    }
    const bt = this.boss?.rayHit(o, d, reach);
    if (bt !== undefined && bt !== null && (best === null || bt < best)) best = bt;
    return best;
  }

  fire(kind: ProjKind, x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, damage: number, knockback: number, blast = 0, enemy = kind === 'rock' || kind === 'feather') {
    let mesh: THREE.Object3D;
    if (kind === 'arrow') mesh = new THREE.Mesh(itemModel(item('wooden_arrow')), this.hooks.projectileMaterial);
    else if (kind === 'bomb') mesh = new THREE.Mesh(itemModel(item('bomb')), this.hooks.projectileMaterial);
    else if (kind === 'bolt') mesh = new THREE.Mesh(this.boltGeo, this.hooks.projectileMaterial);
    else if (kind === 'drill') mesh = new THREE.Mesh(this.drillGeo, this.hooks.projectileMaterial);
    else if (kind === 'feather') mesh = new THREE.Mesh(this.featherGeo, this.hooks.projectileMaterial);
    else if (kind === 'gust') mesh = new THREE.Mesh(this.gustGeo, this.hooks.projectileMaterial);
    else mesh = new THREE.Mesh(this.rockGeo, this.hooks.projectileMaterial);
    mesh.castShadow = kind !== 'bolt' && kind !== 'gust';
    this.group.add(mesh);
    const g = kind === 'arrow' ? 9 : kind === 'bomb' ? 20 : kind === 'rock' ? 12 : 0;
    this.projectiles.push({
      kind, x, y, z, vx: dx * speed, vy: dy * speed + (kind === 'bomb' ? 3 : 0), vz: dz * speed, gravity: g, damage, knockback,
      enemy, life: kind === 'bomb' ? 10 : kind === 'drill' ? 1.4 : kind === 'gust' ? 1.1 : 5, stuck: false, fuse: enemy ? 1.8 : 2.2, blast, mesh, hit: new Set(), bossCd: 0,
    });
  }

  /** Explosion: damages everything around and carves the terrain. Enemy
   *  bombs only hurt the player and leave the ground (and your town) intact. */
  explode(x: number, y: number, z: number, r: number, damage: number, px: number, py: number, pz: number, hostile = false) {
    if (!hostile) this.hooks.blast(x, y, z, r);
    this.hooks.particles(x, y, z, 0, 1, 0, 0xffa040, 40, 9);
    this.hooks.particles(x, y, z, 0, 1, 0, 0x404040, 30, 6);
    this.hooks.flash(x, y, z, 0xffa050, 18, 0.5);
    this.hooks.sound('explode', x, y, z);
    if (!hostile) {
      for (const c of [...this.creatures]) {
        const d = Math.hypot(c.cx - x, c.cy - y, c.cz - z);
        if (d < r + 1.5) this.applyHit(c, damage * (1 - d / (r + 2)), 12, x, z);
      }
      if (this.boss && this.boss.hitTest(x, y, z, r + 1) >= 0) this.hitBoss(damage, x, y, z);
    }
    const pd = Math.hypot(px - x, py + 0.9 - y, pz - z);
    if (pd < r + 1) this.hooks.hurtPlayer(Math.round(damage * (hostile ? 1 : 0.5) * (1 - pd / (r + 2))), x, z, 10);
    this.hooks.shake(Math.max(0, 1 - pd / 30) * 0.8);
  }

  // -------------------------------------------------------------------- update

  update(dt: number, px: number, py: number, pz: number, time: number, pvx = 0, pvz = 0) {
    // Spawning.
    this.spawnTimer -= dt * this.spawnBoost;
    if (this.spawnTimer <= 0 && this.spawning) {
      this.spawnTimer = 0.9 + Math.random() * 0.8;
      this.trySpawn(px, py, pz);
    }

    const ctx = {
      px, py, pz, dt, world: this.world,
      distance: (x: number, y: number, z: number, n: [number, number, number]) => this.world.distance(x, y, z, n),
      throwAt: (c: Creature, tx: number, ty: number, tz: number) => {
        const r = c.def.ranged!;
        const sx = c.x, sy = c.y + c.def.height * 0.9, sz = c.z;
        const dx = tx - sx, dz = tz - sz, dist = Math.hypot(dx, dz);
        // Lob: aim above the target to compensate for gravity.
        const bomb = r.projectile === 'bomb';
        const flight = dist / r.speed;
        const dy = ty - sy + 0.5 * (bomb ? 20 : 12) * flight * flight;
        const l = Math.hypot(dx, dy, dz) || 1;
        if (bomb) this.fire('bomb', sx, sy, sz, dx / l, dy / l - 0.15, dz / l, r.speed, r.damage, 8, 2.4, true);
        else this.fire('rock', sx, sy, sz, dx / l, dy / l, dz / l, r.speed, r.damage, 6);
      },
    };
    for (const c of [...this.creatures]) {
      // Keep creatures inside loaded terrain; freeze them otherwise.
      if (!this.hooks.isLoaded(c.x, c.z)) { c.idle += dt; if (c.idle > 5) this.remove(c); continue; }
      think(c, ctx);
      // Walkers and hoppers float up and are slowed in water.
      if (c.def.ai !== 'flyer' && this.hooks.inWater(c.x, c.y + c.def.height * 0.5, c.z)) {
        c.vy += 30 * dt;
        c.vy *= Math.pow(0.15, dt);
        c.vx *= Math.pow(0.35, dt); c.vz *= Math.pow(0.35, dt);
      }
      if (c.y < -5 || c.idle > 12) { this.remove(c); continue; }
      // Contact damage.
      const dx = px - c.x, dz = pz - c.z;
      const horiz = Math.hypot(dx, dz);
      const overlapY = py < c.y + c.def.height && py + 1.8 > c.y;
      if (horiz < c.def.radius + 0.45 && overlapY) {
        const heavy = c.def.kbResist > 0.8;
        if (this.hooks.hurtPlayer(c.def.damage, c.x, c.z, heavy ? 14 : 7) > 0) c.attack = Math.max(c.attack, 0.6);
      }
      // Visual.
      const vis = this.visuals.get(c.uid);
      if (vis) {
        vis.v.root.position.set(c.x, c.y, c.z);
        vis.v.root.rotation.y = c.yaw;
        vis.v.animate(c, dt);
        (vis.mat.userData.flash as { value: number }).value = c.hitFlash * 0.8;
      }
    }

    // Boss.
    const b = this.boss;
    if (b) {
      const c = b.center;
      if (Math.hypot(c.x - px, c.z - pz) > 160) b.leaving = true;
      b.update({
        px, py, pz, pvx, pvz, dt,
        underground: (x, y, z) => y < this.hooks.surfaceTop(x, z) - 0.3,
        distance: (x, y, z) => { this.world.prepare(x, y, z, 4); return this.world.distance(x, y, z, this.n); },
        carve: (x, y, z, r) => this.hooks.carve(x, y, z, r, false),
        erupt: (x, y, z) => {
          this.hooks.particles(x, y, z, 0, 1, 0, 0x8a6a4a, 26, 8);
          this.hooks.particles(x, y, z, 0, 1, 0, 0x9a98a2, 18, 6);
          this.hooks.sound('explode', x, y, z);
          this.hooks.shake(Math.max(0, 0.9 - Math.hypot(x - px, z - pz) / 40));
        },
        spit: (x, y, z, tx, ty, tz) => {
          const dx = tx - x, dy = ty - y, dz = tz - z, l = Math.hypot(dx, dy, dz) || 1;
          for (let k = -1; k <= 1; k++) this.fire('rock', x, y, z, dx / l + k * 0.12, dy / l + 0.15, dz / l - k * 0.12, 22, 20, 7);
        },
        feathers: (x, y, z, tx, ty, tz, count, damage) => {
          const dx = tx - x, dy = ty - y, dz = tz - z, l = Math.hypot(dx, dy, dz) || 1;
          const sx = -dz / l, sz = dx / l;
          for (let k = 0; k < count; k++) {
            const o = (k - (count - 1) / 2) * 0.1;
            this.fire('feather', x, y, z, dx / l + sx * o, dy / l, dz / l + sz * o, 26, damage, 6);
          }
        },
        summon: (id, x, y, z) => { this.spawn(CREATURES[id], x, y, z); this.hooks.particles(x, y, z, 0, 1, 0, 0xdce4ee, 12, 4); },
        gust: (x, y, z, strength) => {
          this.hooks.pushPlayer(x, z, strength);
          for (let i = 0; i < 3; i++) this.hooks.particles(x + (px - x) * i / 3, y + (py - y) * i / 3, z + (pz - z) * i / 3, px - x, 0, pz - z, 0xf0f6ff, 14, 9);
        },
        sound: name => this.hooks.sound(name, b.center.x, b.center.y, b.center.z),
        hurtPlayer: (d, fx, fz, kb) => this.hooks.hurtPlayer(d, fx, fz, kb),
        worldHeight: this.field.sy,
      });
      if (b.departed) { this.group.remove(b.group); this.boss = null; }
    }

    // Projectiles.
    const n = this.n;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      let dead = p.life <= 0;
      if (!p.stuck) {
        if (p.kind === 'bolt') {
          // Home in on the nearest creature ahead.
          let best: Creature | null = null, bd = 22;
          for (const c of this.creatures) {
            const d = Math.hypot(c.cx - p.x, c.cy - p.y, c.cz - p.z);
            if (d < bd) { bd = d; best = c; }
          }
          if (best) {
            const sp = Math.hypot(p.vx, p.vy, p.vz);
            const tx = (best.cx - p.x) / bd * sp, ty = (best.cy - p.y) / bd * sp, tz = (best.cz - p.z) / bd * sp;
            const k = Math.min(1, dt * 4);
            p.vx += (tx - p.vx) * k; p.vy += (ty - p.vy) * k; p.vz += (tz - p.vz) * k;
          }
          if (Math.random() < 0.5) this.hooks.particles(p.x, p.y, p.z, 0, 0, 0, 0x7af0ff, 1, 0.5);
          if (Math.floor(time * 20) % 3 === 0) this.hooks.flash(p.x, p.y, p.z, 0x46d0ff, 7, 0.12);
        }
        p.vy -= p.gravity * dt;
        const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy, p.vz) * dt / 0.3));
        for (let s = 0; s < steps && !dead && !p.stuck; s++) {
          p.x += p.vx * dt / steps; p.y += p.vy * dt / steps; p.z += p.vz * dt / steps;
          this.world.prepare(p.x, p.y, p.z, 2);
          const wd = this.world.distance(p.x, p.y, p.z, n);
          if (p.kind === 'gust') {
            // Wind passes through terrain; it only scatters what it touches.
            if (Math.random() < 0.4) this.hooks.particles(p.x, p.y, p.z, -p.vx * 0.03, 0, -p.vz * 0.03, 0xf0f6ff, 1, 1.2);
          } else if (p.kind === 'drill') {
            // Boring fang: tunnels through terrain instead of stopping.
            if (wd < 0.3) {
              this.drillCarve -= dt / steps;
              if (this.drillCarve <= 0) { this.drillCarve = 0.07; this.hooks.carve(p.x, p.y, p.z, 1.1, true); }
              if (Math.random() < 0.3) this.hooks.particles(p.x, p.y, p.z, -p.vx * 0.05, 0.5, -p.vz * 0.05, 0xa09080, 2, 2);
            }
          } else if (wd < 0.08) {
            if (p.kind === 'bomb') {
              // Bounce.
              p.x += n[0] * (0.1 - wd); p.y += n[1] * (0.1 - wd); p.z += n[2] * (0.1 - wd);
              const vn = p.vx * n[0] + p.vy * n[1] + p.vz * n[2];
              p.vx = (p.vx - 1.6 * vn * n[0]) * 0.6; p.vy = (p.vy - 1.6 * vn * n[1]) * 0.6; p.vz = (p.vz - 1.6 * vn * n[2]) * 0.6;
            } else if (p.kind === 'arrow') {
              p.stuck = true; p.life = Math.min(p.life, 2.5);
              this.hooks.particles(p.x, p.y, p.z, n[0], n[1], n[2], 0xc0a070, 3, 2);
            } else {
              this.hooks.particles(p.x, p.y, p.z, n[0], n[1], n[2], p.kind === 'bolt' ? 0x7af0ff : 0x9a98a2, 8, 3);
              dead = true;
            }
          }
          if (p.enemy) {
            if (p.kind !== 'bomb' && Math.hypot(px - p.x, pz - p.z) < 0.55 && p.y > py - 0.1 && p.y < py + 1.9) {
              this.hooks.hurtPlayer(p.damage, p.x - p.vx, p.z - p.vz, p.knockback);
              this.hooks.particles(p.x, p.y, p.z, 0, 1, 0, 0x9a98a2, 6, 3);
              dead = true;
            }
          } else if (p.kind !== 'bomb') {
            p.bossCd -= dt / steps;
            // A gust is a broad blade of wind: it catches anything near its path.
            const reach = p.kind === 'gust' ? 1.0 : 0.2;
            if (this.boss && p.bossCd <= 0 && this.boss.hitTest(p.x, p.y, p.z, reach) >= 0) {
              this.hitBoss(p.damage, p.x, p.y, p.z);
              p.bossCd = 0.25;
              if (p.kind !== 'drill' && p.kind !== 'gust') { dead = true; break; }
            }
            for (const c of this.creatures) {
              if (p.hit.has(c.uid)) continue;
              const r = Math.max(c.def.radius, c.def.height / 2) + reach;
              if ((c.cx - p.x) ** 2 + (c.cy - p.y) ** 2 + (c.cz - p.z) ** 2 < r * r) {
                p.hit.add(c.uid);
                this.applyHit(c, p.damage, p.knockback, p.x - p.vx, p.z - p.vz);
                if (p.kind === 'bolt') this.hooks.particles(p.x, p.y, p.z, 0, 1, 0, 0x7af0ff, 12, 4);
                if (p.kind !== 'drill' && p.kind !== 'gust') { dead = true; break; }
              }
            }
          }
        }
        if (p.kind === 'bomb') {
          p.fuse -= dt;
          if (Math.random() < 0.6) this.hooks.particles(p.x, p.y + 0.25, p.z, 0, 1, 0, 0xffc050, 1, 1);
          if (p.fuse <= 0) { this.explode(p.x, p.y, p.z, p.blast, p.damage, px, py, pz, p.enemy); dead = true; }
        }
      }
      if (dead) { this.group.remove(p.mesh); this.projectiles.splice(i, 1); continue; }
      p.mesh.position.set(p.x, p.y, p.z);
      if (!p.stuck && p.kind !== 'bomb') {
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
        // Model points +y: align it with the velocity.
        p.mesh.quaternion.setFromUnitVectors(UP, TMP.set(p.vx / sp, p.vy / sp, p.vz / sp));
      } else if (p.kind === 'bomb') p.mesh.rotation.x += dt * 6;
      if (p.kind === 'gust') p.mesh.rotateY(p.life * 14);
    }
  }

  clear() {
    for (const c of [...this.creatures]) this.remove(c);
    if (this.boss) { this.group.remove(this.boss.group); this.boss = null; }
    for (const p of this.projectiles) this.group.remove(p.mesh);
    this.projectiles = [];
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
