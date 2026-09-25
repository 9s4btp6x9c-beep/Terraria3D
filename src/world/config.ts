// World dimensions. The density field is sampled once per metre and split
// into cubic chunks of CHUNK samples; chunks are the unit of meshing, editing
// and persistence. The sampling grid is an internal detail: the visible
// surface is a smooth mesh extracted from the field, never cubes.

export const CHUNK = 32;

export interface WorldConfig {
  seed: number;
  /** Size in chunks. */
  chunksX: number;
  chunksY: number;
  chunksZ: number;
  seaLevel: number;
}

/** New worlds are 768 x 768 m. Saves remember their size (older ones were 512). */
export const WORLD_CHUNKS = 24;
export const LEGACY_CHUNKS = 16;

export function defaultConfig(seed = 1337, chunks = WORLD_CHUNKS): WorldConfig {
  return { seed, chunksX: chunks, chunksY: 5, chunksZ: chunks, seaLevel: 62 };
}

export function worldSize(cfg: WorldConfig) {
  return { x: cfg.chunksX * CHUNK, y: cfg.chunksY * CHUNK, z: cfg.chunksZ * CHUNK };
}
