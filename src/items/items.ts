// Item database. Items are pure data; behaviour is selected by `kind` and the
// optional blocks (tool, weapon, place, armor, accessory...), so new content
// is added here, not in code. Visuals come from the `model` recipe.

import { Mat } from '../world/materials';

export type StationId = 'workbench' | 'furnace' | 'anvil' | 'forge' | 'hearth';
export type FurnitureId = 'workbench' | 'furnace' | 'anvil' | 'forge' | 'chair' | 'table' | 'door' | 'torch' | 'chest' | 'bed' | 'life_crystal' | 'glowcap_lamp' | 'hearth' | 'salt_lamp' | 'amber_lantern';
export type MetalLayer = 'copper' | 'iron' | 'lumiteMetal' | 'gold' | 'planks' | 'metal' | 'emberMetal' | 'bone' | 'bloodMetal' | 'aeriteMetal' | 'sporeMetal' | 'rootbark';

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
  | { type: 'log' | 'gel' | 'arrow' | 'bomb' | 'potion' | 'bottle' | 'mushroom' | 'coin' | 'wing' | 'scale' | 'bait' | 'horn' | 'club' | 'fang' | 'feather' | 'plume' | 'wings' | 'idol' | 'starseed' | 'glim_vessel' | 'glim_draught' | 'mending_draught' | 'glowcap' | 'bucket' | 'water_bucket' | 'amber' | 'sap' | 'totem' | 'maul' | 'heartroot' | 'hammer' }
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
  /** The Builder's Hammer: places building pieces chosen in the build menu. */
  hammer?: boolean;
  furniture?: FurnitureId;
  heal?: number;
  /** Glim restored when used. */
  mana?: number;
  /** Permanent max vigor / glim increase (Heartroot, Glim Vessel). */
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
  T('titanbone_pickaxe', 'Titanbone Pickaxe', 'bone', 'pickaxe', 1, 1.9, 0.25, 8, '#e0d4b4', 'Carved from a giant\'s rib. Bites deep and fast.'),
  T('lumite_pickaxe', 'Lumite Pickaxe', 'lumiteMetal', 'pickaxe', 2, 2.2, 0.22, 10, '#6ae6ff', 'Hums with light. Digs anything.'),

  { id: 'builder_hammer', name: "Builder's Hammer", kind: 'tool', maxStack: 1, color: '#c8a070', model: { type: 'hammer' }, hammer: true, description: 'Builds bases from wood, stone and more. [Q] build menu, [R] rotate, hold [Shift] to place freely, [RMB] take a piece down.' },

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
  { id: 'sanguine_blade', name: 'Sporecleaver', kind: 'weapon', maxStack: 1, color: '#5ad8b0', rarity: 2, model: { type: 'sword', head: 'sporeMetal' }, weapon: { type: 'melee', damage: 24, speed: 0.38, knockback: 6, reach: 3.2, lifesteal: 0.1 }, description: 'Grown from Sporeglass. Draws vigor from every cut.' },
  { id: 'bramble_maul', name: 'Bramble Maul', kind: 'weapon', maxStack: 1, color: '#8a7058', rarity: 1, model: { type: 'maul' }, weapon: { type: 'melee', damage: 27, speed: 0.58, knockback: 13, reach: 3.1 }, description: 'A knot of petrified root. Heavy enough to stagger a Mossback.' },
  { id: 'heartwood_bow', name: 'Heartwood Longbow', kind: 'weapon', maxStack: 1, color: '#9a8068', rarity: 1, model: { type: 'bow', head: 'rootbark' }, weapon: { type: 'bow', damage: 16, speed: 0.55, knockback: 3, projectileSpeed: 54, ammo: 'wooden_arrow' }, description: 'Strung from Rootwold sinew. Arrows fly far and hit hard.' },
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
  { id: 'heartstone', name: 'Mycelheart Amulet', kind: 'accessory', maxStack: 1, color: '#5ad8b0', rarity: 2, model: { type: 'charm', layer: 'sporeMetal' }, accessory: { regen: 1.5 }, description: 'Pulses with a slow fungal warmth. Faster vigor regeneration.' },
  { id: 'houndfang_charm', name: 'Rotfang Charm', kind: 'accessory', maxStack: 1, color: '#f0e0c8', rarity: 2, model: { type: 'fang' }, accessory: { moveSpeed: 0.15, jumps: 1 }, description: 'Pulled from a Rotfang\'s jaw. +15% speed and a double jump.' },
  { id: 'roc_wings', name: 'Roc Wings', kind: 'accessory', maxStack: 1, color: '#d8e4f4', rarity: 3, model: { type: 'wings' }, accessory: { flight: 2.4, noFallDamage: true }, description: 'Hold jump in the air to fly, then glide. From the Tempest Roc.' },
  { id: 'grappling_hook', name: 'Grappling Hook', kind: 'accessory', maxStack: 1, color: '#9a98a6', rarity: 1, model: { type: 'hook', head: 'iron' }, accessory: { hook: { range: 26, speed: 22 } }, description: 'Press F to fire. Latches onto any surface.' },
  { id: 'barbed_hook', name: 'Barbed Hook', kind: 'material', maxStack: 99, color: '#9a98a6', model: { type: 'hook', head: 'metal' }, description: 'Dropped by Hollow Miners. Craft into a grappling hook.' },

  // ---- materials
  { id: 'dirt', name: 'Dirt', kind: 'material', maxStack: 999, color: '#8a5a3c', model: { type: 'block', layer: 'dirt' }, terrain: Mat.Dirt },
  { id: 'stone', name: 'Stone', kind: 'material', maxStack: 999, color: '#a4a2ac', model: { type: 'block', layer: 'stone' }, terrain: Mat.Stone },
  { id: 'sand', name: 'Sand', kind: 'material', maxStack: 999, color: '#dcc88c', model: { type: 'block', layer: 'sand' }, terrain: Mat.Sand },
  { id: 'clay', name: 'Clay', kind: 'material', maxStack: 999, color: '#a0604a', model: { type: 'block', layer: 'clay' }, terrain: Mat.Clay },
  { id: 'snow', name: 'Snow', kind: 'material', maxStack: 999, color: '#eaf2f8', model: { type: 'block', layer: 'snow' }, terrain: Mat.Snow },
  { id: 'sandstone', name: 'Sandstone', kind: 'material', maxStack: 999, color: '#d4b070', model: { type: 'block', layer: 'sandstone' }, terrain: Mat.Sandstone },
  { id: 'ice', name: 'Ice', kind: 'material', maxStack: 999, color: '#a8d8f0', model: { type: 'block', layer: 'ice' }, terrain: Mat.Ice },
  { id: 'rootwood', name: 'Petrified Root', kind: 'material', maxStack: 999, color: '#7a6250', model: { type: 'block', layer: 'rootwood' }, terrain: Mat.Rootwood, description: 'Wood turned to stone in the Rootwold. Tough and ring-grained.' },
  { id: 'salt', name: 'Salt', kind: 'material', maxStack: 999, color: '#e8e2d6', model: { type: 'block', layer: 'salt' }, terrain: Mat.Salt, description: 'Crust from the Ossuary Flats. Glows softly when heated.' },
  { id: 'fossil', name: 'Titan Bone', kind: 'material', maxStack: 999, color: '#e0d4b4', rarity: 1, model: { type: 'block', layer: 'fossil' }, terrain: Mat.Fossil, description: 'A shard of the giants that died on the salt flats.' },
  { id: 'mud', name: 'Mud', kind: 'material', maxStack: 999, color: '#4e4038', model: { type: 'block', layer: 'mud' }, terrain: Mat.Mud },
  { id: 'glowcap', name: 'Glowcap', kind: 'material', maxStack: 999, color: '#3aa0d0', rarity: 1, model: { type: 'glowcap' }, description: 'A luminous mushroom from the deep caverns.' },
  { id: 'blightstone', name: 'Riftstone', kind: 'material', maxStack: 999, color: '#46506a', model: { type: 'block', layer: 'blightstone' }, terrain: Mat.Riftstone },
  { id: 'emberstone', name: 'Emberstone', kind: 'material', maxStack: 999, color: '#9a3a22', model: { type: 'block', layer: 'emberstone' }, terrain: Mat.Emberstone, description: 'Warm to the touch.' },
  { id: 'emberite', name: 'Emberite Ore', kind: 'material', maxStack: 999, color: '#ff8a30', rarity: 2, model: { type: 'ore', layer: 'emberite' }, description: 'Found only in the Ember Depths.' },
  { id: 'ember_bar', name: 'Ember Bar', kind: 'material', maxStack: 999, color: '#ff8a30', rarity: 2, model: { type: 'bar', layer: 'emberMetal' } },
  { id: 'wyrm_scale', name: 'Wyrm Scale', kind: 'material', maxStack: 999, color: '#8a9a6a', rarity: 2, model: { type: 'scale' }, description: 'Shed by the Deepwyrm. Hard as stone.' },
  { id: 'aerite_ore', name: 'Aerite Ore', kind: 'material', maxStack: 999, color: '#a8e4ff', rarity: 1, model: { type: 'ore', layer: 'aerite' }, description: 'Found only inside the floating islands.' },
  { id: 'aerite_bar', name: 'Aerite Bar', kind: 'material', maxStack: 999, color: '#a8e4ff', rarity: 1, model: { type: 'bar', layer: 'aeriteMetal' } },
  { id: 'sky_feather', name: 'Sky Feather', kind: 'material', maxStack: 999, color: '#e8f0fa', model: { type: 'feather' }, description: 'Drifts down from the creatures of the high sky.' },
  { id: 'roc_plume', name: 'Roc Plume', kind: 'material', maxStack: 999, color: '#f0e0a0', rarity: 2, model: { type: 'plume' }, description: 'A storm-charged feather from the Tempest Roc.' },
  { id: 'gale_idol', name: 'Gale Idol', kind: 'consumable', maxStack: 20, color: '#a8e4ff', rarity: 2, model: { type: 'idol' }, description: 'Calls the Tempest Roc. Use high in the sky.' },
  { id: 'blood_shard', name: 'Sporeglass', kind: 'material', maxStack: 999, color: '#5ad8b0', rarity: 1, model: { type: 'crystal', layer: 'spore' }, description: 'Spores gone hard as glass. Shed by creatures of the Sporefall.' },
  { id: 'hollow_horn', name: 'Hollow War Horn', kind: 'consumable', maxStack: 20, color: '#e6dcc0', rarity: 2, model: { type: 'horn' }, description: 'Sounds a challenge to the Hollowfolk. Use near your town.' },
  { id: 'wyrm_bait', name: 'Tremor Totem', kind: 'consumable', maxStack: 20, color: '#6ae6ff', rarity: 1, model: { type: 'totem' }, description: 'Drive it into the ground to call the Deepwyrm. Use at night or underground.' },
  { id: 'wood', name: 'Wood', kind: 'material', maxStack: 999, color: '#a8744a', model: { type: 'log' } },
  { id: 'copper_ore', name: 'Copper Ore', kind: 'material', maxStack: 999, color: '#e0874a', model: { type: 'ore', layer: 'copper' } },
  { id: 'iron_ore', name: 'Iron Ore', kind: 'material', maxStack: 999, color: '#c8b4a6', model: { type: 'ore', layer: 'iron' } },
  { id: 'lumite', name: 'Lumite Shard', kind: 'material', maxStack: 999, color: '#46e0ff', model: { type: 'crystal', layer: 'lumiteMetal' } },
  { id: 'copper_bar', name: 'Copper Bar', kind: 'material', maxStack: 999, color: '#c0703a', model: { type: 'bar', layer: 'copper' } },
  { id: 'iron_bar', name: 'Iron Bar', kind: 'material', maxStack: 999, color: '#d6d0ca', model: { type: 'bar', layer: 'iron' } },
  { id: 'lumite_bar', name: 'Lumite Bar', kind: 'material', maxStack: 999, color: '#6ae6ff', model: { type: 'bar', layer: 'lumiteMetal' } },
  { id: 'gel', name: 'Sap', kind: 'material', maxStack: 999, color: '#b8c84e', model: { type: 'sap' }, description: 'Sticky and flammable. Oozes from Burrlings.' },
  { id: 'red_cap', name: 'Red Cap', kind: 'material', maxStack: 99, color: '#d83a3a', model: { type: 'mushroom' }, description: 'A forest mushroom. Brewed into draughts at a Hearth.' },
  { id: 'glass_bottle', name: 'Glass Bottle', kind: 'material', maxStack: 99, color: '#9ad8f0', model: { type: 'bottle' } },
  { id: 'bat_wing', name: 'Duskwing Membrane', kind: 'material', maxStack: 99, color: '#5a4a5e', model: { type: 'wing' }, description: 'Leathery. Dropped by Duskwings and Cinder Bats.' },
  { id: 'coin', name: 'Amber', kind: 'material', maxStack: 9999, color: '#f0a028', model: { type: 'amber' }, description: 'Hardened resin with a spark trapped inside. Hollowdeep\'s currency.' },

  // ---- consumables
  { id: 'life_crystal', name: 'Heartroot', kind: 'consumable', maxStack: 99, color: '#ff8a3a', rarity: 2, model: { type: 'heartroot' }, grow: { life: 20 }, description: 'A knot of living root around a warm ember core. Permanently raises max Vigor by 20 (up to 400).' },
  { id: 'fallen_star', name: 'Starseed', kind: 'material', maxStack: 999, color: '#bfe8ff', rarity: 1, model: { type: 'starseed' }, description: 'Drifts down on clear nights like a seed on the wind. Catch it before dawn.' },
  { id: 'mana_crystal', name: 'Glim Vessel', kind: 'consumable', maxStack: 99, color: '#4ab8ff', rarity: 2, model: { type: 'glim_vessel' }, grow: { mana: 20 }, description: 'Starseeds sealed in glass. Permanently raises max Glim by 20 (up to 200).' },
  { id: 'mana_potion', name: 'Glim Draught', kind: 'consumable', maxStack: 30, color: '#4ab8ff', model: { type: 'glim_draught' }, mana: 100, description: 'Restores 100 Glim.' },
  { id: 'bucket', name: 'Empty Bucket', kind: 'consumable', maxStack: 1, color: '#b4aca6', model: { type: 'bucket' }, description: 'Use on water to scoop some up.' },
  { id: 'water_bucket', name: 'Water Bucket', kind: 'consumable', maxStack: 1, color: '#3a86d8', model: { type: 'water_bucket' }, description: 'Use to pour the water out.' },
  { id: 'healing_potion', name: 'Mending Draught', kind: 'consumable', maxStack: 30, color: '#ff8a3a', model: { type: 'mending_draught' }, heal: 50, description: 'Restores 50 Vigor. [RMB] / use to drink.' },

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
  { id: 'glowcap_lamp', name: 'Glowcap Lamp', kind: 'placeable', maxStack: 99, color: '#3aa0d0', model: { type: 'furniture', id: 'glowcap_lamp' }, furniture: 'glowcap_lamp', description: 'A cool, steady light.' },
  { id: 'salt_lamp', name: 'Salt Lamp', kind: 'placeable', maxStack: 99, color: '#ffb890', model: { type: 'furniture', id: 'salt_lamp' }, furniture: 'salt_lamp', description: 'A carved block of salt around a coal. Warm, rosy light.' },
  { id: 'amber_lantern', name: 'Amber Lantern', kind: 'placeable', maxStack: 99, color: '#ffc050', rarity: 1, model: { type: 'furniture', id: 'amber_lantern' }, furniture: 'amber_lantern', description: 'Resin-glass panes in a rootwood frame. Bright and golden.' },
  { id: 'hearth', name: 'Hearth', kind: 'placeable', maxStack: 99, color: '#ff8a3a', model: { type: 'furniture', id: 'hearth' }, furniture: 'hearth', description: 'The heart of a home. Settlers need one to move in, and it brews draughts.' },
  { id: 'bed', name: 'Bed', kind: 'placeable', maxStack: 99, color: '#b03a36', model: { type: 'furniture', id: 'bed' }, furniture: 'bed', description: '[RMB] to set your spawn point.' },
];

export const ITEMS: ReadonlyMap<string, ItemDef> = new Map(list.map(i => [i.id, i]));

export function item(id: string): ItemDef {
  const def = ITEMS.get(id);
  if (!def) throw new Error(`Unknown item ${id}`);
  return def;
}

export const RARITY_COLORS = ['#f4ecd8', '#8ad0ff', '#c89aff', '#ffb040'];
