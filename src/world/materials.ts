// Data-driven terrain materials. Terrain is a continuous density field; each
// sample also carries a material id that decides its look, hardness, the tool
// tier needed to mine it and what it drops.

export const enum Mat {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Clay = 5,
  Snow = 6,
  Copper = 7,
  Iron = 8,
  Lumite = 9,
  Bedrock = 10,
  Deepstone = 11,
  Sandstone = 12,
  Ice = 13,
  Riftmoss = 14,
  Riftstone = 15,
  Emberstone = 16,
  Emberite = 17,
  Aerite = 18,
  Mushgrass = 19,
  Mud = 20,
  Moss = 21,
  Rootwood = 22,
  Salt = 23,
  Fossil = 24,
  Leaflitter = 25,
  Amber = 26,
  Basalt = 27,
  Ash = 28,
  Obsidian = 29,
  Magmarock = 30,
}

/** Procedural pixel-art texture recipe (see render/textures.ts). */
export type TextureStyle = 'blotch' | 'speckle' | 'cobble' | 'dither' | 'ore' | 'crystal' | 'strata' | 'bark' | 'bone' | 'crackle' | 'litter';

export interface MaterialDef {
  id: Mat;
  name: string;
  texture: TextureStyle;
  /** Palette: [base, dark, light, accent]. */
  palette: [number, number, number, number];
  /** Seconds of work per cubic metre with a tier-0 tool. */
  hardness: number;
  /** Minimum pickaxe tier; -1 = unbreakable. */
  tier: number;
  /** Item id dropped when mined, or null. */
  drop: string | null;
  /** Cubic metres removed per dropped item. */
  volumePerItem: number;
  /** 0..1 self-illumination (crystals, ores). */
  emissive: number;
  /** Debris particle colour. */
  particle: number;
}

const defs: MaterialDef[] = [
  { id: Mat.Air, name: 'Air', texture: 'speckle', palette: [0, 0, 0, 0], hardness: 0, tier: 0, drop: null, volumePerItem: 1, emissive: 0, particle: 0 },
  { id: Mat.Grass, name: 'Grass', texture: 'blotch', palette: [0x4a9160, 0x3a774f, 0x62a870, 0x7cba7c], hardness: 0.35, tier: 0, drop: 'dirt', volumePerItem: 2, emissive: 0, particle: 0x3f8a4a },
  { id: Mat.Dirt, name: 'Dirt', texture: 'speckle', palette: [0x8a5a3c, 0x5e3a26, 0xa06e4a, 0x3e2618], hardness: 0.35, tier: 0, drop: 'dirt', volumePerItem: 2, emissive: 0, particle: 0x6e4630 },
  { id: Mat.Stone, name: 'Stone', texture: 'cobble', palette: [0xa4a2ac, 0x3a3842, 0xc4c2ca, 0x7c7a86], hardness: 0.9, tier: 0, drop: 'stone', volumePerItem: 2, emissive: 0, particle: 0x9a98a2 },
  { id: Mat.Sand, name: 'Sand', texture: 'dither', palette: [0xdcc88c, 0xc0a870, 0xeedca4, 0xb09460], hardness: 0.3, tier: 0, drop: 'sand', volumePerItem: 2, emissive: 0, particle: 0xd8c488 },
  { id: Mat.Clay, name: 'Clay', texture: 'strata', palette: [0xa0604a, 0x7a4434, 0xb87660, 0x5a3024], hardness: 0.5, tier: 0, drop: 'clay', volumePerItem: 2, emissive: 0, particle: 0x8e5442 },
  { id: Mat.Snow, name: 'Snow', texture: 'dither', palette: [0xeaf2f8, 0xc6d4e2, 0xffffff, 0xaebfd2], hardness: 0.25, tier: 0, drop: 'snow', volumePerItem: 2, emissive: 0, particle: 0xffffff },
  { id: Mat.Copper, name: 'Copper Ore', texture: 'ore', palette: [0x8a8690, 0x3a3842, 0xe0874a, 0xffb070], hardness: 1.2, tier: 0, drop: 'copper_ore', volumePerItem: 1.5, emissive: 0.05, particle: 0xe08a4a },
  { id: Mat.Iron, name: 'Iron Ore', texture: 'ore', palette: [0x77737e, 0x302e36, 0xc8b4a6, 0xf0e2d6], hardness: 1.6, tier: 0, drop: 'iron_ore', volumePerItem: 1.5, emissive: 0.03, particle: 0xd8c0b0 },
  { id: Mat.Lumite, name: 'Lumite Crystal', texture: 'crystal', palette: [0x2ab8e8, 0x146a9a, 0x7af0ff, 0xe0ffff], hardness: 1.4, tier: 1, drop: 'lumite', volumePerItem: 1.5, emissive: 0.85, particle: 0x7af0ff },
  { id: Mat.Bedrock, name: 'Bedrock', texture: 'cobble', palette: [0x2a2830, 0x0e0d12, 0x3a3842, 0x201e26], hardness: 1e9, tier: -1, drop: null, volumePerItem: 1, emissive: 0, particle: 0x333333 },
  { id: Mat.Deepstone, name: 'Deepstone', texture: 'cobble', palette: [0x5a5470, 0x24202e, 0x746e8c, 0x44405a], hardness: 1.4, tier: 1, drop: 'stone', volumePerItem: 2, emissive: 0, particle: 0x5a5470 },
  { id: Mat.Sandstone, name: 'Sandstone', texture: 'strata', palette: [0xd4b070, 0xa4844a, 0xe6cc92, 0x86683c], hardness: 0.7, tier: 0, drop: 'sandstone', volumePerItem: 2, emissive: 0, particle: 0xc8a868 },
  { id: Mat.Ice, name: 'Ice', texture: 'cobble', palette: [0xa8d8f0, 0x5a98c8, 0xd8f4ff, 0x88c0e0], hardness: 0.5, tier: 0, drop: 'ice', volumePerItem: 2, emissive: 0.04, particle: 0xc8ecff },
  { id: Mat.Riftmoss, name: 'Riftmoss', texture: 'blotch', palette: [0x3e5664, 0x2a3c4a, 0x4c6676, 0x58b4bc], hardness: 0.4, tier: 0, drop: 'dirt', volumePerItem: 2, emissive: 0.03, particle: 0x4e8a96 },
  { id: Mat.Riftstone, name: 'Riftstone', texture: 'cobble', palette: [0x46506a, 0x161c2a, 0x5e6c88, 0x2e8a9a], hardness: 1.1, tier: 0, drop: 'blightstone', volumePerItem: 2, emissive: 0.1, particle: 0x5a7890 },
  { id: Mat.Emberstone, name: 'Emberstone', texture: 'cobble', palette: [0x5a2a22, 0x1a0a08, 0x7a3426, 0xe05a24], hardness: 2, tier: 2, drop: 'emberstone', volumePerItem: 2, emissive: 0.14, particle: 0xff6a2a },
  { id: Mat.Emberite, name: 'Emberite Ore', texture: 'ore', palette: [0x4a1e16, 0x1a0806, 0xff8a30, 0xffe070], hardness: 2.4, tier: 2, drop: 'emberite', volumePerItem: 1.5, emissive: 0.7, particle: 0xffa040 },
  { id: Mat.Aerite, name: 'Aerite Ore', texture: 'ore', palette: [0x8e98ae, 0x3e4458, 0xa8e4ff, 0xfff4c0], hardness: 1.6, tier: 1, drop: 'aerite_ore', volumePerItem: 1.5, emissive: 0.3, particle: 0xbfeaff },
  { id: Mat.Mushgrass, name: 'Mushroom Grass', texture: 'blotch', palette: [0x2a6a9a, 0x163e66, 0x3aa0d0, 0x7ae8ff], hardness: 0.4, tier: 0, drop: 'mud', volumePerItem: 2, emissive: 0.32, particle: 0x3aa0d0 },
  { id: Mat.Mud, name: 'Mud', texture: 'speckle', palette: [0x4e4038, 0x2e2420, 0x64544a, 0x3a3a52], hardness: 0.4, tier: 0, drop: 'mud', volumePerItem: 2, emissive: 0, particle: 0x4e4038 },
  // ---- Rootwold: deep moss over the petrified roots of something vast.
  { id: Mat.Moss, name: 'Deep Moss', texture: 'blotch', palette: [0x5e7a36, 0x3e5626, 0x7a9442, 0xc8c868], hardness: 0.4, tier: 0, drop: 'dirt', volumePerItem: 2, emissive: 0, particle: 0x6a8a3e },
  { id: Mat.Rootwood, name: 'Petrified Root', texture: 'bark', palette: [0x7a6250, 0x3e3028, 0x9a8068, 0xc4d890], hardness: 1.2, tier: 0, drop: 'rootwood', volumePerItem: 2, emissive: 0, particle: 0x8a7058 },
  // ---- Ossuary Flats: a dead salt sea strewn with the bones of giants.
  { id: Mat.Salt, name: 'Salt Crust', texture: 'crackle', palette: [0xe8e2d6, 0xa89c8c, 0xf8f6f0, 0xd4cabc], hardness: 0.5, tier: 0, drop: 'salt', volumePerItem: 2, emissive: 0, particle: 0xf0ece4 },
  { id: Mat.Fossil, name: 'Colossal Bone', texture: 'bone', palette: [0xe0d4b4, 0x9a8a6a, 0xf6ecd0, 0x6a5a44], hardness: 1.5, tier: 1, drop: 'fossil', volumePerItem: 2, emissive: 0, particle: 0xe6dcc0 },
  // ---- Amberwood: an autumn forest that bleeds glowing resin.
  { id: Mat.Leaflitter, name: 'Leaf Litter', texture: 'litter', palette: [0x6a4a2e, 0x3e2a1a, 0xd8742a, 0xe8b440], hardness: 0.35, tier: 0, drop: 'dirt', volumePerItem: 2, emissive: 0, particle: 0xc8702e },
  { id: Mat.Amber, name: 'Amber Deposit', texture: 'crystal', palette: [0xe8901e, 0x9a4a0e, 0xffc050, 0xfff0a0], hardness: 1.0, tier: 0, drop: 'coin', volumePerItem: 0.35, emissive: 0.6, particle: 0xffb040 },
  // ---- volcanoes: black basalt cones under grey ash, glowing magma rock at the vents,
  // and obsidian where lava meets water.
  { id: Mat.Basalt, name: 'Basalt', texture: 'cobble', palette: [0x3e383c, 0x16121a, 0x524a4e, 0x2e2628], hardness: 1.3, tier: 1, drop: 'basalt', volumePerItem: 2, emissive: 0, particle: 0x3e383c },
  { id: Mat.Ash, name: 'Ash', texture: 'dither', palette: [0x6a6668, 0x4e4a4e, 0x86828a, 0x9a6a4a], hardness: 0.3, tier: 0, drop: 'ash', volumePerItem: 2, emissive: 0, particle: 0x7a767a },
  { id: Mat.Obsidian, name: 'Obsidian', texture: 'crystal', palette: [0x2a1e3a, 0x0e0816, 0x4a3a66, 0x8a6ac8], hardness: 2.2, tier: 2, drop: 'obsidian', volumePerItem: 1.5, emissive: 0.08, particle: 0x3a2a4e },
  { id: Mat.Magmarock, name: 'Magma Rock', texture: 'ore', palette: [0x3a1c14, 0x160806, 0xff6a1a, 0xffc040], hardness: 1.6, tier: 1, drop: 'basalt', volumePerItem: 2, emissive: 0.35, particle: 0xff7a2a },
];

export const MATERIALS: readonly MaterialDef[] = defs;
export const MATERIAL_COUNT = defs.length;

export function material(id: number): MaterialDef {
  return defs[id] ?? defs[Mat.Stone];
}
