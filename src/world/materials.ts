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
  Blightgrass = 14,
  Blightstone = 15,
  Emberstone = 16,
  Emberite = 17,
}

/** Procedural pixel-art texture recipe (see render/textures.ts). */
export type TextureStyle = 'blotch' | 'speckle' | 'cobble' | 'dither' | 'ore' | 'crystal' | 'strata';

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
  { id: Mat.Blightgrass, name: 'Blightgrass', texture: 'blotch', palette: [0x6a4a8a, 0x4a3068, 0x8a64a8, 0xb07ad0], hardness: 0.4, tier: 0, drop: 'dirt', volumePerItem: 2, emissive: 0, particle: 0x6a4a8a },
  { id: Mat.Blightstone, name: 'Blightstone', texture: 'cobble', palette: [0x5a4a6e, 0x221a2e, 0x7a6a90, 0x8a4aa0], hardness: 1.1, tier: 0, drop: 'blightstone', volumePerItem: 2, emissive: 0, particle: 0x6a5a80 },
  { id: Mat.Emberstone, name: 'Emberstone', texture: 'cobble', palette: [0x5a2a22, 0x1a0a08, 0x7a3426, 0xe05a24], hardness: 2, tier: 2, drop: 'emberstone', volumePerItem: 2, emissive: 0.14, particle: 0xff6a2a },
  { id: Mat.Emberite, name: 'Emberite Ore', texture: 'ore', palette: [0x4a1e16, 0x1a0806, 0xff8a30, 0xffe070], hardness: 2.4, tier: 2, drop: 'emberite', volumePerItem: 1.5, emissive: 0.7, particle: 0xffa040 },
];

export const MATERIALS: readonly MaterialDef[] = defs;
export const MATERIAL_COUNT = defs.length;

export function material(id: number): MaterialDef {
  return defs[id] ?? defs[Mat.Stone];
}
