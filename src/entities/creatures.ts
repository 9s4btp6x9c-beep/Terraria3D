// Creatures: data-driven definitions plus simple, readable AI behaviours
// (hopper, walker, flyer, thrower). Bodies collide with the same distance
// field as the player (terrain + pieces + furniture).

import type { WorldCollision } from '../world/collision';
import type { EventKind } from './events';

export type AIKind = 'hopper' | 'walker' | 'flyer' | 'thrower' | 'crawler' | 'pouncer' | 'burrower';
export type SpawnEnv = 'surface' | 'cave' | 'deep' | 'depths' | 'sky';

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
  spawn: { env: SpawnEnv; time: 'day' | 'night' | 'any'; weight: number; biomes?: number[]; zone?: 'mushroom' } | null;
  /** Visual tint for variants (multiplies the base model colours). */
  tint?: number;
  /** Model to use when this is a variant of another creature. */
  model?: string;
  /** Texture layer override for the model's main surface (e.g. red gel). */
  skin?: string;
  /** Particle / blood colour. */
  color: number;
  /** Ranged attack (throwers). Bombs explode on a fuse instead of on impact. */
  ranged?: { damage: number; interval: number; speed: number; range: number; projectile?: 'rock' | 'bomb' };
  boss?: boolean;
  /** Only spawns during this world event (replaces `spawn`). */
  event?: { kind: EventKind; weight: number };
  /** Distance at which it notices the player (default 38 m). */
  aggro?: number;
  /**
   * Peaceful by day: it wanders and grazes, and only turns on the player once
   * struck (its neighbours join in). At night it hunts like anything else.
   */
  docile?: boolean;
  /** Unharmed by lava (creatures of the volcanoes and the Ember Depths). */
  fireproof?: boolean;
}

export const CREATURES: Record<string, CreatureDef> = {
  blob: {
    id: 'blob', name: 'Blob', hp: 18, damage: 8, defense: 0, speed: 4.5, ai: 'hopper', radius: 0.55, height: 0.8, kbResist: 0,
    drops: [{ item: 'gel', min: 1, max: 3, chance: 1 }, { item: 'coin', min: 1, max: 2, chance: 0.6 }],
    spawn: { env: 'surface', time: 'any', weight: 6, biomes: [0] }, docile: true, color: 0x8aaa4e,
  },
  dune_blob: {
    id: 'dune_blob', name: 'Dune Blob', hp: 26, damage: 11, defense: 2, speed: 5, ai: 'hopper', radius: 0.55, height: 0.8, kbResist: 0.1, model: 'blob', tint: 0xf0d070,
    drops: [{ item: 'gel', min: 1, max: 3, chance: 1 }, { item: 'sand', min: 2, max: 4, chance: 0.5 }, { item: 'coin', min: 1, max: 3, chance: 0.7 }],
    spawn: { env: 'surface', time: 'any', weight: 6, biomes: [1] }, docile: true, color: 0xe0c060,
  },
  frost_blob: {
    id: 'frost_blob', name: 'Frost Blob', hp: 28, damage: 11, defense: 3, speed: 4.5, ai: 'hopper', radius: 0.55, height: 0.8, kbResist: 0.1, model: 'blob', tint: 0xb8ecff,
    drops: [{ item: 'gel', min: 1, max: 3, chance: 1 }, { item: 'ice', min: 1, max: 3, chance: 0.5 }, { item: 'coin', min: 1, max: 3, chance: 0.7 }],
    spawn: { env: 'surface', time: 'any', weight: 6, biomes: [2] }, docile: true, color: 0xa8d8f0,
  },
  rift_blob: {
    id: 'rift_blob', name: 'Rift Blob', hp: 42, damage: 16, defense: 5, speed: 5.5, ai: 'hopper', radius: 0.6, height: 0.85, kbResist: 0.2, model: 'blob', skin: 'riftleaves', tint: 0xd0f0ff,
    drops: [{ item: 'gel', min: 2, max: 4, chance: 1 }, { item: 'coin', min: 2, max: 5, chance: 1 }],
    spawn: { env: 'surface', time: 'any', weight: 5, biomes: [3] }, color: 0x4ab8c8,
  },
  dune_crawler: {
    id: 'dune_crawler', name: 'Dune Crawler', hp: 42, damage: 15, defense: 8, speed: 2.8, ai: 'crawler', radius: 0.55, height: 0.7, kbResist: 0.5, model: 'rockmite', tint: 0xf0d8a0,
    drops: [{ item: 'sandstone', min: 2, max: 5, chance: 1 }, { item: 'coin', min: 2, max: 4, chance: 1 }, { item: 'swift_boots', min: 1, max: 1, chance: 0.02 }],
    spawn: { env: 'surface', time: 'any', weight: 3, biomes: [1] }, color: 0xd8b880,
  },
  dune_worm: {
    id: 'dune_worm', name: 'Dune Worm', hp: 170, damage: 24, defense: 6, speed: 11, ai: 'burrower', radius: 0.85, height: 1.7, kbResist: 1,
    drops: [{ item: 'coin', min: 10, max: 18, chance: 1 }, { item: 'sand', min: 4, max: 9, chance: 1 }, { item: 'sandstone', min: 2, max: 5, chance: 0.6 }, { item: 'swift_boots', min: 1, max: 1, chance: 0.05 }],
    spawn: { env: 'surface', time: 'any', weight: 1.2, biomes: [1] }, aggro: 42, fireproof: true, color: 0xd8b070,
  },
  rift_drifter: {
    id: 'rift_drifter', name: 'Riftdrifter', hp: 38, damage: 18, defense: 4, speed: 6, ai: 'flyer', radius: 0.5, height: 1, kbResist: 0.2, model: 'drifter', tint: 0x7af0ff,
    drops: [{ item: 'coin', min: 2, max: 5, chance: 1 }, { item: 'bat_wing', min: 1, max: 1, chance: 0.3 }],
    spawn: { env: 'surface', time: 'any', weight: 3, biomes: [3] }, color: 0x4ad8e8,
  },
  cinder_blob: {
    id: 'cinder_blob', name: 'Cinder Blob', hp: 75, damage: 26, defense: 12, speed: 6, ai: 'hopper', radius: 0.65, height: 0.9, kbResist: 0.3, model: 'blob', skin: 'ember', tint: 0xffffff,
    drops: [{ item: 'gel', min: 3, max: 5, chance: 1 }, { item: 'emberite', min: 1, max: 3, chance: 0.5 }, { item: 'coin', min: 4, max: 9, chance: 1 }],
    spawn: { env: 'depths', time: 'any', weight: 5 }, fireproof: true, color: 0xff6a2a,
  },
  cinder_bat: {
    id: 'cinder_bat', name: 'Cinder Bat', hp: 44, damage: 24, defense: 8, speed: 8.5, ai: 'flyer', radius: 0.35, height: 0.7, kbResist: 0.1, model: 'duskwing', tint: 0xff9050,
    drops: [{ item: 'bat_wing', min: 1, max: 2, chance: 0.6 }, { item: 'coin', min: 3, max: 6, chance: 1 }],
    spawn: { env: 'depths', time: 'any', weight: 4 }, fireproof: true, color: 0xff7030,
  },
  deep_blob: {
    id: 'deep_blob', name: 'Deep Blob', hp: 34, damage: 13, defense: 2, speed: 5, ai: 'hopper', radius: 0.6, height: 0.85, kbResist: 0.1, model: 'blob', tint: 0x80a8ff,
    drops: [{ item: 'gel', min: 2, max: 4, chance: 1 }, { item: 'coin', min: 1, max: 3, chance: 0.8 }],
    spawn: { env: 'cave', time: 'any', weight: 4 }, color: 0x3a8ae8,
  },
  rootwalker: {
    id: 'rootwalker', name: 'Rootwalker', hp: 45, damage: 14, defense: 4, speed: 2.6, ai: 'walker', radius: 0.4, height: 1.8, kbResist: 0.4,
    drops: [{ item: 'coin', min: 2, max: 5, chance: 1 }, { item: 'red_cap', min: 1, max: 1, chance: 0.2 }, { item: 'feather_charm', min: 1, max: 1, chance: 0.02 }],
    spawn: { env: 'surface', time: 'night', weight: 7 }, color: 0x6a5238,
  },
  drifter: {
    id: 'drifter', name: 'Drifter', hp: 30, damage: 16, defense: 2, speed: 5.5, ai: 'flyer', radius: 0.5, height: 1, kbResist: 0.2,
    drops: [{ item: 'coin', min: 2, max: 4, chance: 1 }, { item: 'glass_bottle', min: 1, max: 1, chance: 0.2 }],
    spawn: { env: 'surface', time: 'night', weight: 3 }, color: 0x9a8aff,
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
  ashdelver: {
    id: 'ashdelver', name: 'Ashdelver', hp: 70, damage: 18, defense: 8, speed: 2.4, ai: 'thrower', radius: 0.4, height: 1.8, kbResist: 0.3,
    drops: [{ item: 'barbed_hook', min: 1, max: 1, chance: 0.18 }, { item: 'iron_ore', min: 2, max: 5, chance: 0.7 }, { item: 'coin', min: 3, max: 8, chance: 1 }, { item: 'miners_band', min: 1, max: 1, chance: 0.03 }],
    spawn: { env: 'deep', time: 'any', weight: 4 }, fireproof: true, color: 0xff7a2a,
    ranged: { damage: 14, interval: 2.4, speed: 17, range: 16 },
  },
};

// ---- high sky (floating islands)
Object.assign(CREATURES, {
  gale_swift: {
    id: 'gale_swift', name: 'Gale Swift', hp: 42, damage: 17, defense: 5, speed: 9, ai: 'flyer', radius: 0.45, height: 0.8, kbResist: 0.1,
    drops: [{ item: 'sky_feather', min: 1, max: 3, chance: 0.85 }, { item: 'coin', min: 2, max: 5, chance: 1 }],
    spawn: { env: 'sky', time: 'any', weight: 5 }, aggro: 50, color: 0xdce4ee,
  },
  cloud_blob: {
    id: 'cloud_blob', name: 'Cloud Blob', hp: 38, damage: 14, defense: 4, speed: 5, ai: 'hopper', radius: 0.58, height: 0.85, kbResist: 0.1, model: 'blob', skin: 'glass', tint: 0xf4faff,
    drops: [{ item: 'gel', min: 2, max: 4, chance: 1 }, { item: 'aerite_ore', min: 1, max: 2, chance: 0.35 }, { item: 'coin', min: 1, max: 3, chance: 0.8 }],
    spawn: { env: 'sky', time: 'any', weight: 4 }, color: 0xe8f4ff,
  },
} satisfies Record<string, CreatureDef>);

// ---- glowing mushroom caverns
Object.assign(CREATURES, {
  sporeling: {
    id: 'sporeling', name: 'Sporeling', hp: 48, damage: 15, defense: 5, speed: 3.4, ai: 'walker', radius: 0.38, height: 1.0, kbResist: 0.2,
    drops: [{ item: 'glowcap', min: 1, max: 3, chance: 0.9 }, { item: 'coin', min: 2, max: 4, chance: 1 }],
    spawn: { env: 'cave', time: 'any', weight: 5, zone: 'mushroom' }, color: 0x5ad07a,
  },
  glowmoth: {
    id: 'glowmoth', name: 'Glowmoth', hp: 30, damage: 13, defense: 2, speed: 5.5, ai: 'flyer', radius: 0.45, height: 0.8, kbResist: 0.1,
    drops: [{ item: 'coin', min: 1, max: 3, chance: 1 }, { item: 'glowcap', min: 1, max: 1, chance: 0.4 }, { item: 'glow_charm', min: 1, max: 1, chance: 0.03 }],
    spawn: { env: 'cave', time: 'any', weight: 3, zone: 'mushroom' }, color: 0x9af0a8,
  },
} satisfies Record<string, CreatureDef>);

// ---- Rootwold (4), Ossuary Flats (5) and Amberwood (6)
Object.assign(CREATURES, {
  moss_blob: {
    id: 'moss_blob', name: 'Moss Blob', hp: 32, damage: 12, defense: 3, speed: 4.2, ai: 'hopper', radius: 0.6, height: 0.85, kbResist: 0.15, model: 'blob', skin: 'mossleaves', tint: 0xffffff,
    drops: [{ item: 'gel', min: 1, max: 3, chance: 1 }, { item: 'rootwood', min: 1, max: 2, chance: 0.4 }, { item: 'coin', min: 1, max: 3, chance: 0.8 }],
    spawn: { env: 'surface', time: 'any', weight: 6, biomes: [4] }, docile: true, color: 0x6a8a3e,
  },
  mossback: {
    id: 'mossback', name: 'Mossback', hp: 70, damage: 17, defense: 12, speed: 2.2, ai: 'crawler', radius: 0.75, height: 0.9, kbResist: 0.7,
    drops: [{ item: 'rootwood', min: 3, max: 6, chance: 1 }, { item: 'coin', min: 3, max: 6, chance: 1 }, { item: 'red_cap', min: 1, max: 2, chance: 0.3 }],
    spawn: { env: 'surface', time: 'any', weight: 3, biomes: [4] }, docile: true, color: 0x5e7a36,
  },
  bonepicker: {
    id: 'bonepicker', name: 'Bonepicker', hp: 40, damage: 17, defense: 5, speed: 8, ai: 'flyer', radius: 0.45, height: 0.8, kbResist: 0.1, model: 'gale_swift', skin: 'bone', tint: 0xfff0d8,
    drops: [{ item: 'fossil', min: 1, max: 3, chance: 0.8 }, { item: 'coin', min: 2, max: 4, chance: 1 }, { item: 'feather_charm', min: 1, max: 1, chance: 0.02 }],
    spawn: { env: 'surface', time: 'any', weight: 4, biomes: [5] }, aggro: 45, color: 0xe6dcc0,
  },
  salt_crawler: {
    id: 'salt_crawler', name: 'Saltback Crawler', hp: 48, damage: 15, defense: 10, speed: 2.9, ai: 'crawler', radius: 0.55, height: 0.7, kbResist: 0.5, model: 'rockmite', tint: 0xfff8f0,
    drops: [{ item: 'salt', min: 2, max: 5, chance: 1 }, { item: 'fossil', min: 1, max: 2, chance: 0.4 }, { item: 'coin', min: 2, max: 4, chance: 1 }],
    spawn: { env: 'surface', time: 'any', weight: 4, biomes: [5] }, docile: true, color: 0xf0ece4,
  },
  amber_blob: {
    id: 'amber_blob', name: 'Amber Blob', hp: 30, damage: 11, defense: 3, speed: 4.8, ai: 'hopper', radius: 0.55, height: 0.8, kbResist: 0.1, model: 'blob', skin: 'amber', tint: 0xffffff,
    drops: [{ item: 'gel', min: 1, max: 3, chance: 1 }, { item: 'coin', min: 3, max: 7, chance: 1 }],
    spawn: { env: 'surface', time: 'any', weight: 6, biomes: [6] }, docile: true, color: 0xffb040,
  },
  leafwing: {
    id: 'leafwing', name: 'Leafwing', hp: 28, damage: 13, defense: 2, speed: 6.5, ai: 'flyer', radius: 0.45, height: 0.8, kbResist: 0.1, model: 'glowmoth', skin: 'amberleaves', tint: 0xffffff,
    drops: [{ item: 'coin', min: 2, max: 4, chance: 1 }, { item: 'red_cap', min: 1, max: 1, chance: 0.25 }],
    spawn: { env: 'surface', time: 'any', weight: 3, biomes: [6] }, docile: true, color: 0xd8702a,
  },
} satisfies Record<string, CreatureDef>);

// ---- the Cinder Peaks (7): volcano slopes and lava tubes
Object.assign(CREATURES, {
  ash_blob: {
    id: 'ash_blob', name: 'Ash Blob', hp: 46, damage: 16, defense: 6, speed: 5, ai: 'hopper', radius: 0.6, height: 0.85, kbResist: 0.2, model: 'blob', skin: 'basalt', tint: 0xffffff,
    drops: [{ item: 'gel', min: 2, max: 3, chance: 1 }, { item: 'ash', min: 2, max: 4, chance: 0.6 }, { item: 'coin', min: 2, max: 5, chance: 1 }],
    spawn: { env: 'surface', time: 'any', weight: 6, biomes: [7] }, fireproof: true, color: 0x6a6668,
  },
  cinder_scout: {
    id: 'cinder_scout', name: 'Cinderbound Scout', hp: 80, damage: 19, defense: 9, speed: 2.8, ai: 'thrower', radius: 0.4, height: 1.8, kbResist: 0.3, model: 'ashdelver',
    drops: [{ item: 'basalt', min: 2, max: 5, chance: 0.8 }, { item: 'obsidian', min: 1, max: 2, chance: 0.25 }, { item: 'coin', min: 4, max: 9, chance: 1 }, { item: 'barbed_hook', min: 1, max: 1, chance: 0.08 }],
    spawn: { env: 'surface', time: 'any', weight: 3, biomes: [7] }, fireproof: true, color: 0xff7a2a,
    ranged: { damage: 16, interval: 2.4, speed: 17, range: 16 },
  },
} satisfies Record<string, CreatureDef>);

const EVENT_DROPS: Drop[] = [{ item: 'blood_shard', min: 1, max: 2, chance: 0.45 }];

// ---- world-event creatures (see entities/events.ts)
Object.assign(CREATURES, {
  spore_blob: {
    id: 'spore_blob', name: 'Spore Blob', hp: 40, damage: 15, defense: 4, speed: 6, ai: 'hopper', radius: 0.62, height: 0.9, kbResist: 0.15, model: 'blob', skin: 'spore',
    drops: [{ item: 'gel', min: 2, max: 4, chance: 1 }, { item: 'coin', min: 2, max: 4, chance: 1 }, ...EVENT_DROPS],
    spawn: null, event: { kind: 'sporefall', weight: 5 }, aggro: 55, color: 0x3ac8a0,
  },
  rotfang: {
    id: 'rotfang', name: 'Rotfang', hp: 60, damage: 18, defense: 6, speed: 7.5, ai: 'pouncer', radius: 0.5, height: 1.0, kbResist: 0.3,
    drops: [{ item: 'coin', min: 3, max: 6, chance: 1 }, { item: 'houndfang_charm', min: 1, max: 1, chance: 0.04 }, ...EVENT_DROPS],
    spawn: null, event: { kind: 'sporefall', weight: 4 }, aggro: 60, color: 0x3ac8a0,
  },
  sporebound: {
    id: 'sporebound', name: 'Sporebound', hp: 80, damage: 17, defense: 8, speed: 3.2, ai: 'walker', radius: 0.42, height: 1.85, kbResist: 0.5, model: 'rootwalker', skin: 'spore', tint: 0xb8e0d0,
    drops: [{ item: 'coin', min: 3, max: 7, chance: 1 }, { item: 'red_cap', min: 1, max: 2, chance: 0.4 }, ...EVENT_DROPS],
    spawn: null, event: { kind: 'sporefall', weight: 5 }, aggro: 55, color: 0x3ac8a0,
  },
  spore_drifter: {
    id: 'spore_drifter', name: 'Spore Drifter', hp: 45, damage: 16, defense: 4, speed: 6.5, ai: 'flyer', radius: 0.5, height: 1, kbResist: 0.2, model: 'drifter', skin: 'spore', tint: 0xb0ffe0,
    drops: [{ item: 'coin', min: 2, max: 5, chance: 1 }, ...EVENT_DROPS],
    spawn: null, event: { kind: 'sporefall', weight: 3 }, aggro: 60, color: 0x3ac8a0,
  },
  cinder_raider: {
    id: 'cinder_raider', name: 'Cinderbound Raider', hp: 90, damage: 20, defense: 10, speed: 2.8, ai: 'thrower', radius: 0.4, height: 1.8, kbResist: 0.3, model: 'ashdelver',
    drops: [{ item: 'coin', min: 4, max: 9, chance: 1 }, { item: 'iron_ore', min: 2, max: 4, chance: 0.5 }, { item: 'barbed_hook', min: 1, max: 1, chance: 0.05 }],
    spawn: null, event: { kind: 'raid', weight: 6 }, aggro: 120, fireproof: true, color: 0xff7a2a,
    ranged: { damage: 16, interval: 2.2, speed: 17, range: 16 },
  },
  firebrand: {
    id: 'firebrand', name: 'Firebrand', hp: 70, damage: 16, defense: 6, speed: 3, ai: 'thrower', radius: 0.4, height: 1.8, kbResist: 0.2,
    drops: [{ item: 'bomb', min: 1, max: 3, chance: 0.6 }, { item: 'coin', min: 4, max: 8, chance: 1 }],
    spawn: null, event: { kind: 'raid', weight: 3 }, aggro: 120, fireproof: true, color: 0xff7a2a,
    ranged: { damage: 26, interval: 3.4, speed: 13, range: 18, projectile: 'bomb' },
  },
  basalt_colossus: {
    id: 'basalt_colossus', name: 'Basalt Colossus', hp: 220, damage: 32, defense: 14, speed: 2.4, ai: 'walker', radius: 0.62, height: 2.7, kbResist: 0.85,
    drops: [{ item: 'coin', min: 10, max: 20, chance: 1 }, { item: 'iron_bar', min: 1, max: 3, chance: 0.6 }, { item: 'bonebreaker', min: 1, max: 1, chance: 0.1 }],
    spawn: null, event: { kind: 'raid', weight: 2 }, aggro: 120, fireproof: true, color: 0xff7a2a,
  },
} satisfies Record<string, CreatureDef>);

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
  /** In water this frame (set by the combat system before thinking). */
  swimming = false;
  wander = Math.random() * Math.PI * 2;
  /** Seconds since the creature last saw/was near the player (despawn). */
  idle = 0;
  /** Boss-specific state. */
  phase = 0;
  /** Seconds left of the attack animation (set when it lands a hit). */
  attack = 0;
  /** Spawned by a world event (counts toward its progress). */
  event: EventKind | null = null;
  /** Struck by the player: a docile creature fights back from now on. */
  provoked = false;
  /** Seconds spent burning in lava since the last burn tick. */
  burn = 0;
  /** Burrowers: body segment centres behind the head (x, y, z = head). */
  body: { x: number; y: number; z: number; r: number }[] | null = null;
  /** Burrowers: lunge target, whether the head has broken the surface this lunge, and 1 / -1 when it bursts out / dives in this frame. */
  aim = { x: 0, y: 0, z: 0 };
  surfaced = false;
  breach = 0;
  readonly uid: number;
  private static next = 1;
  private n: [number, number, number] = [0, 0, 0];

  constructor(readonly def: CreatureDef, x: number, y: number, z: number) {
    this.uid = Creature.next++;
    this.x = x; this.y = y; this.z = z;
    this.hp = def.hp;
    if (def.ai === 'burrower') {
      this.aim = { x, y, z };
      this.body = [];
      for (let i = 1; i < WORM_SEGMENTS; i++) this.body.push({ x, y: y - i * WORM_SPACING, z, r: def.radius * (1 - 0.5 * i / WORM_SEGMENTS) });
    }
  }

  /**
   * The spheres that can be struck: the body centre, or for a burrower its
   * head and every segment. `r` is the reach radius, `rr` the ray radius.
   */
  parts(): { x: number; y: number; z: number; r: number; rr: number }[] {
    if (!this.body) return [{ x: this.cx, y: this.cy, z: this.cz, r: this.def.radius, rr: Math.max(this.def.radius, this.def.height / 2) }];
    return [{ x: this.x, y: this.y, z: this.z, r: this.def.radius, rr: this.def.radius }, ...this.body.map(b => ({ x: b.x, y: b.y, z: b.z, r: b.r, rr: b.r }))];
  }

  get cx() { return this.x; }
  get cy() { return this.body ? this.y : this.y + this.def.height / 2; }
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
        const push = Math.min(r - d, 1);
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

/** Dune worm body: segments and their spacing. */
export const WORM_SEGMENTS = 12;
export const WORM_SPACING = 1.15;

export interface AIContext {
  px: number; py: number; pz: number;
  dt: number;
  world: WorldCollision;
  /** Signed distance to terrain at a point (flyers avoid walls). */
  distance(x: number, y: number, z: number, n: [number, number, number]): number;
  throwAt(c: Creature, tx: number, ty: number, tz: number): void;
  /** Daytime with no event running: docile creatures leave the player alone. */
  calm: boolean;
  /** Height of the ground surface (burrowers swim below it). */
  surfaceTop(x: number, z: number): number;
}

/** True while a creature is ignoring the player (docile, unprovoked, calm). */
export function peaceful(c: Creature, calm: boolean) {
  return !!c.def.docile && !c.provoked && calm;
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
  const d = c.def;
  const aggro = !peaceful(c, ctx.calm) && dist < (d.aggro ?? 38);
  c.attack = Math.max(0, c.attack - dt);

  switch (d.ai) {
    case 'hopper': {
      if (c.grounded || c.swimming) {
        if (c.grounded) { c.vx *= Math.pow(0.001, dt); c.vz *= Math.pow(0.001, dt); }
        if (c.cooldown <= 0) {
          const dir = aggro ? Math.atan2(dx, dz) : (c.wander += (Math.random() - 0.5) * 1.5);
          const big = aggro && Math.random() < 0.35;
          const sp = aggro ? d.speed : d.speed * 0.4;
          c.vx = Math.sin(dir) * sp; c.vz = Math.cos(dir) * sp;
          c.vy = big ? 9.5 : 6.5;
          c.yaw = dir;
          // Paddling hops come quicker, so they make it back to shore.
          c.cooldown = c.swimming ? 0.6 : aggro ? 0.9 + Math.random() * 0.8 : 1.8 + Math.random() * 2;
        }
      }
      c.physics(dt, ctx.world);
      break;
    }
    case 'walker':
    case 'crawler':
    case 'thrower':
    case 'pouncer': {
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
      // Pouncers close in, then leap at the player.
      if (d.ai === 'pouncer' && aggro && c.grounded && c.cooldown <= 0 && dist < 9 && dist > 2 && Math.abs(dy) < 4) {
        const l0 = dist || 1;
        c.vx = (dx / l0) * 12; c.vz = (dz / l0) * 12; c.vy = 6.5 + Math.max(0, dy) * 1.2;
        c.cooldown = 2.2 + Math.random();
        c.attack = 0.5;
      }
      const l = Math.hypot(tx, tz) || 1;
      const targetVx = (tx / l) * want, targetVz = (tz / l) * want;
      if (c.grounded && !(d.ai === 'pouncer' && c.attack > 0.2)) {
        c.vx += (targetVx - c.vx) * Math.min(1, dt * 8);
        c.vz += (targetVz - c.vz) * Math.min(1, dt * 8);
      } else if (c.swimming) {
        // Swim toward the goal, a little slower than walking.
        c.vx += (targetVx * 0.7 - c.vx) * Math.min(1, dt * 3);
        c.vz += (targetVz * 0.7 - c.vz) * Math.min(1, dt * 3);
      }
      c.yaw = Math.atan2(tx, tz);
      const ox = c.x, oz = c.z;
      c.physics(dt, ctx.world);
      // Blocked while trying to move: hop over it.
      const moved = Math.hypot(c.x - ox, c.z - oz);
      c.stuck = moved < Math.abs(want) * dt * 0.3 && Math.abs(want) > 0.1 ? c.stuck + dt : 0;
      // (Swimmers pressed against a bank scramble up it the same way.)
      if ((c.grounded || c.swimming) && c.stuck > 0.25) { c.vy = d.ai === 'crawler' ? 6 : 7.5; c.stuck = 0; }
      break;
    }
    case 'burrower': {
      // Swims through the ground below the player, then bursts up through the
      // surface at them in a long arc and dives back in.
      const surf = ctx.surfaceTop(c.x, c.z);
      const inside = c.y < surf - 0.4;
      c.breach = 0;
      let tx: number, ty: number, tz: number, sp = d.speed, turn = 2.4;
      if (c.phase === 0) {
        const a = c.t * 0.7 + c.uid;
        const r = aggro ? 10 : 16;
        const cxp = aggro ? ctx.px : c.aim.x, czp = aggro ? ctx.pz : c.aim.z;
        tx = cxp + Math.cos(a) * r; tz = czp + Math.sin(a) * r;
        ty = Math.min(ctx.surfaceTop(tx, tz), aggro ? ctx.py : 1e9) - 5;
        if (!aggro) sp *= 0.5;
        if (aggro && inside && c.cooldown <= 0 && dist < 22 && Math.abs(dy) < 12) {
          c.phase = 1; c.surfaced = false; c.t = 0;
          // Aim high above the player so it bursts out steeply and arcs over.
          c.aim = { x: ctx.px, y: ctx.py + 12, z: ctx.pz };
        }
      } else {
        tx = c.aim.x; ty = c.aim.y; tz = c.aim.z;
        sp *= 1.5; turn = 3.5;
        if (c.surfaced && inside) { c.phase = 0; c.cooldown = 2.5 + Math.random() * 1.5; }
        if (c.t > 6) { c.phase = 0; c.cooldown = 2; }
      }
      if (inside) {
        const ex = tx - c.x, ey = ty - c.y, ez = tz - c.z, l = Math.hypot(ex, ey, ez) || 1;
        const k = Math.min(1, dt * turn);
        c.vx += (ex / l * sp - c.vx) * k; c.vy += (ey / l * sp - c.vy) * k; c.vz += (ez / l * sp - c.vz) * k;
      } else {
        // Airborne: a ballistic arc, steering only a little.
        c.vy -= 16 * dt;
        c.vx *= Math.pow(0.9, dt); c.vz *= Math.pow(0.9, dt);
      }
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      if (c.y < 6) { c.y = 6; c.vy = Math.abs(c.vy); }
      const nowInside = c.y < ctx.surfaceTop(c.x, c.z) - 0.4;
      if (inside && !nowInside) { c.breach = 1; if (c.phase === 1) c.surfaced = true; }
      if (!inside && nowInside) c.breach = -1;
      c.yaw = Math.atan2(c.vx, c.vz);
      // The body follows as a chain.
      let px = c.x, py = c.y, pz = c.z;
      for (const b of c.body!) {
        const ex = b.x - px, ey = b.y - py, ez = b.z - pz, l = Math.hypot(ex, ey, ez);
        if (l > WORM_SPACING) { const k = WORM_SPACING / l; b.x = px + ex * k; b.y = py + ey * k; b.z = pz + ez * k; }
        px = b.x; py = b.y; pz = b.z;
      }
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
  c.idle = dist > Math.max(70, (d.aggro ?? 0) + 10) ? c.idle + dt : 0;
}
