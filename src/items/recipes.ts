// Data-driven crafting recipes. A recipe is available when the player stands
// near its station (or none = by hand) and has the ingredients.

import type { Inventory } from './inventory';
import type { StationId } from './items';

export interface Recipe {
  out: string;
  count: number;
  in: [string, number][];
  station: StationId | null;
}

const R = (out: string, count: number, station: StationId | null, ...ing: [string, number][]): Recipe => ({ out, count, station, in: ing });

export const RECIPES: Recipe[] = [
  // by hand
  R('workbench', 1, null, ['wood', 10]),
  R('torch', 3, null, ['wood', 1], ['gel', 1]),
  // workbench
  R('chair', 1, 'workbench', ['wood', 4]),
  R('table', 1, 'workbench', ['wood', 8]),
  R('door', 1, 'workbench', ['wood', 6]),
  R('chest', 1, 'workbench', ['wood', 8], ['copper_bar', 1]),
  R('bed', 1, 'workbench', ['wood', 15], ['gel', 4]),
  R('wooden_sword', 1, 'workbench', ['wood', 7]),
  R('wooden_bow', 1, 'workbench', ['wood', 10]),
  R('wooden_arrow', 10, 'workbench', ['wood', 1], ['stone', 1]),
  R('furnace', 1, 'workbench', ['stone', 20], ['wood', 4], ['torch', 3]),
  R('anvil', 1, 'workbench', ['iron_bar', 5]),
  R('healing_potion', 1, 'workbench', ['gel', 2], ['red_cap', 1], ['glass_bottle', 1]),
  // furnace
  R('copper_bar', 1, 'furnace', ['copper_ore', 3]),
  R('iron_bar', 1, 'furnace', ['iron_ore', 3]),
  R('glass_bottle', 2, 'furnace', ['sand', 2]),
  R('torch', 5, 'furnace', ['wood', 1], ['gel', 1]),
  // anvil
  R('copper_sword', 1, 'anvil', ['copper_bar', 8]),
  R('copper_pickaxe', 1, 'anvil', ['copper_bar', 10], ['wood', 3]),
  R('copper_axe', 1, 'anvil', ['copper_bar', 8], ['wood', 3]),
  R('copper_helmet', 1, 'anvil', ['copper_bar', 8]),
  R('copper_chainmail', 1, 'anvil', ['copper_bar', 12]),
  R('copper_greaves', 1, 'anvil', ['copper_bar', 10]),
  R('iron_sword', 1, 'anvil', ['iron_bar', 8]),
  R('iron_pickaxe', 1, 'anvil', ['iron_bar', 10], ['wood', 3]),
  R('iron_axe', 1, 'anvil', ['iron_bar', 8], ['wood', 3]),
  R('iron_bow', 1, 'anvil', ['iron_bar', 7], ['wood', 3]),
  R('iron_helmet', 1, 'anvil', ['iron_bar', 10]),
  R('iron_chainmail', 1, 'anvil', ['iron_bar', 14]),
  R('iron_greaves', 1, 'anvil', ['iron_bar', 12]),
  R('bomb', 3, 'anvil', ['gel', 2], ['iron_bar', 1]),
  R('grappling_hook', 1, 'anvil', ['barbed_hook', 1], ['iron_bar', 4]),
  R('forge', 1, 'anvil', ['lumite', 12], ['iron_bar', 8], ['stone', 20]),
  // lumite forge
  R('lumite_bar', 1, 'forge', ['lumite', 3]),
  R('lumite_pickaxe', 1, 'forge', ['lumite_bar', 12], ['iron_bar', 3]),
  R('lumite_blade', 1, 'forge', ['lumite_bar', 10]),
  R('lumite_staff', 1, 'forge', ['lumite_bar', 8], ['wood', 4]),
  R('glow_charm', 1, 'forge', ['lumite_bar', 6], ['bat_wing', 4]),
];

export const STATION_NAMES: Record<StationId, string> = {
  workbench: 'Workbench', furnace: 'Furnace', anvil: 'Anvil', forge: 'Lumite Forge',
};

export function canCraft(r: Recipe, inv: Inventory, stations: Set<StationId>): boolean {
  if (r.station && !stations.has(r.station)) return false;
  return r.in.every(([id, n]) => inv.count(id) >= n);
}

/** Recipes worth showing: craftable now, or the player owns an ingredient (discovery). */
export function visibleRecipes(inv: Inventory, stations: Set<StationId>): { r: Recipe; ok: boolean }[] {
  return RECIPES
    .filter(r => r.in.some(([id]) => inv.count(id) > 0) || canCraft(r, inv, stations))
    .map(r => ({ r, ok: canCraft(r, inv, stations) }))
    .sort((a, b) => Number(b.ok) - Number(a.ok));
}

export function craft(r: Recipe, inv: Inventory, stations: Set<StationId>): boolean {
  if (!canCraft(r, inv, stations)) return false;
  // Never destroy items: make sure the result fits once ingredients are removed.
  const snapshot = inv.serialize();
  for (const [id, n] of r.in) inv.remove(id, n);
  if (inv.add(r.out, r.count) > 0) {
    inv.load(snapshot);
    return false;
  }
  return true;
}
