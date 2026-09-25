// Item database. Items are pure data; behaviour is selected by `kind` and the
// optional tool/place blocks, so new content is added here, not in code.

import { Mat } from '../world/materials';

export type PieceShape = 'floor' | 'wall' | 'pillar' | 'stairs' | 'roof';

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
}

export interface ItemDef {
  id: string;
  name: string;
  kind: 'tool' | 'material' | 'placeable';
  maxStack: number;
  /** Icon colour for the UI swatch. */
  color: string;
  tool?: ToolDef;
  /** Terrain material deposited when placed as a terrain blob. */
  terrain?: Mat;
  /** Building piece texture ('planks' | 'bricks') when used for building. */
  build?: 'planks' | 'bricks';
  description?: string;
}

const list: ItemDef[] = [
  { id: 'copper_pickaxe', name: 'Copper Pickaxe', kind: 'tool', maxStack: 1, color: '#b8703e', tool: { type: 'pickaxe', tier: 0, power: 1.0, speed: 0.32, radius: 1.35, reach: 5 }, description: 'Digs through dirt, stone and copper.' },
  { id: 'copper_axe', name: 'Copper Axe', kind: 'tool', maxStack: 1, color: '#a8a4ae', tool: { type: 'axe', tier: 0, power: 1.0, speed: 0.4, radius: 0, reach: 4 }, description: 'Fells trees for wood.' },
  { id: 'iron_pickaxe', name: 'Iron Pickaxe', kind: 'tool', maxStack: 1, color: '#d8c0b0', tool: { type: 'pickaxe', tier: 1, power: 1.5, speed: 0.28, radius: 1.5, reach: 5.5 }, description: 'Strong enough for iron, deepstone and lumite.' },
  { id: 'dirt', name: 'Dirt', kind: 'material', maxStack: 999, color: '#8a5a3c', terrain: Mat.Dirt },
  { id: 'stone', name: 'Stone', kind: 'material', maxStack: 999, color: '#a4a2ac', terrain: Mat.Stone, build: 'bricks' },
  { id: 'sand', name: 'Sand', kind: 'material', maxStack: 999, color: '#dcc88c', terrain: Mat.Sand },
  { id: 'clay', name: 'Clay', kind: 'material', maxStack: 999, color: '#a0604a', terrain: Mat.Clay },
  { id: 'snow', name: 'Snow', kind: 'material', maxStack: 999, color: '#eaf2f8', terrain: Mat.Snow },
  { id: 'wood', name: 'Wood', kind: 'material', maxStack: 999, color: '#a8744a', build: 'planks' },
  { id: 'copper_ore', name: 'Copper Ore', kind: 'material', maxStack: 999, color: '#e0874a' },
  { id: 'iron_ore', name: 'Iron Ore', kind: 'material', maxStack: 999, color: '#c8b4a6' },
  { id: 'lumite', name: 'Lumite Shard', kind: 'material', maxStack: 999, color: '#46e0ff' },
];

export const ITEMS: ReadonlyMap<string, ItemDef> = new Map(list.map(i => [i.id, i]));

export function item(id: string): ItemDef {
  const def = ITEMS.get(id);
  if (!def) throw new Error(`Unknown item ${id}`);
  return def;
}
