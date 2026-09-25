// Creatures: data-driven definitions plus simple, readable AI behaviours
// (hopper, walker, flyer, thrower). Bodies collide with the same distance
// field as the player (terrain + pieces + furniture).

import type { WorldCollision } from '../world/collision';

export type AIKind = 'hopper' | 'walker' | 'flyer' | 'thrower' | 'crawler';
export type SpawnEnv = 'surface' | 'cave' | 'deep' | 'depths';

export interface Drop { item: string; min: number; max: number; chance: number }

export interface CreatureDef {
  id: string;
  name: string;
  hp: number;
  damage: number;
  defense: number;
  speed: number;
  ai: AIKind;
  radius: number;
  height: number;
  /** 0 = full knockback, 1 = immune. */
  kbResist: number;
  drops: Drop[];
  spawn: { env: SpawnEnv; time: 'day' | 'night' | 'any'; weight: number; biomes?: number[] } | null;
  /** Visual tint for variants (multiplies the base model colours). */
  tint?: number;
  /** Model to use when this is a variant of another creature. */
  model?: string;
  /** Particle / blood colour. */
  color: number;
  /** Ranged attack (throwers). */
  ranged?: { damage: number; interval: number; speed: number; range: number };
  boss?: boolean;
}

export const CREATURES: Record<string, CreatureDef> = {
  glob: {
    id: 'glob', name: 'Glob', hp: 18, damage: 8, defense: 0, speed: 4.5, ai: 'hopper', radius: 0.55, height: 0.8, kbResist: 0,
    drops: [{ item: 'gel', min: 1, max: 3, chance: 1 }, { item: 'coin', min: 1, max: 2, chance: 0.6 }],
    spawn: { env: 'surface', time: 'any', weight: 6, biomes: [0] }, color: 0x4ec87a,
  },
  sand_glob: {
    id: 'sand_glob', name: 'Sand Glob', hp: 26, damage: 11, defense: 2, speed: 5, ai: 'hopper', radius: 0.55, height: 0.8, kbResist: 0.1, model: 'glob', tint: 0xf0d070,
    drops: [{ item: 'gel', min: 1, max: 3, chance: 1 }, { item: 'sand', min: 2, max: 4, chance: 0.5 }, { item: 'coin', min: 1, max: 3, chance: 0.7 }],
    spawn: { env: 'surface', time: 'any', weight: 6, biomes: [1] }, color: 0xe0c060,
  },
  frost_glob: {
    id: 'frost_glob', name: 'Frost Glob', hp: 28, damage: 11, defense: 3, speed: 4.5, ai: 'hopper', radius: 0.55, height: 0.8, kbResist: 0.1, model: 'glob', tint: 0xb8ecff,
    drops: [{ item: 'gel', min: 1, max: 3, chance: 1 }, { item: 'ice', min: 1, max: 3, chance: 0.5 }, { item: 'coin', min: 1, max: 3, chance: 0.7 }],
    spawn: { env: 'surface', time: 'any', weight: 6, biomes: [2] }, color: 0xa8d8f0,
  },
  blight_glob: {
    id: 'blight_glob', name: 'Blight Glob', hp: 42, damage: 16, defense: 5, speed: 5.5, ai: 'hopper', radius: 0.6, height: 0.85, kbResist: 0.2, model: 'glob', tint: 0xc080f0,
    drops: [{ item: 'gel', min: 2, max: 4, chance: 1 }, { item: 'coin', min: 2, max: 5, chance: 1 }],
    spawn: { env: 'surface', time: 'any', weight: 5, biomes: [3] }, color: 0x9a5ac0,
  },
  dune_crawler: {
    id: 'dune_crawler', name: 'Dune Crawler', hp: 42, damage: 15, defense: 8, speed: 2.8, ai: 'crawler', radius: 0.55, height: 0.7, kbResist: 0.5, model: 'rockmite', tint: 0xf0d8a0,
    drops: [{ item: 'sandstone', min: 2, max: 5, chance: 1 }, { item: 'coin', min: 2, max: 4, chance: 1 }, { item: 'swift_boots', min: 1, max: 1, chance: 0.02 }],
    spawn: { env: 'surface', time: 'any', weight: 3, biomes: [1] }, color: 0xd8b880,
  },
  rotwing: {
    id: 'rotwing', name: 'Rotwing', hp: 38, damage: 18, defense: 4, speed: 6, ai: 'flyer', radius: 0.5, height: 1, kbResist: 0.2, model: 'gloomwisp', tint: 0xc080ff,
    drops: [{ item: 'coin', min: 2, max: 5, chance: 1 }, { item: 'bat_wing', min: 1, max: 1, chance: 0.3 }],
    spawn: { env: 'surface', time: 'any', weight: 3, biomes: [3] }, color: 0x8a4ab0,
  },
  ember_glob: {
    id: 'ember_glob', name: 'Ember Glob', hp: 75, damage: 26, defense: 12, speed: 6, ai: 'hopper', radius: 0.65, height: 0.9, kbResist: 0.3, model: 'glob', tint: 0xff8040,
    drops: [{ item: 'gel', min: 3, max: 5, chance: 1 }, { item: 'emberite', min: 1, max: 3, chance: 0.5 }, { item: 'coin', min: 4, max: 9, chance: 1 }],
    spawn: { env: 'depths', time: 'any', weight: 5 }, color: 0xff6a2a,
  },
  cinder_bat: {
    id: 'cinder_bat', name: 'Cinder Bat', hp: 44, damage: 24, defense: 8, speed: 8.5, ai: 'flyer', radius: 0.35, height: 0.7, kbResist: 0.1, model: 'duskwing', tint: 0xff9050,
    drops: [{ item: 'bat_wing', min: 1, max: 2, chance: 0.6 }, { item: 'coin', min: 3, max: 6, chance: 1 }],
    spawn: { env: 'depths', time: 'any', weight: 4 }, color: 0xff7030,
  },
  deep_glob: {
    id: 'deep_glob', name: 'Deep Glob', hp: 34, damage: 13, defense: 2, speed: 5, ai: 'hopper', radius: 0.6, height: 0.85, kbResist: 0.1,
    drops: [{ item: 'gel', min: 2, max: 4, chance: 1 }, { item: 'coin', min: 1, max: 3, chance: 0.8 }],
    spawn: { env: 'cave', time: 'any', weight: 4 }, color: 0x3a8ae8,
  },
  shambler: {
    id: 'shambler', name: 'Shambler', hp: 45, damage: 14, defense: 4, speed: 2.6, ai: 'walker', radius: 0.4, height: 1.8, kbResist: 0.4,
    drops: [{ item: 'coin', min: 2, max: 5, chance: 1 }, { item: 'red_cap', min: 1, max: 1, chance: 0.2 }, { item: 'feather_charm', min: 1, max: 1, chance: 0.02 }],
    spawn: { env: 'surface', time: 'night', weight: 7 }, color: 0x7a2a2a,
  },
  gloomwisp: {
    id: 'gloomwisp', name: 'Gloomwisp', hp: 30, damage: 16, defense: 2, speed: 5.5, ai: 'flyer', radius: 0.5, height: 1, kbResist: 0.2,
    drops: [{ item: 'coin', min: 2, max: 4, chance: 1 }, { item: 'glass_bottle', min: 1, max: 1, chance: 0.2 }],
    spawn: { env: 'surface', time: 'night', weight: 3 }, color: 0xb02030,
  },
  duskwing: {
    id: 'duskwing', name: 'Duskwing', hp: 16, damage: 11, defense: 2, speed: 6.5, ai: 'flyer', radius: 0.35, height: 0.7, kbResist: 0,
    drops: [{ item: 'bat_wing', min: 1, max: 1, chance: 0.5 }, { item: 'coin', min: 1, max: 2, chance: 0.5 }],
    spawn: { env: 'cave', time: 'any', weight: 5 }, color: 0x6a4a6e,
  },
  rockmite: {
    id: 'rockmite', name: 'Rockmite', hp: 50, damage: 16, defense: 10, speed: 2.2, ai: 'crawler', radius: 0.55, height: 0.7, kbResist: 0.6,
    drops: [{ item: 'stone', min: 2, max: 5, chance: 1 }, { item: 'copper_ore', min: 1, max: 3, chance: 0.5 }, { item: 'iron_ore', min: 1, max: 2, chance: 0.3 }],
    spawn: { env: 'cave', time: 'any', weight: 3 }, color: 0x8a8890,
  },
  hollow_miner: {
    id: 'hollow_miner', name: 'Hollow Miner', hp: 70, damage: 18, defense: 8, speed: 2.4, ai: 'thrower', radius: 0.4, height: 1.8, kbResist: 0.3,
    drops: [{ item: 'barbed_hook', min: 1, max: 1, chance: 0.18 }, { item: 'iron_ore', min: 2, max: 5, chance: 0.7 }, { item: 'coin', min: 3, max: 8, chance: 1 }, { item: 'miners_band', min: 1, max: 1, chance: 0.03 }],
    spawn: { env: 'deep', time: 'any', weight: 4 }, color: 0xe6dcc0,
    ranged: { damage: 14, interval: 2.4, speed: 17, range: 16 },
  },
};

export class Creature {
  x: number; y: number; z: number;
  vx = 0; vy = 0; vz = 0;
  yaw = 0;
  hp: number;
  grounded = false;
  alive = true;
  /** Seconds since spawn / generic timers for AI & animation. */
  t = 0;
  cooldown = 0;
  hitFlash = 0;
  stuck = 0;
  wander = Math.random() * Math.PI * 2;
  /** Seconds since the creature last saw/was near the player (despawn). */
  idle = 0;
  /** Boss-specific state. */
  phase = 0;
  readonly uid: number;
  private static next = 1;
  private n: [number, number, number] = [0, 0, 0];

  constructor(readonly def: CreatureDef, x: number, y: number, z: number) {
    this.uid = Creature.next++;
    this.x = x; this.y = y; this.z = z;
    this.hp = def.hp;
  }

  get cx() { return this.x; }
  get cy() { return this.y + this.def.height / 2; }
  get cz() { return this.z; }

  /** Push the body out of solid space; spheres at feet and head. */
  private resolve(world: WorldCollision) {
    const r = this.def.radius;
    const offs = this.def.height > r * 2.2 ? [r, this.def.height - r] : [Math.max(r, this.def.height / 2)];
    const n = this.n;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (let i = 0; i < offs.length; i++) {
        const d = world.distance(this.x, this.y + offs[i], this.z, n);
        if (d >= r) continue;
        const push = r - d;
        moved = true;
        if (i === 0 && n[1] > 0.55 && this.def.ai !== 'flyer') {
          this.y += Math.min(push / n[1], 0.5);
          if (this.vy < 0) this.vy = 0;
          this.grounded = true;
        } else {
          this.x += n[0] * push; this.y += n[1] * push; this.z += n[2] * push;
          const vn = this.vx * n[0] + this.vy * n[1] + this.vz * n[2];
          if (vn < 0) { this.vx -= vn * n[0]; this.vy -= vn * n[1]; this.vz -= vn * n[2]; }
          if (n[1] > 0.55) this.grounded = true;
        }
      }
      if (!moved) break;
    }
  }

  /** Integrate physics (gravity unless flying). */
  physics(dt: number, world: WorldCollision, gravity = 24) {
    world.prepare(this.x, this.y + 1, this.z, 3);
    if (this.def.ai !== 'flyer') this.vy = Math.max(-40, this.vy - gravity * dt);
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy, this.vz) * dt / 0.25));
    const h = dt / steps;
    this.grounded = false;
    for (let s = 0; s < steps; s++) {
      this.x += this.vx * h; this.y += this.vy * h; this.z += this.vz * h;
      this.resolve(world);
    }
    if (this.grounded && this.def.ai !== 'hopper') {
      const f = Math.pow(0.02, dt);
      this.vx *= f; this.vz *= f;
    }
  }

  knock(fromX: number, fromZ: number, strength: number) {
    const k = strength * (1 - this.def.kbResist);
    const dx = this.x - fromX, dz = this.z - fromZ, l = Math.hypot(dx, dz) || 1;
    this.vx += (dx / l) * k;
    this.vz += (dz / l) * k;
    this.vy += k * 0.45;
  }
}

export interface AIContext {
  px: number; py: number; pz: number;
  dt: number;
  world: WorldCollision;
  /** Signed distance to terrain at a point (flyers avoid walls). */
  distance(x: number, y: number, z: number, n: [number, number, number]): number;
  throwAt(c: Creature, tx: number, ty: number, tz: number): void;
}

const tmpN: [number, number, number] = [0, 0, 0];

/** Advance one creature's behaviour and physics. */
export function think(c: Creature, ctx: AIContext) {
  const { dt } = ctx;
  c.t += dt;
  c.cooldown = Math.max(0, c.cooldown - dt);
  c.hitFlash = Math.max(0, c.hitFlash - dt * 6);
  const dx = ctx.px - c.x, dz = ctx.pz - c.z, dy = ctx.py + 0.9 - c.cy;
  const dist = Math.hypot(dx, dz);
  const aggro = dist < 38;
  const d = c.def;

  switch (d.ai) {
    case 'hopper': {
      if (c.grounded) {
        c.vx *= Math.pow(0.001, dt); c.vz *= Math.pow(0.001, dt);
        if (c.cooldown <= 0) {
          const dir = aggro ? Math.atan2(dx, dz) : (c.wander += (Math.random() - 0.5) * 1.5);
          const big = aggro && Math.random() < 0.35;
          const sp = aggro ? d.speed : d.speed * 0.4;
          c.vx = Math.sin(dir) * sp; c.vz = Math.cos(dir) * sp;
          c.vy = big ? 9.5 : 6.5;
          c.yaw = dir;
          c.cooldown = aggro ? 0.9 + Math.random() * 0.8 : 1.8 + Math.random() * 2;
        }
      }
      c.physics(dt, ctx.world);
      break;
    }
    case 'walker':
    case 'crawler':
    case 'thrower': {
      let tx = dx, tz = dz;
      let want = aggro ? d.speed : d.speed * 0.35;
      if (!aggro) { c.wander += (Math.random() - 0.5) * dt; tx = Math.sin(c.wander); tz = Math.cos(c.wander); }
      if (d.ai === 'thrower' && aggro && d.ranged) {
        // Keep some distance and throw.
        if (dist < 7) want = -d.speed * 0.8;
        else if (dist < 12) want = 0;
        if (c.cooldown <= 0 && dist < d.ranged.range && Math.abs(dy) < 10) {
          ctx.throwAt(c, ctx.px, ctx.py + 1.2, ctx.pz);
          c.cooldown = d.ranged.interval * (0.8 + Math.random() * 0.4);
        }
      }
      const l = Math.hypot(tx, tz) || 1;
      const targetVx = (tx / l) * want, targetVz = (tz / l) * want;
      if (c.grounded) {
        c.vx += (targetVx - c.vx) * Math.min(1, dt * 8);
        c.vz += (targetVz - c.vz) * Math.min(1, dt * 8);
      }
      c.yaw = Math.atan2(tx, tz);
      const ox = c.x, oz = c.z;
      c.physics(dt, ctx.world);
      // Blocked while trying to move: hop over it.
      const moved = Math.hypot(c.x - ox, c.z - oz);
      c.stuck = moved < Math.abs(want) * dt * 0.3 && Math.abs(want) > 0.1 ? c.stuck + dt : 0;
      if (c.grounded && c.stuck > 0.25) { c.vy = d.ai === 'crawler' ? 6 : 7.5; c.stuck = 0; }
      break;
    }
    case 'flyer': {
      // Swoop toward the player with a wobble; avoid walls using the distance field.
      const bat = d.id === 'duskwing';
      const wob = Math.sin(c.t * (bat ? 7 : 2.2) + c.uid) * (bat ? 3 : 1.5);
      let tx = dx, ty = dy + (bat ? Math.sin(c.t * 5 + c.uid) * 1.5 : 1.2 + Math.sin(c.t * 1.3) * 1.2), tz = dz;
      if (!aggro) { c.wander += (Math.random() - 0.5) * dt * 2; tx = Math.sin(c.wander) * 5; tz = Math.cos(c.wander) * 5; ty = 0; }
      const l = Math.hypot(tx, ty, tz) || 1;
      const sp = aggro ? d.speed : d.speed * 0.4;
      let ax = (tx / l) * sp + Math.cos(c.t * 3) * wob, ay = (ty / l) * sp, az = (tz / l) * sp + Math.sin(c.t * 3) * wob;
      const wd = ctx.distance(c.x, c.cy, c.z, tmpN);
      if (wd < 1.5) { ax += tmpN[0] * 8; ay += tmpN[1] * 8; az += tmpN[2] * 8; }
      const k = Math.min(1, dt * (bat ? 4 : 1.8));
      c.vx += (ax - c.vx) * k; c.vy += (ay - c.vy) * k; c.vz += (az - c.vz) * k;
      c.yaw = Math.atan2(c.vx, c.vz);
      c.physics(dt, ctx.world, 0);
      break;
    }
  }
  c.idle = dist > 70 ? c.idle + dt : 0;
}
