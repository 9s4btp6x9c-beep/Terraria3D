// Comfort and resting. Sitting out of the weather by a lit Hearth makes you
// Rested: faster Vigor and Glim regeneration for a while. The better the
// room around the Hearth — a bed, a chair, a table, a chest, lamps — the
// higher its comfort and the longer the rest lasts. It gives bases a reason
// to be homes rather than boxes.

import type { Placed } from './furniture';

/** How close to a Hearth you must be to rest by it. */
export const HEARTH_RANGE = 6;
/** Furniture within this range of the player adds to comfort. */
export const COMFORT_RANGE = 9;
/** Seconds of sitting by the fire before you are Rested. */
export const REST_TIME = 8;

/** Furniture that makes a place comfortable (each type counts once). */
const COMFORT: Partial<Record<Placed['type'], number>> = {
  bed: 1, chair: 1, table: 1, chest: 1, torch: 1, glowcap_lamp: 1, salt_lamp: 1, amber_lantern: 1,
};

export interface ComfortInfo { hearth: boolean; comfort: number }

/** Is a Hearth in reach, and how comfortable is it here? Comfort starts at 1. */
export function comfortAt(nearby: Placed[], x: number, y: number, z: number): ComfortInfo {
  let hearth = false;
  const types = new Set<string>();
  for (const f of nearby) {
    const d = Math.hypot(f.x - x, (f.y - y) * 1.5, f.z - z);
    if (f.type === 'hearth' && d < HEARTH_RANGE) hearth = true;
    if (d < COMFORT_RANGE && COMFORT[f.type]) types.add(f.type);
  }
  let comfort = 1;
  for (const t of types) comfort += COMFORT[t as Placed['type']] ?? 0;
  return { hearth, comfort };
}

/** Seconds of Rested earned at a comfort level. */
export function restDuration(comfort: number) {
  return 180 + comfort * 60;
}
