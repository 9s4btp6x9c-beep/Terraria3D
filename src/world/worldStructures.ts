// Generated structures built from the same building pieces and furniture the
// player uses: underground cabins (carved rooms with a door, torch and a loot
// chest) and small stone shrines on the sky islands with rare loot.
// Deterministic from the seed; placed once when a new world is created.

import type { Placed } from '../building/furniture';
import { CHEST_SLOTS } from '../building/furniture';
import type { Piece } from '../building/structures';
import { mulberry32 } from '../core/noise';
import type { Stack } from '../items/inventory';
import { CABIN_WALL, type WorldGenerator } from './generator';

type PieceSpec = Omit<Piece, 'id' | 'hp'>;
type FurnSpec = Omit<Placed, 'uid' | 'hp'>;

interface LootEntry { item: string; min: number; max: number; weight: number }

const CABIN_PRIMARY: LootEntry[] = [
  { item: 'swift_boots', min: 1, max: 1, weight: 3 },
  { item: 'feather_charm', min: 1, max: 1, weight: 3 },
  { item: 'miners_band', min: 1, max: 1, weight: 2 },
  { item: 'updraft_jar', min: 1, max: 1, weight: 1 },
  { item: 'barbed_hook', min: 1, max: 1, weight: 2 },
  { item: 'iron_bow', min: 1, max: 1, weight: 1 },
];
const CABIN_EXTRA: LootEntry[] = [
  { item: 'bomb', min: 3, max: 6, weight: 3 },
  { item: 'healing_potion', min: 2, max: 3, weight: 4 },
  { item: 'torch', min: 10, max: 20, weight: 3 },
  { item: 'wooden_arrow', min: 25, max: 50, weight: 3 },
  { item: 'iron_bar', min: 4, max: 9, weight: 2 },
  { item: 'copper_bar', min: 5, max: 12, weight: 2 },
  { item: 'coin', min: 20, max: 60, weight: 4 },
  { item: 'glass_bottle', min: 2, max: 4, weight: 1 },
  { item: 'red_cap', min: 1, max: 3, weight: 1 },
];
const SHRINE_PRIMARY: LootEntry[] = [
  { item: 'updraft_jar', min: 1, max: 1, weight: 4 },
  { item: 'feather_charm', min: 1, max: 1, weight: 2 },
  { item: 'swift_boots', min: 1, max: 1, weight: 2 },
];

function pick(rand: () => number, table: LootEntry[]): Stack {
  const total = table.reduce((s, e) => s + e.weight, 0);
  let r = rand() * total;
  const e = table.find(x => (r -= x.weight) <= 0) ?? table[0];
  return { id: e.item, count: e.min + Math.floor(rand() * (e.max - e.min + 1)) };
}

function chest(stacks: Stack[]): (Stack | null)[] {
  const slots: (Stack | null)[] = new Array(CHEST_SLOTS).fill(null);
  stacks.forEach((s, i) => { slots[i] = s; });
  return slots;
}

export interface StructurePlan { pieces: PieceSpec[]; furniture: FurnSpec[] }

export function planStructures(gen: WorldGenerator): StructurePlan {
  const pieces: PieceSpec[] = [];
  const furniture: FurnSpec[] = [];

  for (const c of gen.cabins) {
    const rand = mulberry32(c.seed);
    const W = c.cx * 2, D = c.cz * 2;
    const floorTop = c.y + 0.25;
    for (let i = 0; i < c.cx; i++)
      for (let j = 0; j < c.cz; j++) {
        pieces.push({ shape: 'floor', texture: 'planks', x: c.x + i * 2 + 1, y: c.y, z: c.z + j * 2 + 1, rot: 0 });
        pieces.push({ shape: 'floor', texture: 'planks', x: c.x + i * 2 + 1, y: floorTop + CABIN_WALL, z: c.z + j * 2 + 1, rot: 0 });
      }
    // Perimeter walls, leaving one slot on the front for the door.
    const doorI = Math.floor(rand() * c.cx);
    for (let i = 0; i < c.cx; i++) {
      if (i !== doorI) pieces.push({ shape: 'wall', texture: 'planks', x: c.x + i * 2 + 1, y: floorTop, z: c.z, rot: 0 });
      pieces.push({ shape: 'wall', texture: 'planks', x: c.x + i * 2 + 1, y: floorTop, z: c.z + D, rot: 0 });
    }
    for (let j = 0; j < c.cz; j++) {
      pieces.push({ shape: 'wall', texture: 'planks', x: c.x, y: floorTop, z: c.z + j * 2 + 1, rot: 1 });
      pieces.push({ shape: 'wall', texture: 'planks', x: c.x + W, y: floorTop, z: c.z + j * 2 + 1, rot: 1 });
    }
    for (const [px, pz] of [[c.x, c.z], [c.x + W, c.z], [c.x, c.z + D], [c.x + W, c.z + D]])
      pieces.push({ shape: 'pillar', texture: 'planks', x: px, y: floorTop, z: pz, rot: 0 });
    furniture.push({ type: 'door', x: c.x + doorI * 2 + 1, y: floorTop, z: c.z, rot: 0 });
    // Loot chest against the back wall, a torch, and sometimes a table + chair.
    const loot = [pick(rand, CABIN_PRIMARY), pick(rand, CABIN_EXTRA), pick(rand, CABIN_EXTRA)];
    if (rand() < 0.5) loot.push(pick(rand, CABIN_EXTRA));
    furniture.push({ type: 'chest', x: c.x + 1 + Math.floor(rand() * c.cx) * 2, y: floorTop, z: c.z + D - 0.6, rot: 2, chest: chest(loot) });
    furniture.push({ type: 'torch', x: c.x + 0.25, y: floorTop + 1.3, z: c.z + D / 2, rot: 0, wall: [1, 0, 0] });
    if (rand() < 0.6) {
      furniture.push({ type: 'table', x: c.x + W - 1.2, y: floorTop, z: c.z + 1.3, rot: 1 });
      furniture.push({ type: 'chair', x: c.x + W - 2.5, y: floorTop, z: c.z + 1.3, rot: 1 });
    }
  }

  // Sky shrines.
  gen.islands.forEach((isl, k) => {
    const rand = mulberry32(gen.cfg.seed * 31 + k * 977);
    const s = gen.surfaceAt(isl.x, isl.z);
    if (!s) return;
    const x0 = Math.floor(isl.x / 2) * 2 - 2, z0 = Math.floor(isl.z / 2) * 2 - 2;
    const y = Math.floor((s.y + 0.1) / 0.25) * 0.25;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        pieces.push({ shape: 'floor', texture: 'bricks', x: x0 + i * 2 + 1, y, z: z0 + j * 2 + 1, rot: 0 });
        pieces.push({ shape: 'floor', texture: 'bricks', x: x0 + i * 2 + 1, y: y + 0.25 + CABIN_WALL, z: z0 + j * 2 + 1, rot: 0 });
      }
    for (const [px, pz] of [[x0, z0], [x0 + 4, z0], [x0, z0 + 4], [x0 + 4, z0 + 4], [x0 + 2, z0], [x0 + 2, z0 + 4]])
      pieces.push({ shape: 'pillar', texture: 'bricks', x: px, y: y + 0.25, z: pz, rot: 0 });
    pieces.push({ shape: 'wall', texture: 'bricks', x: x0 + 1, y: y + 0.25, z: z0 + 4, rot: 0 });
    pieces.push({ shape: 'wall', texture: 'bricks', x: x0 + 3, y: y + 0.25, z: z0 + 4, rot: 0 });
    furniture.push({ type: 'chest', x: x0 + 2, y: y + 0.25, z: z0 + 3.2, rot: 2, chest: chest([pick(rand, SHRINE_PRIMARY), { id: 'lumite', count: 4 + Math.floor(rand() * 6) }, { id: 'coin', count: 40 + Math.floor(rand() * 60) }]) });
    furniture.push({ type: 'torch', x: x0 + 0.4, y: y + 0.25, z: z0 + 0.4, rot: 0 });
    furniture.push({ type: 'torch', x: x0 + 3.6, y: y + 0.25, z: z0 + 0.4, rot: 0 });
  });

  return { pieces, furniture };
}
