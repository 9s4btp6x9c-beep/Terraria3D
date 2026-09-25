// Item database. Items are pure data; behaviour is selected by `kind` and the
// optional blocks (tool, weapon, place, armor, accessory...), so new content
// is added here, not in code. Visuals come from the `model` recipe.

import { Mat } from '../world/materials';

export type PieceShape = 'floor' | 'wall' | 'pillar' | 'stairs' | 'roof';
export type StationId = 'workbench' | 'furnace' | 'anvil' | 'forge';
export type FurnitureId = 'workbench' | 'furnace' | 'anvil' | 'forge' | 'chair' | 'table' | 'door' | 'torch' | 'chest' | 'bed' | 'life_crystal';
export type MetalLayer = 'copper' | 'iron' | 'lumiteMetal' | 'gold' | 'planks' | 'metal' | 'emberMetal' | 'bone' | 'bloodMetal' | 'aeriteMetal';

export interface ToolDef {
  type: 'pickaxe' | 'axe';
  /** Material tier it can break. */
  tier: number;
  /** Work per swing (seconds of material hardness removed per m^3). */
  power: number;
  /** Swing interval (s). */
  speed: number;
  /** Brush radius for terrain. */
  radius: number;
  reach: number;
  /** Melee damage when swung at creatures. */
  damage: number;
}

export interface WeaponDef {
  type: 'melee' | 'bow' | 'thrown' | 'magic';
  damage: number;
  /** Seconds between uses. */
  speed: number;
  knockback: number;
  /** Melee reach / projectile speed. */
  reach?: number;
  projectileSpeed?: number;
  ammo?: string;
  manaCost?: number;
  /** Thrown explosives: blast radius carved into terrain. */
  blast?: number;
  /** Fraction of melee damage dealt returned as health. */
  lifesteal?: number;
  /** Projectiles per shot (fanned out). */
  multishot?: number;
}

export interface ArmorDef { slot: 'head' | 'body' | 'legs'; defense: number; set?: string }

export interface AccessoryDef {
  moveSpeed?: number;
  jumps?: number;
  noFallDamage?: boolean;
  miningSpeed?: number;
  lightRadius?: number;
  hook?: { range: number; speed: number };
  regen?: number;
  /** Wings: seconds of powered flight per take-off, then gliding. */
  flight?: number;
}

/** Procedural model recipe (see render/models.ts). */
export type ModelSpec =
  | { type: 'pickaxe' | 'axe' | 'sword' | 'bow' | 'staff' | 'hook'; head: MetalLayer }
  | { type: 'ore' | 'bar' | 'crystal' | 'nugget'; layer: string; tint?: number }
  | { type: 'block'; layer: string }
  | { type: 'log' | 'gel' | 'arrow' | 'bomb' | 'potion' | 'bottle' | 'mushroom' | 'coin' | 'wing' | 'scale' | 'bait' | 'horn' | 'club' | 'fang' | 'feather' | 'plume' | 'wings' | 'idol' | 'star' | 'mana_crystal' | 'mana_potion' }
  | { type: 'armor'; slot: ArmorDef['slot']; layer: MetalLayer }
  | { type: 'boots' | 'jar' | 'charm' | 'band'; layer: string }
  | { type: 'furniture'; id: FurnitureId };

export interface ItemDef {
  id: string;
  name: string;
  kind: 'tool' | 'weapon' | 'material' | 'placeable' | 'armor' | 'accessory' | 'consumable' | 'ammo';
  maxStack: number;
  /** Fallback UI colour. */
  color: string;
  model: ModelSpec;
  tool?: ToolDef;
  weapon?: WeaponDef;
  armor?: ArmorDef;
  accessory?: AccessoryDef;
  /** Terrain material deposited when placed as a terrain blob. */
  terrain?: Mat;
  /** Building piece texture when used for building. */
  build?: 'planks' | 'bricks';
  furniture?: FurnitureId;
  heal?: number;
  /** Mana restored when used. */
  mana?: number;
  /** Permanent max life / mana increase (crystals). */
  grow?: { life?: number; mana?: number };
  rarity?: 0 | 1 | 2 | 3;
  description?: string;
}

// Mining power tiers: 0 copper/iron, 1 iron pickaxe (deepstone, lumite),
// 2 lumite pickaxe (Ember Depths).
const T = (id: string, name: string, head: MetalLayer, type: 'pickaxe' | 'axe', tier: number, power: number, speed: number, damage: number, color: string, description: string): ItemDef => ({
  id, name, kind: 'tool', maxStack: 1, color, model: { type, head },
  tool: { type, tier, power, speed, radius: type === 'pickaxe' ? 1.25 + tier * 0.12 : 0, reach: 5 + tier * 0.4, damage },
  description,
});

const list: ItemDef[] = [
  // ---- tools
  T('copper_pickaxe', 'Copper Pickaxe', 'copper', 'pickaxe', 0, 1.0, 0.32, 4, '#c0703a', 'Digs dirt, stone, clay, copper and iron.'),
  T('copper_axe', 'Copper Axe', 'copper', 'axe', 0, 1.0, 0.4, 5, '#c0703a', 'Fells trees for wood.'),
  T('iron_pickaxe', 'Iron Pickaxe', 'iron', 'pickaxe', 1, 1.5, 0.27, 6, '#d6d0ca', 'Strong enough for deepstone and lumite crystals.'),
  T('iron_axe', 'Iron Axe', 'iron', 'axe', 1, 1.6, 0.34, 8, '#d6d0ca', 'Chops faster.'),
  T('lumite_pickaxe', 'Lumite Pickaxe', 'lumiteMetal', 'pickaxe', 2, 2.2, 0.22, 10, '#6ae6ff', 'Hums with light. Digs anything.'),

  // ---- weapons
  { id: 'wooden_sword', name: 'Wooden Sword', kind: 'weapon', maxStack: 1, color: '#a8744a', model: { type: 'sword', head: 'planks' }, weapon: { type: 'melee', damage: 8, speed: 0.45, knockback: 5, reach: 2.6 } },
  { id: 'copper_sword', name: 'Copper Broadsword', kind: 'weapon', maxStack: 1, color: '#c0703a', model: { type: 'sword', head: 'copper' }, weapon: { type: 'melee', damage: 13, speed: 0.42, knockback: 6, reach: 2.9 } },
  { id: 'iron_sword', name: 'Iron Broadsword', kind: 'weapon', maxStack: 1, color: '#d6d0ca', model: { type: 'sword', head: 'iron' }, weapon: { type: 'melee', damage: 19, speed: 0.4, knockback: 7, reach: 3.1 } },
  { id: 'lumite_blade', name: 'Lumite Blade', kind: 'weapon', maxStack: 1, color: '#6ae6ff', rarity: 2, model: { type: 'sword', head: 'lumiteMetal' }, weapon: { type: 'melee', damage: 30, speed: 0.34, knockback: 7, reach: 3.4 }, description: 'Leaves a trail of light.' },
  { id: 'wooden_bow', name: 'Wooden Bow', kind: 'weapon', maxStack: 1, color: '#a8744a', model: { type: 'bow', head: 'planks' }, weapon: { type: 'bow', damage: 9, speed: 0.6, knockback: 2, projectileSpeed: 38, ammo: 'wooden_arrow' } },
  { id: 'iron_bow', name: 'Iron Bow', kind: 'weapon', maxStack: 1, color: '#d6d0ca', model: { type: 'bow', head: 'iron' }, weapon: { type: 'bow', damage: 14, speed: 0.5, knockback: 2.5, projectileSpeed: 48, ammo: 'wooden_arrow' } },
  { id: 'ember_blade', name: 'Ember Blade', kind: 'weapon', maxStack: 1, color: '#ff8a30', rarity: 3, model: { type: 'sword', head: 'emberMetal' }, weapon: { type: 'melee', damage: 44, speed: 0.36, knockback: 8, reach: 3.6 }, description: 'Sets the air ablaze with every swing.' },
  { id: 'wyrmfang_staff', name: 'Wyrmfang Staff', kind: 'weapon', maxStack: 1, color: '#c8d890', rarity: 3, model: { type: 'staff', head: 'bone' }, weapon: { type: 'magic', damage: 26, speed: 0.4, knockback: 4, projectileSpeed: 26, manaCost: 8 }, description: 'Fires a boring fang that tunnels through rock.' },
  { id: 'lumite_staff', name: 'Lumite Staff', kind: 'weapon', maxStack: 1, color: '#6ae6ff', rarity: 2, model: { type: 'staff', head: 'lumiteMetal' }, weapon: { type: 'magic', damage: 22, speed: 0.35, knockback: 3, projectileSpeed: 34, manaCost: 6 }, description: 'Fires seeking bolts of light.' },
  { id: 'sanguine_blade', name: 'Sanguine Blade', kind: 'weapon', maxStack: 1, color: '#e8444c', rarity: 2, model: { type: 'sword', head: 'bloodMetal' }, weapon: { type: 'melee', damage: 24, speed: 0.38, knockback: 6, reach: 3.2, lifesteal: 0.1 }, description: 'Forged under a Blood Moon. Heals you for part of the damage it deals.' },
  { id: 'bonebreaker', name: 'Bonebreaker', kind: 'weapon', maxStack: 1, color: '#e6dcc0', rarity: 2, model: { type: 'club' }, weapon: { type: 'melee', damage: 36, speed: 0.62, knockback: 15, reach: 3.0 }, description: 'A Hollow Brute\'s club. Slow, but sends foes flying.' },
  { id: 'gale_bow', name: 'Gale Bow', kind: 'weapon', maxStack: 1, color: '#a8e4ff', rarity: 2, model: { type: 'bow', head: 'aeriteMetal' }, weapon: { type: 'bow', damage: 15, speed: 0.42, knockback: 3, projectileSpeed: 58, ammo: 'wooden_arrow', multishot: 2 }, description: 'Looses two arrows at once.' },
  { id: 'tempest_staff', name: 'Tempest Staff', kind: 'weapon', maxStack: 1, color: '#d8f0ff', rarity: 3, model: { type: 'staff', head: 'aeriteMetal' }, weapon: { type: 'magic', damage: 34, speed: 0.5, knockback: 16, projectileSpeed: 30, manaCost: 10 }, description: 'Hurls a piercing gale that scatters everything it passes through.' },
  { id: 'wooden_arrow', name: 'Wooden Arrow', kind: 'ammo', maxStack: 999, color: '#c0a070', model: { type: 'arrow' } },
  { id: 'bomb', name: 'Bomb', kind: 'weapon', maxStack: 99, color: '#3a3842', model: { type: 'bomb' }, weapon: { type: 'thrown', damage: 60, speed: 0.6, knockback: 12, projectileSpeed: 16, blast: 3.2 }, description: 'Blasts a crater out of the terrain.' },

  // ---- armor
  { id: 'copper_helmet', name: 'Copper Helmet', kind: 'armor', maxStack: 1, color: '#c0703a', model: { type: 'armor', slot: 'head', layer: 'copper' }, armor: { slot: 'head', defense: 2, set: 'copper' } },
  { id: 'copper_chainmail', name: 'Copper Chainmail', kind: 'armor', maxStack: 1, color: '#c0703a', model: { type: 'armor', slot: 'body', layer: 'copper' }, armor: { slot: 'body', defense: 3, set: 'copper' } },
  { id: 'copper_greaves', name: 'Copper Greaves', kind: 'armor', maxStack: 1, color: '#c0703a', model: { type: 'armor', slot: 'legs', layer: 'copper' }, armor: { slot: 'legs', defense: 2, set: 'copper' } },
  { id: 'iron_helmet', name: 'Iron Helmet', kind: 'armor', maxStack: 1, color: '#d6d0ca', model: { type: 'armor', slot: 'head', layer: 'iron' }, armor: { slot: 'head', defense: 3, set: 'iron' } },
  { id: 'iron_chainmail', name: 'Iron Chainmail', kind: 'armor', maxStack: 1, color: '#d6d0ca', model: { type: 'armor', slot: 'body', layer: 'iron' }, armor: { slot: 'body', defense: 5, set: 'iron' } },
  { id: 'ember_helmet', name: 'Ember Helmet', kind: 'armor', maxStack: 1, color: '#ff8a30', rarity: 2, model: { type: 'armor', slot: 'head', layer: 'emberMetal' }, armor: { slot: 'head', defense: 6, set: 'ember' } },
  { id: 'ember_plate', name: 'Ember Plate', kind: 'armor', maxStack: 1, color: '#ff8a30', rarity: 2, model: { type: 'armor', slot: 'body', layer: 'emberMetal' }, armor: { slot: 'body', defense: 8, set: 'ember' } },
  { id: 'ember_greaves', name: 'Ember Greaves', kind: 'armor', maxStack: 1, color: '#ff8a30', rarity: 2, model: { type: 'armor', slot: 'legs', layer: 'emberMetal' }, armor: { slot: 'legs', defense: 6, set: 'ember' } },
  { id: 'aerite_helmet', name: 'Skyforged Helm', kind: 'armor', maxStack: 1, color: '#a8e4ff', rarity: 2, model: { type: 'armor', slot: 'head', layer: 'aeriteMetal' }, armor: { slot: 'head', defense: 4, set: 'aerite' } },
  { id: 'aerite_breastplate', name: 'Skyforged Breastplate', kind: 'armor', maxStack: 1, color: '#a8e4ff', rarity: 2, model: { type: 'armor', slot: 'body', layer: 'aeriteMetal' }, armor: { slot: 'body', defense: 6, set: 'aerite' } },
  { id: 'aerite_greaves', name: 'Skyforged Greaves', kind: 'armor', maxStack: 1, color: '#a8e4ff', rarity: 2, model: { type: 'armor', slot: 'legs', layer: 'aeriteMetal' }, armor: { slot: 'legs', defense: 4, set: 'aerite' } },
  { id: 'iron_greaves', name: 'Iron Greaves', kind: 'armor', maxStack: 1, color: '#d6d0ca', model: { type: 'armor', slot: 'legs', layer: 'iron' }, armor: { slot: 'legs', defense: 3, set: 'iron' } },

  // ---- accessories
  { id: 'swift_boots', name: 'Swiftstep Boots', kind: 'accessory', maxStack: 1, color: '#d0584a', rarity: 1, model: { type: 'boots', layer: 'cloth' }, accessory: { moveSpeed: 0.3 }, description: '+30% movement speed.' },
  { id: 'updraft_jar', name: 'Updraft Jar', kind: 'accessory', maxStack: 1, color: '#9ad8f0', rarity: 1, model: { type: 'jar', layer: 'glass' }, accessory: { jumps: 1 }, description: 'A captured gust. Grants a double jump.' },
  { id: 'feather_charm', name: 'Feather Charm', kind: 'accessory', maxStack: 1, color: '#fff6de', rarity: 1, model: { type: 'charm', layer: 'bone' }, accessory: { noFallDamage: true }, description: 'Negates fall damage.' },
  { id: 'miners_band', name: "Delver's Band", kind: 'accessory', maxStack: 1, color: '#e0b030', rarity: 1, model: { type: 'band', layer: 'gold' }, accessory: { miningSpeed: 0.35 }, description: '+35% mining speed.' },
  { id: 'glow_charm', name: 'Glowmoth Charm', kind: 'accessory', maxStack: 1, color: '#7af0ff', rarity: 1, model: { type: 'charm', layer: 'lumiteMetal' }, accessory: { lightRadius: 1 }, description: 'Your lantern shines much further.' },
  { id: 'burrowing_claws', name: 'Burrowing Claws', kind: 'accessory', maxStack: 1, color: '#c8d890', rarity: 3, model: { type: 'charm', layer: 'bone' }, accessory: { miningSpeed: 0.6 }, description: 'From the Deepwyrm. +60% mining speed.' },
  { id: 'heartstone', name: 'Heartstone Amulet', kind: 'accessory', maxStack: 1, color: '#e8444c', rarity: 2, model: { type: 'charm', layer: 'bloodMetal' }, accessory: { regen: 1.5 }, description: 'Beats softly. Faster health regeneration.' },
  { id: 'houndfang_charm', name: 'Houndfang Charm', kind: 'accessory', maxStack: 1, color: '#f0e0c8', rarity: 2, model: { type: 'fang' }, accessory: { moveSpeed: 0.15, jumps: 1 }, description: 'Taken from a Gorehound. +15% speed and a double jump.' },
  { id: 'roc_wings', name: 'Roc Wings', kind: 'accessory', maxStack: 1, color: '#d8e4f4', rarity: 3, model: { type: 'wings' }, accessory: { flight: 2.4, noFallDamage: true }, description: 'Hold jump in the air to fly, then glide. From the Tempest Roc.' },
  { id: 'grappling_hook', name: 'Grappling Hook', kind: 'accessory', maxStack: 1, color: '#9a98a6', rarity: 1, model: { type: 'hook', head: 'iron' }, accessory: { hook: { range: 26, speed: 22 } }, description: 'Press F to fire. Latches onto any surface.' },
  { id: 'barbed_hook', name: 'Barbed Hook', kind: 'material', maxStack: 99, color: '#9a98a6', model: { type: 'hook', head: 'metal' }, description: 'Dropped by Hollow Miners. Craft into a grappling hook.' },

  // ---- materials
  { id: 'dirt', name: 'Dirt', kind: 'material', maxStack: 999, color: '#8a5a3c', model: { type: 'block', layer: 'dirt' }, terrain: Mat.Dirt },
  { id: 'stone', name: 'Stone', kind: 'material', maxStack: 999, color: '#a4a2ac', model: { type: 'block', layer: 'stone' }, terrain: Mat.Stone, build: 'bricks' },
  { id: 'sand', name: 'Sand', kind: 'material', maxStack: 999, color: '#dcc88c', model: { type: 'block', layer: 'sand' }, terrain: Mat.Sand },
  { id: 'clay', name: 'Clay', kind: 'material', maxStack: 999, color: '#a0604a', model: { type: 'block', layer: 'clay' }, terrain: Mat.Clay },
  { id: 'snow', name: 'Snow', kind: 'material', maxStack: 999, color: '#eaf2f8', model: { type: 'block', layer: 'snow' }, terrain: Mat.Snow },
  { id: 'sandstone', name: 'Sandstone', kind: 'material', maxStack: 999, color: '#d4b070', model: { type: 'block', layer: 'sandstone' }, terrain: Mat.Sandstone },
  { id: 'ice', name: 'Ice', kind: 'material', maxStack: 999, color: '#a8d8f0', model: { type: 'block', layer: 'ice' }, terrain: Mat.Ice },
  { id: 'blightstone', name: 'Blightstone', kind: 'material', maxStack: 999, color: '#5a4a6e', model: { type: 'block', layer: 'blightstone' }, terrain: Mat.Blightstone },
  { id: 'emberstone', name: 'Emberstone', kind: 'material', maxStack: 999, color: '#9a3a22', model: { type: 'block', layer: 'emberstone' }, terrain: Mat.Emberstone, description: 'Warm to the touch.' },
  { id: 'emberite', name: 'Emberite Ore', kind: 'material', maxStack: 999, color: '#ff8a30', rarity: 2, model: { type: 'ore', layer: 'emberite' }, description: 'Found only in the Ember Depths.' },
  { id: 'ember_bar', name: 'Ember Bar', kind: 'material', maxStack: 999, color: '#ff8a30', rarity: 2, model: { type: 'bar', layer: 'emberMetal' } },
  { id: 'wyrm_scale', name: 'Wyrm Scale', kind: 'material', maxStack: 999, color: '#8a9a6a', rarity: 2, model: { type: 'scale' }, description: 'Shed by the Deepwyrm. Hard as stone.' },
  { id: 'aerite_ore', name: 'Aerite Ore', kind: 'material', maxStack: 999, color: '#a8e4ff', rarity: 1, model: { type: 'ore', layer: 'aerite' }, description: 'Found only inside the floating islands.' },
  { id: 'aerite_bar', name: 'Aerite Bar', kind: 'material', maxStack: 999, color: '#a8e4ff', rarity: 1, model: { type: 'bar', layer: 'aeriteMetal' } },
  { id: 'sky_feather', name: 'Sky Feather', kind: 'material', maxStack: 999, color: '#e8f0fa', model: { type: 'feather' }, description: 'Drifts down from the creatures of the high sky.' },
  { id: 'roc_plume', name: 'Roc Plume', kind: 'material', maxStack: 999, color: '#f0e0a0', rarity: 2, model: { type: 'plume' }, description: 'A storm-charged feather from the Tempest Roc.' },
  { id: 'gale_idol', name: 'Gale Idol', kind: 'consumable', maxStack: 20, color: '#a8e4ff', rarity: 2, model: { type: 'idol' }, description: 'Calls the Tempest Roc. Use high in the sky.' },
  { id: 'blood_shard', name: 'Sanguine Shard', kind: 'material', maxStack: 999, color: '#e8444c', rarity: 1, model: { type: 'crystal', layer: 'bloodMetal' }, description: 'Falls from creatures of the Blood Moon.' },
  { id: 'hollow_horn', name: 'Hollow War Horn', kind: 'consumable', maxStack: 20, color: '#e6dcc0', rarity: 2, model: { type: 'horn' }, description: 'Sounds a challenge to the Hollowfolk. Use near your town.' },
  { id: 'wyrm_bait', name: 'Wyrm Bait', kind: 'consumable', maxStack: 20, color: '#b04a6a', rarity: 1, model: { type: 'bait' }, description: 'Summons the Deepwyrm. Use at night or underground.' },
  { id: 'wood', name: 'Wood', kind: 'material', maxStack: 999, color: '#a8744a', model: { type: 'log' }, build: 'planks' },
  { id: 'copper_ore', name: 'Copper Ore', kind: 'material', maxStack: 999, color: '#e0874a', model: { type: 'ore', layer: 'copper' } },
  { id: 'iron_ore', name: 'Iron Ore', kind: 'material', maxStack: 999, color: '#c8b4a6', model: { type: 'ore', layer: 'iron' } },
  { id: 'lumite', name: 'Lumite Shard', kind: 'material', maxStack: 999, color: '#46e0ff', model: { type: 'crystal', layer: 'lumiteMetal' } },
  { id: 'copper_bar', name: 'Copper Bar', kind: 'material', maxStack: 999, color: '#c0703a', model: { type: 'bar', layer: 'copper' } },
  { id: 'iron_bar', name: 'Iron Bar', kind: 'material', maxStack: 999, color: '#d6d0ca', model: { type: 'bar', layer: 'iron' } },
  { id: 'lumite_bar', name: 'Lumite Bar', kind: 'material', maxStack: 999, color: '#6ae6ff', model: { type: 'bar', layer: 'lumiteMetal' } },
  { id: 'gel', name: 'Gel', kind: 'material', maxStack: 999, color: '#4ec87a', model: { type: 'gel' }, description: 'Sticky and flammable.' },
  { id: 'red_cap', name: 'Red Cap', kind: 'material', maxStack: 99, color: '#d83a3a', model: { type: 'mushroom' }, description: 'A forest mushroom. Used in potions.' },
  { id: 'glass_bottle', name: 'Glass Bottle', kind: 'material', maxStack: 99, color: '#9ad8f0', model: { type: 'bottle' } },
  { id: 'bat_wing', name: 'Bat Wing', kind: 'material', maxStack: 99, color: '#5a4a5e', model: { type: 'wing' }, description: 'Leathery. Dropped by cave bats.' },
  { id: 'coin', name: 'Coin', kind: 'material', maxStack: 9999, color: '#e0b030', model: { type: 'coin' }, description: 'Merchants love these.' },

  // ---- consumables
  { id: 'life_crystal', name: 'Life Crystal', kind: 'consumable', maxStack: 99, color: '#ff4a5a', rarity: 2, model: { type: 'furniture', id: 'life_crystal' }, grow: { life: 20 }, description: 'Permanently raises max life by 20 (up to 400).' },
  { id: 'fallen_star', name: 'Fallen Star', kind: 'material', maxStack: 999, color: '#ffe060', rarity: 1, model: { type: 'star' }, description: 'Falls from the sky on clear nights.' },
  { id: 'mana_crystal', name: 'Mana Crystal', kind: 'consumable', maxStack: 99, color: '#5a8aff', rarity: 2, model: { type: 'mana_crystal' }, grow: { mana: 20 }, description: 'Permanently raises max mana by 20 (up to 200).' },
  { id: 'mana_potion', name: 'Mana Potion', kind: 'consumable', maxStack: 30, color: '#4a7aff', model: { type: 'mana_potion' }, mana: 100, description: 'Restores 100 mana.' },
  { id: 'healing_potion', name: 'Healing Potion', kind: 'consumable', maxStack: 30, color: '#d83a3a', model: { type: 'potion' }, heal: 50, description: 'Restores 50 health. [RMB] / use to drink.' },

  // ---- placeables
  { id: 'workbench', name: 'Workbench', kind: 'placeable', maxStack: 99, color: '#a8744a', model: { type: 'furniture', id: 'workbench' }, furniture: 'workbench', description: 'The first crafting station.' },
  { id: 'furnace', name: 'Furnace', kind: 'placeable', maxStack: 99, color: '#9a98a4', model: { type: 'furniture', id: 'furnace' }, furniture: 'furnace', description: 'Smelts ore into bars.' },
  { id: 'anvil', name: 'Iron Anvil', kind: 'placeable', maxStack: 99, color: '#6e6c78', model: { type: 'furniture', id: 'anvil' }, furniture: 'anvil', description: 'Forge metal tools, weapons and armor.' },
  { id: 'forge', name: 'Lumite Forge', kind: 'placeable', maxStack: 99, color: '#6ae6ff', rarity: 2, model: { type: 'furniture', id: 'forge' }, furniture: 'forge', description: 'Advanced station for lumite gear.' },
  { id: 'chair', name: 'Wooden Chair', kind: 'placeable', maxStack: 99, color: '#a8744a', model: { type: 'furniture', id: 'chair' }, furniture: 'chair' },
  { id: 'table', name: 'Wooden Table', kind: 'placeable', maxStack: 99, color: '#a8744a', model: { type: 'furniture', id: 'table' }, furniture: 'table' },
  { id: 'door', name: 'Wooden Door', kind: 'placeable', maxStack: 99, color: '#a8744a', model: { type: 'furniture', id: 'door' }, furniture: 'door', description: 'Snaps into wall slots. [RMB] to open.' },
  { id: 'torch', name: 'Torch', kind: 'placeable', maxStack: 99, color: '#ffb030', model: { type: 'furniture', id: 'torch' }, furniture: 'torch', description: 'Place on floors or walls.' },
  { id: 'chest', name: 'Chest', kind: 'placeable', maxStack: 99, color: '#a8744a', model: { type: 'furniture', id: 'chest' }, furniture: 'chest', description: 'Stores 20 stacks. [RMB] to open.' },
  { id: 'bed', name: 'Bed', kind: 'placeable', maxStack: 99, color: '#b03a36', model: { type: 'furniture', id: 'bed' }, furniture: 'bed', description: '[RMB] to set your spawn point.' },
];

export const ITEMS: ReadonlyMap<string, ItemDef> = new Map(list.map(i => [i.id, i]));

export function item(id: string): ItemDef {
  const def = ITEMS.get(id);
  if (!def) throw new Error(`Unknown item ${id}`);
  return def;
}

export const RARITY_COLORS = ['#f4ecd8', '#8ad0ff', '#c89aff', '#ffb040'];
